// Recibos e notas fiscais de serviço (NFS-e).
// - Recibo: emitido aqui, numerado em sequência (7A-R-0001), aberto pelo pagador em /recibo/<token> e salvo em PDF.
// - Nota fiscal: o sistema só PREPARA os dados (tomador, serviço, valor, ISS) e mostra o texto pronto para o
//   Emissor Nacional da NFS-e (Betim usa o padrão nacional desde 01/01/2026). A emissão é feita pela 7A, no portal,
//   com o login da empresa; depois o número da nota é registrado aqui. Nada sai daqui para a prefeitura.
// Nenhum dado da 7A (nome, CPF/CNPJ, inscrição) vem preenchido: fica em Ajustes, digitado pela equipe.

import { agora, auditoria, dataBR, dataOk, hojeSP, json, lerConfig, txt } from "./banco.js";

/* ---------------- CPF e CNPJ ---------------- */

// CNPJ pode ser alfanumérico (Receita Federal, a partir de julho de 2026): 12 letras ou números + 2 dígitos verificadores
export function validarDocumento(entrada) {
  const bruto = String(entrada ?? "").toUpperCase().replace(/[\s./-]/g, "");
  if (!bruto) return { ok: true, valor: "", tipo: "" };
  if (/^\d{11}$/.test(bruto)) {
    if (/^(\d)\1{10}$/.test(bruto)) return { ok: false, erro: "Este CPF não é válido." };
    const dv = (n) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += Number(bruto[i]) * (n + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    if (dv(9) !== Number(bruto[9]) || dv(10) !== Number(bruto[10])) return { ok: false, erro: "Confira o CPF: os dígitos finais não batem." };
    return { ok: true, valor: bruto, tipo: "cpf" };
  }
  if (/^[A-Z0-9]{12}\d{2}$/.test(bruto)) {
    if (/^(\d)\1{13}$/.test(bruto)) return { ok: false, erro: "Este CNPJ não é válido." };
    const v = (c) => c.charCodeAt(0) - 48;
    const dv = (n) => {
      const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      let s = 0;
      for (let i = 0; i < n; i++) s += v(bruto[i]) * pesos[i];
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    if (dv(12) !== Number(bruto[12]) || dv(13) !== Number(bruto[13])) return { ok: false, erro: "Confira o CNPJ: os dígitos finais não batem." };
    return { ok: true, valor: bruto, tipo: "cnpj" };
  }
  return { ok: false, erro: "Use um CPF (11 números) ou um CNPJ (14 caracteres)." };
}

export function formatarDocumento(d) {
  if (!d) return "";
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return d;
}

/* ---------------- valor por extenso ---------------- */

const UNIDADES = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ate999(n) {
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100;
  const partes = [];
  if (c) partes.push(CENTENAS[c]);
  if (r) partes.push(r < 20 ? UNIDADES[r] : DEZENAS[Math.floor(r / 10)] + (r % 10 ? " e " + UNIDADES[r % 10] : ""));
  return partes.join(" e ");
}

function inteiroPorExtenso(n) {
  if (n === 0) return "zero";
  const grupos = [];
  let x = n;
  while (x > 0) { grupos.push(x % 1000); x = Math.floor(x / 1000); }
  const nomes = [["", ""], ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"]];
  const partes = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (g) partes.push({ g, t: i === 1 && g === 1 ? "mil" : ate999(g) + (i ? " " + nomes[i][g === 1 ? 0 : 1] : "") });
  }
  // "e" antes do último grupo quando ele é menor que 100 ou uma centena redonda (mil e quinhentos, dois mil e cem)
  return partes.map((p, k) => (k > 0 && k === partes.length - 1 && (p.g < 100 || p.g % 100 === 0) ? "e " : "") + p.t).join(" ");
}

// 150000 -> "mil e quinhentos reais"; 123456 -> "mil duzentos e trinta e quatro reais e cinquenta e seis centavos"
export function porExtenso(centavos) {
  const total = Math.round(Number(centavos) || 0);
  const reais = Math.floor(total / 100), cent = total % 100;
  const de = reais >= 1e6 && reais % 1e6 === 0 ? " de" : "";
  const r = reais ? `${inteiroPorExtenso(reais)}${de} ${reais === 1 ? "real" : "reais"}` : "";
  const c = cent ? `${inteiroPorExtenso(cent)} ${cent === 1 ? "centavo" : "centavos"}` : "";
  return r && c ? `${r} e ${c}` : r || c || "zero real";
}

/* ---------------- emitente (a 7A) ---------------- */

export const CAMPOS_EMITENTE = {
  emit_nome: "Nome ou razão social",
  emit_doc: "CPF ou CNPJ",
  emit_im: "Inscrição municipal",
  emit_endereco: "Endereço",
  emit_cidade: "Cidade e UF",
  emit_responsavel: "Quem assina",
  emit_regime: "Regime",
};
export const REGIMES = { "": "Não informado", mei: "MEI", simples: "Simples Nacional (ME/EPP)", outro: "Outro regime", pf: "Pessoa física (autônomo)" };

export function emitenteDe(config) {
  const e = {};
  for (const k of Object.keys(CAMPOS_EMITENTE)) e[k.slice(5)] = config[k] || "";
  return e;
}

// o que falta da 7A para cada documento (o recibo precisa de quem recebe e do documento; a nota, também da inscrição e do endereço)
export function faltasEmitente(e, tipo) {
  const obrig = tipo === "nfse" ? ["nome", "doc", "im", "endereco", "cidade"] : ["nome", "doc"];
  return obrig.filter((k) => !e[k]).map((k) => CAMPOS_EMITENTE["emit_" + k]);
}

/* ---------------- NFS-e: campos da DPS e o texto para o Emissor Nacional ---------------- */

export const EMISSOR_NACIONAL = "https://www.nfse.gov.br/EmissorNacional";

function limparNfse(n) {
  const aliq = n?.aliquota === "" || n?.aliquota == null ? null : Number(String(n.aliquota).replace(",", "."));
  return {
    descricao: txt(n?.descricao, 2000),
    codigo_servico: txt(n?.codigo_servico, 40),
    municipio: txt(n?.municipio, 80),
    aliquota: aliq != null && Number.isFinite(aliq) && aliq >= 0 && aliq <= 5 ? aliq : null, // ISS vai de 2% a 5%
    iss_retido: n?.iss_retido ? 1 : 0,
    numero_nota: txt(n?.numero_nota, 30),
    chave: txt(n?.chave, 60),
    emitida_em: dataOk(n?.emitida_em),
    link: /^https:\/\//.test(n?.link || "") ? txt(n.link, 500) : "",
  };
}

export function faltasNfse(d, nf) {
  const f = [];
  if (!d.pagador_nome) f.push("Nome do tomador");
  if (!d.pagador_doc) f.push("CPF ou CNPJ do tomador");
  if (!d.valor) f.push("Valor do serviço");
  if (!d.data) f.push("Data de competência");
  if (!nf.descricao) f.push("Descrição do serviço");
  if (!nf.codigo_servico) f.push("Código do serviço (confirmar com o contador)");
  if (!nf.municipio) f.push("Município onde o show acontece");
  return f;
}

const reaisTxt = (c) => (c / 100).toFixed(2).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

// bloco para copiar e colar, na ordem das telas do Emissor Nacional (emitente, tomador, serviço, valores)
export function textoEmissor(d, nf, e) {
  const iss = nf.aliquota != null ? Math.round((d.valor * nf.aliquota) / 100) : null;
  const l = (rotulo, v) => `${rotulo}: ${v || "(a preencher)"}`;
  return [
    "PRESTADOR (7A)",
    l("Nome ou razão social", e.nome),
    l("CPF/CNPJ", formatarDocumento(e.doc)),
    l("Inscrição municipal", e.im),
    "",
    "TOMADOR",
    l("Nome ou razão social", d.pagador_nome),
    l("CPF/CNPJ", formatarDocumento(d.pagador_doc)),
    l("Endereço", d.pagador_endereco),
    l("Cidade", d.pagador_cidade),
    l("E-mail", d.pagador_email),
    "",
    "SERVIÇO",
    l("Data de competência", dataBR(d.data)),
    l("Município da prestação", nf.municipio),
    l("Código de tributação", nf.codigo_servico),
    l("Descrição", nf.descricao),
    "",
    "VALORES",
    l("Valor do serviço", d.valor ? "R$ " + reaisTxt(d.valor) : ""),
    l("Alíquota do ISS", nf.aliquota != null ? String(nf.aliquota).replace(".", ",") + "%" : ""),
    l("ISS estimado", iss != null ? "R$ " + reaisTxt(iss) : ""),
    `ISS retido pelo tomador: ${nf.iss_retido ? "sim" : "não"}`,
  ].join("\n");
}

/* ---------------- rotas (com login, só a equipe) ---------------- */

const FORMAS = ["Pix", "Transferência bancária", "Dinheiro", "Cartão", "Boleto", "Outro"];
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const numeroRecibo = (n) => (n ? "7A-R-" + String(n).padStart(4, "0") : "");

function ler(linha) {
  if (!linha) return null;
  const emitente = JSON.parse(linha.emitente || "{}");
  const nfse = JSON.parse(linha.nfse || "{}");
  const r = { ...linha, emitente, nfse, numero_texto: linha.tipo === "recibo" ? numeroRecibo(linha.numero) : nfse.numero_nota || "" };
  return r;
}

function limparDocumento(c) {
  const doc = validarDocumento(c?.pagador_doc);
  if (!doc.ok) return { erro: "Pagador: " + doc.erro };
  const valor = Math.round(Number(c?.valor));
  return {
    show_id: Number(c?.show_id) > 0 ? Number(c.show_id) : null,
    contratante_id: Number(c?.contratante_id) > 0 ? Number(c.contratante_id) : null,
    valor: Number.isFinite(valor) && valor > 0 && valor < 1e11 ? valor : 0,
    data: dataOk(c?.data),
    forma: FORMAS.includes(c?.forma) ? c.forma : "",
    referente: txt(c?.referente, 600),
    pagador_nome: txt(c?.pagador_nome, 160),
    pagador_doc: doc.valor,
    pagador_endereco: txt(c?.pagador_endereco, 240),
    pagador_cidade: txt(c?.pagador_cidade, 80),
    pagador_email: txt(c?.pagador_email, 160).toLowerCase(),
    obs: txt(c?.obs, 2000),
  };
}

// guarda o CPF/CNPJ no cadastro do contratante, se ele ainda não tiver um (o próximo documento já vem preenchido)
function guardarDocContratante(env, d) {
  return d.contratante_id && d.pagador_doc
    ? [env.DB.prepare("UPDATE contratantes SET documento = ? WHERE id = ? AND documento = ''").bind(d.pagador_doc, d.contratante_id)]
    : [];
}

export async function rotasDocumentos(req, env, partes, corpo, url) {
  const metodo = req.method;
  const id = Number(partes[1]);

  if (partes.length === 1 && metodo === "GET") {
    const show = Number(url.searchParams.get("show")) || null;
    const { results } = show
      ? await env.DB.prepare("SELECT * FROM documentos WHERE show_id = ? ORDER BY criado DESC").bind(show).all()
      : await env.DB.prepare("SELECT * FROM documentos ORDER BY criado DESC LIMIT 500").all();
    return json(results.map(ler));
  }

  if (partes.length === 1 && metodo === "POST") return criar(req, env, corpo);
  if (partes.length === 2 && partes[1] === "previa" && metodo === "POST") return previaRecibo(env, corpo);

  if (!id) return json({ erro: "Documento não encontrado." }, 404);
  const atual = ler(await env.DB.prepare("SELECT * FROM documentos WHERE id = ?").bind(id).first());
  if (!atual) return json({ erro: "Documento não encontrado." }, 404);

  if (partes.length === 2 && metodo === "GET") return json(await detalhar(env, atual));

  // nota fiscal em preparo: dá para corrigir tudo até ser registrada como emitida
  if (partes.length === 2 && metodo === "PUT") {
    if (atual.tipo !== "nfse") return json({ erro: "Recibo emitido não muda. Se tiver erro, cancele e emita outro." }, 409);
    if (atual.situacao === "emitida" || atual.situacao === "cancelada") return json({ erro: "Esta nota já foi registrada como emitida ou cancelada." }, 409);
    const d = limparDocumento({ ...atual, ...corpo });
    if (d.erro) return json(d, 400);
    const nf = limparNfse({ ...atual.nfse, ...(corpo?.nfse || {}) });
    const situacao = faltasNfse(d, nf).length ? "rascunho" : "pronta";
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE documentos SET valor = ?, data = ?, referente = ?, pagador_nome = ?, pagador_doc = ?, pagador_endereco = ?, pagador_cidade = ?, pagador_email = ?,
         obs = ?, nfse = ?, situacao = ?, atualizado = ? WHERE id = ?`
      ).bind(d.valor, d.data, d.referente, d.pagador_nome, d.pagador_doc, d.pagador_endereco, d.pagador_cidade, d.pagador_email, d.obs, JSON.stringify(nf), situacao, agora(), id),
      ...guardarDocContratante(env, { ...d, contratante_id: atual.contratante_id }),
    ]);
    return json(await detalhar(env, ler(await env.DB.prepare("SELECT * FROM documentos WHERE id = ?").bind(id).first())));
  }

  // depois de emitir no Emissor Nacional: registra o número da nota que o portal deu
  if (partes[2] === "emitida" && metodo === "POST") {
    if (atual.tipo !== "nfse") return json({ erro: "Só nota fiscal tem número de nota." }, 400);
    if (atual.situacao === "cancelada") return json({ erro: "Esta nota foi cancelada." }, 409);
    const nf = limparNfse({ ...atual.nfse, numero_nota: corpo?.numero_nota, chave: corpo?.chave, emitida_em: corpo?.emitida_em, link: corpo?.link });
    if (!nf.numero_nota) return json({ erro: "Digite o número da nota que o Emissor Nacional mostrou." }, 400);
    if (!nf.emitida_em) return json({ erro: "Informe a data em que a nota foi emitida." }, 400);
    await env.DB.batch([
      env.DB.prepare("UPDATE documentos SET nfse = ?, situacao = 'emitida', atualizado = ? WHERE id = ?").bind(JSON.stringify(nf), agora(), id),
      ...(atual.contratante_id ? [env.DB.prepare("INSERT INTO notas (contratante_id, texto, criado) VALUES (?, ?, ?)").bind(atual.contratante_id, `Nota fiscal nº ${nf.numero_nota} emitida em ${dataBR(nf.emitida_em)} (R$ ${reaisTxt(atual.valor)}).`, agora())] : []),
      auditoria(env, req, "registrou nota fiscal emitida", "documento", id, nf.numero_nota),
    ]);
    return json(await detalhar(env, ler(await env.DB.prepare("SELECT * FROM documentos WHERE id = ?").bind(id).first())));
  }

  if (partes[2] === "cancelar" && metodo === "POST") {
    if (atual.situacao === "cancelado" || atual.situacao === "cancelada") return json(await detalhar(env, atual));
    const motivo = txt(corpo?.motivo, 300);
    if (!motivo) return json({ erro: "Diga o motivo do cancelamento." }, 400);
    const t = agora();
    const passos = [
      env.DB.prepare("UPDATE documentos SET situacao = ?, motivo_cancelamento = ?, lancado = 0, atualizado = ? WHERE id = ?").bind(atual.tipo === "recibo" ? "cancelado" : "cancelada", motivo, t, id),
      auditoria(env, req, `cancelou ${atual.tipo === "recibo" ? "recibo" : "nota fiscal"}`, "documento", id, motivo),
    ];
    // o recibo que somou no "recebido" do show tira o valor de volta
    if (atual.lancado && atual.show_id) passos.push(env.DB.prepare("UPDATE shows SET recebido = MAX(0, recebido - ?), atualizado = ? WHERE id = ?").bind(atual.valor, t, atual.show_id));
    if (atual.contratante_id) passos.push(env.DB.prepare("INSERT INTO notas (contratante_id, texto, criado) VALUES (?, ?, ?)").bind(atual.contratante_id, `${atual.tipo === "recibo" ? "Recibo " + numeroRecibo(atual.numero) : "Nota fiscal"} cancelado(a): ${motivo}.`, t));
    await env.DB.batch(passos);
    return json(await detalhar(env, ler(await env.DB.prepare("SELECT * FROM documentos WHERE id = ?").bind(id).first())));
  }

  return json({ erro: "Rota não encontrada." }, 404);
}

async function detalhar(env, d) {
  const config = await lerConfig(env);
  // enquanto o recibo não tiver os dados da 7A completos, vale o que está em Ajustes agora
  const emit = faltasEmitente(d.emitente, d.tipo).length ? emitenteDe(config) : d.emitente;
  const r = { ...d, emitente: emit, faltas_emitente: faltasEmitente(emit, d.tipo) };
  if (d.tipo === "nfse") {
    r.faltas = faltasNfse(d, d.nfse);
    r.texto_emissor = textoEmissor(d, d.nfse, emit);
    r.emissor = EMISSOR_NACIONAL;
  }
  return r;
}

// prévia do recibo: mostra como vai ficar, sem gravar nada e sem gastar número
async function previaRecibo(env, corpo) {
  const d = limparDocumento({ ...corpo, tipo: "recibo" });
  if (d.erro) return json(d, 400);
  if (!d.valor) return json({ erro: "Digite o valor recebido." }, 400);
  if (!d.pagador_nome) return json({ erro: "Digite o nome de quem pagou." }, 400);
  if (!d.referente) return json({ erro: "Diga a que se refere o pagamento." }, 400);
  const { n } = await env.DB.prepare("SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM documentos WHERE tipo = 'recibo'").first();
  const emit =emitenteDe(await lerConfig(env));
  return json({
    numero: numeroRecibo(n) + " (numerado ao emitir)",
    valor: d.valor,
    extenso: porExtenso(d.valor),
    data: d.data,
    forma: d.forma,
    referente: d.referente,
    pagador: { nome: d.pagador_nome, doc: formatarDocumento(d.pagador_doc), endereco: d.pagador_endereco, cidade: d.pagador_cidade },
    emitente: { nome: emit.nome, doc: formatarDocumento(emit.doc), endereco: emit.endereco, cidade: emit.cidade, responsavel: emit.responsavel },
    faltas: faltasEmitente(emit, "recibo"),
  });
}

async function criar(req, env, corpo) {
  const tipo = corpo?.tipo === "nfse" ? "nfse" : corpo?.tipo === "recibo" ? "recibo" : "";
  if (!tipo) return json({ erro: "Escolha recibo ou nota fiscal." }, 400);
  const d = limparDocumento(corpo);
  if (d.erro) return json(d, 400);
  let show = null;
  if (d.show_id) {
    show = await env.DB.prepare("SELECT * FROM shows WHERE id = ?").bind(d.show_id).first();
    if (!show) return json({ erro: "Show não encontrado." }, 404);
    if (!d.contratante_id) d.contratante_id = show.contratante_id || null;
  }
  const config = await lerConfig(env);
  const emitente = JSON.stringify(emitenteDe(config));
  const t = agora();
  const token = hex(crypto.getRandomValues(new Uint8Array(12)));

  if (tipo === "recibo") {
    if (!d.valor) return json({ erro: "Digite o valor recebido." }, 400);
    if (!d.pagador_nome) return json({ erro: "Digite o nome de quem pagou." }, 400);
    if (!d.data) return json({ erro: "Informe a data do pagamento." }, 400);
    if (d.data > hojeSP()) return json({ erro: "O recibo é de um pagamento já feito: a data não pode ser depois de hoje." }, 400);
    if (!d.referente) return json({ erro: "Diga a que se refere o pagamento." }, 400);
    const lancar = !!(corpo?.lancar_recebido && show);
    // número em sequência; se duas emissões baterem no mesmo número, tenta o seguinte
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const { n } = await env.DB.prepare("SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM documentos WHERE tipo = 'recibo'").first();
      try {
        const [ins] = await env.DB.batch([
          env.DB.prepare(
            `INSERT INTO documentos (tipo, numero, token, show_id, contratante_id, situacao, valor, data, forma, referente, pagador_nome, pagador_doc, pagador_endereco, pagador_cidade, pagador_email, emitente, nfse, lancado, obs, criado, atualizado)
             VALUES ('recibo', ?, ?, ?, ?, 'emitido', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?) RETURNING *`
          ).bind(n, token, d.show_id, d.contratante_id, d.valor, d.data, d.forma, d.referente, d.pagador_nome, d.pagador_doc, d.pagador_endereco, d.pagador_cidade, d.pagador_email, emitente, lancar ? 1 : 0, d.obs, t, t),
          ...(lancar ? [env.DB.prepare("UPDATE shows SET recebido = recebido + ?, atualizado = ? WHERE id = ?").bind(d.valor, t, d.show_id)] : []),
          ...(d.contratante_id ? [env.DB.prepare("INSERT INTO notas (contratante_id, texto, criado) VALUES (?, ?, ?)").bind(d.contratante_id, `Recibo ${numeroRecibo(n)} emitido: R$ ${reaisTxt(d.valor)}, pago em ${dataBR(d.data)}.`, t)] : []),
          ...guardarDocContratante(env, d),
          auditoria(env, req, "emitiu recibo", "documento", null, `${numeroRecibo(n)} R$ ${reaisTxt(d.valor)}`),
        ]);
        return json(await detalhar(env, ler(ins.results[0])));
      } catch (e) {
        if (!/UNIQUE/i.test(String(e?.message || e)) || tentativa === 2) throw e;
      }
    }
  }

  // nota fiscal: nasce como rascunho (falta algo) ou pronta para emitir; o número vem do Emissor Nacional depois
  const nf = limparNfse(corpo?.nfse);
  const situacao = faltasNfse(d, nf).length ? "rascunho" : "pronta";
  const [ins] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO documentos (tipo, numero, token, show_id, contratante_id, situacao, valor, data, forma, referente, pagador_nome, pagador_doc, pagador_endereco, pagador_cidade, pagador_email, emitente, nfse, lancado, obs, criado, atualizado)
       VALUES ('nfse', NULL, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?) RETURNING *`
    ).bind(token, d.show_id, d.contratante_id, situacao, d.valor, d.data, d.referente, d.pagador_nome, d.pagador_doc, d.pagador_endereco, d.pagador_cidade, d.pagador_email, emitente, JSON.stringify(nf), d.obs, t, t),
    ...guardarDocContratante(env, d),
    auditoria(env, req, "preparou nota fiscal", "documento", null, `R$ ${reaisTxt(d.valor)} para ${d.pagador_nome}`),
  ]);
  return json(await detalhar(env, ler(ins.results[0])));
}

// dados da 7A para recibos e notas (Ajustes): nada vem preenchido, só o que a equipe digita
export async function salvarEmitente(req, env, corpo) {
  const doc = validarDocumento(corpo?.emit_doc);
  if (!doc.ok) return json({ erro: "7A: " + doc.erro }, 400);
  const valores = {
    emit_nome: txt(corpo?.emit_nome, 160),
    emit_doc: doc.valor,
    emit_im: txt(corpo?.emit_im, 40),
    emit_endereco: txt(corpo?.emit_endereco, 240),
    emit_cidade: txt(corpo?.emit_cidade, 80),
    emit_responsavel: txt(corpo?.emit_responsavel, 120),
    emit_regime: Object.hasOwn(REGIMES, corpo?.emit_regime || "") ? corpo?.emit_regime || "" : "",
  };
  const up = "INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor";
  await env.DB.batch([
    ...Object.entries(valores).map(([k, v]) => env.DB.prepare(up).bind(k, v)),
    auditoria(env, req, "alterou os dados da 7A para documentos", "config", null, `${valores.emit_nome} ${valores.emit_doc}`),
  ]);
  return json({ ...(await lerConfig(env)), email_ativo: !!env.RESEND_API_KEY });
}

/* ---------------- recibo público (pelo link com token) ---------------- */

export async function reciboPublico(env, token) {
  if (!/^[a-f0-9]{24}$/.test(token)) return json({ erro: "Recibo não encontrado." }, 404);
  const linha = ler(await env.DB.prepare("SELECT * FROM documentos WHERE token = ? AND tipo = 'recibo'").bind(token).first());
  if (!linha) return json({ erro: "Recibo não encontrado." }, 404);
  let emit = linha.emitente;
  if (faltasEmitente(emit, "recibo").length) {
    emit = emitenteDe(await lerConfig(env));
    // os dados da 7A completos ficam gravados no recibo: mudar Ajustes depois não altera recibo já emitido
    if (!faltasEmitente(emit, "recibo").length) await env.DB.prepare("UPDATE documentos SET emitente = ? WHERE id = ?").bind(JSON.stringify(emit), linha.id).run();
  }
  return json({
    numero: numeroRecibo(linha.numero),
    situacao: linha.situacao,
    motivo_cancelamento: linha.situacao === "cancelado" ? linha.motivo_cancelamento : "",
    emitido: linha.criado.slice(0, 10),
    valor: linha.valor,
    extenso: porExtenso(linha.valor),
    data: linha.data,
    forma: linha.forma,
    referente: linha.referente,
    pagador: { nome: linha.pagador_nome, doc: formatarDocumento(linha.pagador_doc), endereco: linha.pagador_endereco, cidade: linha.pagador_cidade },
    emitente: { nome: emit.nome, doc: formatarDocumento(emit.doc), endereco: emit.endereco, cidade: emit.cidade, responsavel: emit.responsavel },
    faltas: faltasEmitente(emit, "recibo"),
  });
}
