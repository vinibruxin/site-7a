// Contratantes: cadastro com telefone normalizado e sem duplicidade, busca e paginação no servidor,
// autorização de contato (bloqueio quando pedem para parar), arquivamento e importação por CSV.

import { agora, auditoria, dataBR, dataOk, hojeSP, json, txt } from "./banco.js";
import { normalizarTelefone, formatarTelefone } from "./telefone.js";
import { lerCSV, mapearColunas, perfilDoTexto, tipoDoTexto } from "./csv.js";

export const ETAPAS = ["contatar", "contatado", "negociando", "fechado", "perdido"];
export const TIPOS = ["casa", "restaurante", "festival", "evento", "empresa", "particular", "outro"];
export const PERFIS = ["autoral", "classicos", "ambos"];
export const NOMES_ETAPA = { contatar: "A contatar", contatado: "Contatado", negociando: "Negociando", fechado: "Fechado", perdido: "Perdido" };
export const NOMES_PERFIL = { "": "Não definido", autoral: "Som autoral", classicos: "Clássicos do rock", ambos: "Autoral e clássicos" };

export const CAMPOS_CONTRATANTE = ["nome", "tipo", "contato", "telefone", "telefone_norm", "email", "instagram", "cep", "endereco", "numero", "complemento", "bairro", "cidade", "uf", "referencia", "perfil", "etapa", "proxima_acao", "proxima_data", "obs"];
const MAX_IMPORTACAO = 1000;
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export function limparContratante(c) {
  const tel = normalizarTelefone(txt(c?.telefone, 40));
  const r = {
    nome: txt(c?.nome, 120),
    tipo: TIPOS.includes(c?.tipo) ? c.tipo : "outro",
    contato: txt(c?.contato, 120),
    telefone: tel.ok && tel.numero ? formatarTelefone(tel.numero) : txt(c?.telefone, 40),
    telefone_norm: tel.ok ? tel.numero : "",
    email: txt(c?.email, 160).toLowerCase(),
    instagram: txt(c?.instagram, 80).replace(/^@/, ""),
    endereco: txt(c?.endereco, 200),
    numero: txt(c?.numero, 20),
    complemento: txt(c?.complemento, 120),
    bairro: txt(c?.bairro, 80),
    uf: txt(c?.uf, 2).toUpperCase(),
    cep: txt(c?.cep, 12),
    referencia: txt(c?.referencia, 300),
    cidade: txt(c?.cidade, 80),
    perfil: PERFIS.includes(c?.perfil) ? c.perfil : "",
    etapa: ETAPAS.includes(c?.etapa) ? c.etapa : "contatar",
    proxima_acao: txt(c?.proxima_acao, 200),
    proxima_data: dataOk(c?.proxima_data),
    obs: txt(c?.obs, 4000),
  };
  if (!r.nome) return { erro: "Dê um nome ao contratante (a casa, o evento ou a empresa)." };
  if (!tel.ok) return { erro: tel.erro, campo: "telefone" };
  if (r.email && !emailOk(r.email)) return { erro: "Confira o e-mail: está fora do formato nome@dominio.com.", campo: "email" };
  return r;
}

// outro contratante com o mesmo telefone (normalizado) ou o mesmo e-mail, inclusive arquivado
async function duplicado(env, r, idAtual = 0) {
  if (r.telefone_norm) {
    const x = await env.DB.prepare("SELECT id, nome, arquivado FROM contratantes WHERE telefone_norm = ? AND id <> ?").bind(r.telefone_norm, idAtual).first();
    if (x) return { ...x, campo: "telefone", erro: `Este telefone já está no cadastro de ${x.nome}${x.arquivado ? " (arquivado)" : ""}.` };
  }
  if (r.email) {
    const x = await env.DB.prepare("SELECT id, nome, arquivado FROM contratantes WHERE email = ? AND id <> ?").bind(r.email, idAtual).first();
    if (x) return { ...x, campo: "email", erro: `Este e-mail já está no cadastro de ${x.nome}${x.arquivado ? " (arquivado)" : ""}.` };
  }
  return null;
}
const respostaDuplicado = (d) => json({ erro: d.erro, campo: d.campo, existente: { id: d.id, nome: d.nome, arquivado: d.arquivado } }, 409);
const ehUnico = (e) => /UNIQUE constraint/i.test(String(e?.message || e));

/* ---------------- rotas ---------------- */

export async function rotasContratantes(req, env, partes, corpo, url) {
  const metodo = req.method;
  const id = Number(partes[1]);
  const acao = partes[2];

  if (partes.length === 1 && metodo === "GET") return listar(env, url);
  if (partes.length === 1 && metodo === "POST") return criar(env, req, corpo);
  if (partes[1] === "importar" && metodo === "POST") return importar(env, req, corpo);
  if (!Number.isInteger(id) || id <= 0) return json({ erro: "Contratante não encontrado." }, 404);
  const c = await env.DB.prepare("SELECT * FROM contratantes WHERE id = ?").bind(id).first();
  if (!c) return json({ erro: "Contratante não encontrado." }, 404);

  if (!acao && metodo === "GET") return ficha(env, c);
  if (!acao && metodo === "PUT") return atualizar(env, req, c, corpo);
  if (!acao && metodo === "DELETE") return arquivar(env, req, c);
  if (acao === "restaurar" && metodo === "POST") return restaurar(env, req, c);
  if (acao === "respondeu" && metodo === "POST") return respondeu(env, req, c);
  if (acao === "parar" && metodo === "POST") return parar(env, req, c, corpo);
  if (acao === "desbloquear" && metodo === "POST") return desbloquear(env, req, c, corpo);
  if (acao === "notas") {
    if (metodo === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM notas WHERE contratante_id = ? ORDER BY criado DESC").bind(id).all();
      return json(results);
    }
    if (metodo === "POST") {
      const texto = txt(corpo?.texto, 4000);
      if (!texto) return json({ erro: "Escreva a anotação antes de salvar." }, 400);
      const t = agora();
      const [nota] = await env.DB.batch([
        env.DB.prepare("INSERT INTO notas (contratante_id, texto, criado) VALUES (?, ?, ?) RETURNING *").bind(id, texto, t),
        env.DB.prepare("UPDATE contratantes SET atualizado = ? WHERE id = ?").bind(t, id),
      ]);
      return json(nota.results[0]);
    }
  }
  return json({ erro: "Rota não encontrada." }, 404);
}

// lista com busca, filtros e paginação; contagens por etapa para os botões de filtro
async function listar(env, url) {
  const q = url.searchParams;
  const por = Math.min(100, Math.max(1, Number(q.get("por")) || 50));
  const pagina = Math.max(1, Number(q.get("pagina")) || 1);
  const onde = [], args = [];
  onde.push(q.get("arquivados") === "1" ? "arquivado <> ''" : "arquivado = ''");
  const busca = txt(q.get("busca"), 80).toLowerCase();
  if (busca) {
    const digitos = busca.replace(/\D/g, "");
    onde.push(`(instr(lower(nome), ?) > 0 OR instr(lower(cidade), ?) > 0 OR instr(lower(contato), ?) > 0 OR instr(lower(email), ?) > 0${digitos.length >= 4 ? " OR instr(telefone_norm, ?) > 0" : ""})`);
    args.push(busca, busca, busca, busca);
    if (digitos.length >= 4) args.push(digitos);
  }
  const perfil = q.get("perfil");
  if (PERFIS.includes(perfil)) { onde.push("perfil = ?"); args.push(perfil); }
  else if (perfil === "nenhum") onde.push("perfil = ''");
  const tipo = q.get("tipo");
  if (TIPOS.includes(tipo)) { onde.push("tipo = ?"); args.push(tipo); }
  const cidade = txt(q.get("cidade"), 80).toLowerCase();
  if (cidade) { onde.push("lower(cidade) = ?"); args.push(cidade); }
  if (q.get("bloqueados") === "1") onde.push("comunicacao = 'bloqueado'");
  const semEtapa = "WHERE " + onde.join(" AND ");
  const etapa = q.get("etapa");
  const comEtapa = ETAPAS.includes(etapa) ? `${semEtapa} AND etapa = ?` : semEtapa;
  const argsEtapa = ETAPAS.includes(etapa) ? [...args, etapa] : args;
  const [itens, total, contagens, cidades] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM contratantes ${comEtapa} ORDER BY proxima_data = '', proxima_data, nome COLLATE NOCASE LIMIT ? OFFSET ?`).bind(...argsEtapa, por, (pagina - 1) * por),
    env.DB.prepare(`SELECT COUNT(*) n FROM contratantes ${comEtapa}`).bind(...argsEtapa),
    env.DB.prepare(`SELECT etapa, COUNT(*) n FROM contratantes ${semEtapa} GROUP BY etapa`).bind(...args),
    env.DB.prepare("SELECT DISTINCT cidade FROM contratantes WHERE arquivado = '' AND cidade <> '' ORDER BY cidade COLLATE NOCASE"),
  ]);
  return json({
    itens: itens.results,
    total: total.results[0].n,
    pagina,
    por,
    contagens: Object.fromEntries(contagens.results.map((r) => [r.etapa, r.n])),
    cidades: cidades.results.map((r) => r.cidade),
  });
}

async function ficha(env, c) {
  const [mensagens, eventos, consent, campanhas] = await env.DB.batch([
    env.DB.prepare("SELECT m.*, mo.nome AS modelo FROM mensagens m LEFT JOIN modelos mo ON mo.id = m.modelo_id WHERE m.contratante_id = ? ORDER BY m.criado DESC LIMIT 100").bind(c.id),
    env.DB.prepare("SELECT * FROM eventos WHERE contratante_id = ? ORDER BY criado DESC LIMIT 100").bind(c.id),
    env.DB.prepare("SELECT * FROM consentimentos WHERE contratante_id = ? ORDER BY criado DESC LIMIT 20").bind(c.id),
    env.DB.prepare(
      `SELECT d.situacao, d.etapa, d.cobrar_em, ca.id, ca.nome, ca.status FROM campanha_destinatarios d JOIN campanhas ca ON ca.id = d.campanha_id
       WHERE d.contratante_id = ? ORDER BY ca.criado DESC`
    ).bind(c.id),
  ]);
  return json({ contratante: c, mensagens: mensagens.results, eventos: eventos.results, consentimentos: consent.results, campanhas: campanhas.results });
}

async function criar(env, req, corpo) {
  const r = limparContratante(corpo);
  if (r.erro) return json(r, 400);
  const d = await duplicado(env, r);
  if (d) return respostaDuplicado(d);
  const t = agora();
  try {
    const linha = await env.DB.prepare(
      `INSERT INTO contratantes (${CAMPOS_CONTRATANTE.join(", ")}, origem, criado, atualizado) VALUES (${CAMPOS_CONTRATANTE.map(() => "?").join(", ")}, 'manual', ?, ?) RETURNING *`
    ).bind(...CAMPOS_CONTRATANTE.map((k) => r[k]), t, t).first();
    await auditoria(env, req, "criou", "contratante", linha.id, linha.nome).run();
    return json(linha);
  } catch (e) {
    if (ehUnico(e)) return json({ erro: "Este telefone já está cadastrado em outro contratante." }, 409);
    throw e;
  }
}

async function atualizar(env, req, c, corpo) {
  const r = limparContratante(corpo);
  if (r.erro) return json(r, 400);
  const d = await duplicado(env, r, c.id);
  if (d) return respostaDuplicado(d);
  try {
    const [linha] = await env.DB.batch([
      env.DB.prepare(`UPDATE contratantes SET ${CAMPOS_CONTRATANTE.map((k) => k + " = ?").join(", ")}, atualizado = ? WHERE id = ? RETURNING *`)
        .bind(...CAMPOS_CONTRATANTE.map((k) => r[k]), agora(), c.id),
      ...(c.telefone_norm !== r.telefone_norm ? [auditoria(env, req, "trocou telefone", "contratante", c.id, `${c.telefone_norm || "(vazio)"} -> ${r.telefone_norm || "(vazio)"}`)] : []),
    ]);
    return json(linha.results[0]);
  } catch (e) {
    if (ehUnico(e)) return json({ erro: "Este telefone já está cadastrado em outro contratante." }, 409);
    throw e;
  }
}

// "apagar" arquiva: some das listas e campanhas, mas o histórico fica guardado
async function arquivar(env, req, c) {
  if (c.arquivado) return json({ ok: true });
  const t = agora();
  await env.DB.batch([
    env.DB.prepare("UPDATE contratantes SET arquivado = ?, atualizado = ? WHERE id = ?").bind(hojeSP(), t, c.id),
    env.DB.prepare("UPDATE campanha_destinatarios SET situacao = 'cancelado', motivo = 'Contratante arquivado', atualizado = ? WHERE contratante_id = ? AND situacao IN ('pendente', 'aguardando')").bind(t, c.id),
    auditoria(env, req, "arquivou", "contratante", c.id, c.nome),
  ]);
  return json({ ok: true });
}

async function restaurar(env, req, c) {
  const t = agora();
  const [linha] = await env.DB.batch([
    env.DB.prepare("UPDATE contratantes SET arquivado = '', atualizado = ? WHERE id = ? RETURNING *").bind(t, c.id),
    auditoria(env, req, "restaurou", "contratante", c.id, c.nome),
  ]);
  return json(linha.results[0]);
}

// a casa respondeu: negociação, fora das cobranças e das campanhas pendentes, próxima ação definida
export async function respondeu(env, req, c) {
  const recente = await env.DB.prepare("SELECT id FROM eventos WHERE contratante_id = ? AND tipo = 'respondeu' AND criado > ?")
    .bind(c.id, new Date(Date.now() - 60e3).toISOString()).first();
  if (recente) return json(await env.DB.prepare("SELECT * FROM contratantes WHERE id = ?").bind(c.id).first()); // toque repetido
  const t = agora(), h = hojeSP();
  const [linha] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE contratantes SET etapa = CASE WHEN etapa IN ('contatar', 'contatado') THEN 'negociando' ELSE etapa END,
       proxima_acao = 'Responder e mandar a proposta', proxima_data = ?, atualizado = ? WHERE id = ? RETURNING *`
    ).bind(h, t, c.id),
    env.DB.prepare(
      "UPDATE campanha_destinatarios SET situacao = 'respondeu', atualizado = ? WHERE contratante_id = ? AND situacao IN ('pendente', 'aberta', 'aguardando', 'enviada', 'cobrada')"
    ).bind(t, c.id),
    env.DB.prepare("INSERT INTO eventos (contratante_id, tipo, criado) VALUES (?, 'respondeu', ?)").bind(c.id, t),
    env.DB.prepare("INSERT INTO consentimentos (contratante_id, situacao, origem, prova, criado) VALUES (?, 'conversa', 'operador', ?, ?)").bind(c.id, `Respondeu no WhatsApp em ${dataBR(h)}`, t),
    env.DB.prepare("INSERT INTO notas (contratante_id, texto, criado) VALUES (?, ?, ?)").bind(c.id, "Respondeu no WhatsApp. Próximo passo: responder e mandar a proposta.", t),
  ]);
  return json(linha.results[0]);
}

// pediu para parar: bloqueio imediato, sai de todas as campanhas
export async function parar(env, req, c, corpo) {
  if (c.comunicacao === "bloqueado") return json(c);
  const t = agora(), h = hojeSP();
  const prova = txt(corpo?.detalhe, 300) || `Pediu para parar em ${dataBR(h)}`;
  const [linha] = await env.DB.batch([
    env.DB.prepare("UPDATE contratantes SET comunicacao = 'bloqueado', bloqueado_em = ?, proxima_acao = '', proxima_data = '', atualizado = ? WHERE id = ? RETURNING *").bind(t, t, c.id),
    env.DB.prepare("UPDATE campanha_destinatarios SET situacao = 'bloqueado', motivo = 'Pediu para parar', atualizado = ? WHERE contratante_id = ? AND situacao IN ('pendente', 'aberta', 'aguardando')").bind(t, c.id),
    env.DB.prepare("INSERT INTO eventos (contratante_id, tipo, detalhe, criado) VALUES (?, 'pediu_parar', ?, ?)").bind(c.id, prova, t),
    env.DB.prepare("INSERT INTO consentimentos (contratante_id, situacao, origem, prova, criado) VALUES (?, 'bloqueado', 'operador', ?, ?)").bind(c.id, prova, t),
    env.DB.prepare("INSERT INTO notas (contratante_id, texto, criado) VALUES (?, ?, ?)").bind(c.id, `Pediu para não receber mais mensagens. Contato bloqueado. (${prova})`, t),
    auditoria(env, req, "bloqueou", "contratante", c.id, prova),
  ]);
  return json(linha.results[0]);
}

// só com confirmação explícita e motivo; fica na auditoria
async function desbloquear(env, req, c, corpo) {
  if (c.comunicacao !== "bloqueado") return json(c);
  const motivo = txt(corpo?.motivo, 300);
  if (corpo?.confirmo !== true || motivo.length < 5) return json({ erro: "Para desbloquear, confirme e escreva o motivo (por exemplo: \"pediu para voltar a receber em 10/11\")." }, 400);
  const t = agora();
  const [linha] = await env.DB.batch([
    env.DB.prepare("UPDATE contratantes SET comunicacao = 'livre', bloqueado_em = '', atualizado = ? WHERE id = ? RETURNING *").bind(t, c.id),
    env.DB.prepare("INSERT INTO eventos (contratante_id, tipo, detalhe, criado) VALUES (?, 'desbloqueado', ?, ?)").bind(c.id, motivo, t),
    env.DB.prepare("INSERT INTO consentimentos (contratante_id, situacao, origem, prova, criado) VALUES (?, 'livre', 'operador', ?, ?)").bind(c.id, motivo, t),
    env.DB.prepare("INSERT INTO notas (contratante_id, texto, criado) VALUES (?, ?, ?)").bind(c.id, `Contato desbloqueado: ${motivo}`, t),
    auditoria(env, req, "desbloqueou", "contratante", c.id, motivo),
  ]);
  return json(linha.results[0]);
}

/* ---------------- importação por CSV ---------------- */

// confere o arquivo; com confirmar: true grava as linhas aceitas (sem marcar contato nem consentimento)
async function importar(env, req, corpo) {
  const texto = String(corpo?.csv ?? "");
  if (!texto.trim()) return json({ erro: "O arquivo está vazio." }, 400);
  if (texto.length > 2_000_000) return json({ erro: "O arquivo é grande demais. Divida em partes de até 1.000 linhas." }, 400);
  const linhas = lerCSV(texto);
  if (linhas.length < 2) return json({ erro: "O arquivo precisa da linha de títulos e de pelo menos um contato." }, 400);
  const mapa = mapearColunas(linhas[0]);
  if (!("nome" in mapa)) return json({ erro: "Não achei a coluna do nome. A primeira linha precisa ter os títulos, como Nome; Contato; Telefone; Cidade." }, 400);
  const dados = linhas.slice(1);
  if (dados.length > MAX_IMPORTACAO) return json({ erro: `O arquivo tem ${dados.length} linhas. O limite é ${MAX_IMPORTACAO} por importação.` }, 400);

  const { results: existentes } = await env.DB.prepare("SELECT nome, cidade, telefone_norm, email FROM contratantes").all();
  const telBanco = new Map(existentes.filter((x) => x.telefone_norm).map((x) => [x.telefone_norm, x.nome]));
  const emailBanco = new Map(existentes.filter((x) => x.email).map((x) => [x.email.toLowerCase(), x.nome]));
  // sem telefone nem e-mail, o que identifica a casa é o nome com a cidade
  const nomeCidade = (r) => (r.nome + "|" + r.cidade).toLowerCase();
  const nomeBanco = new Set(existentes.map(nomeCidade));
  const telArquivo = new Map(), emailArquivo = new Map(), nomeArquivo = new Map();
  const aceitas = [], recusadas = [];
  dados.forEach((l, i) => {
    const n = i + 2; // linha no arquivo (1 é o título)
    const v = (campo) => (campo in mapa ? l[mapa[campo]] ?? "" : "");
    const bruto = {
      nome: v("nome"), contato: v("contato"), telefone: v("telefone"), email: v("email"), cidade: v("cidade"), uf: v("uf"),
      tipo: tipoDoTexto(v("tipo")), perfil: perfilDoTexto(v("perfil")), instagram: v("instagram"), obs: v("obs"),
    };
    const nome = txt(bruto.nome, 120);
    const recusa = (motivo) => recusadas.push({ linha: n, nome: nome || "(sem nome)", motivo });
    if (!nome) return recusa("Sem nome");
    const r = limparContratante(bruto);
    if (r.erro) return recusa(r.campo === "telefone" ? "Telefone inválido" : r.campo === "email" ? "E-mail inválido" : r.erro);
    if (r.telefone_norm && telArquivo.has(r.telefone_norm)) return recusa(`Telefone repetido no arquivo (linha ${telArquivo.get(r.telefone_norm)})`);
    if (r.telefone_norm && telBanco.has(r.telefone_norm)) return recusa(`Telefone já cadastrado (${telBanco.get(r.telefone_norm)})`);
    if (r.email && emailArquivo.has(r.email)) return recusa(`E-mail repetido no arquivo (linha ${emailArquivo.get(r.email)})`);
    if (r.email && emailBanco.has(r.email)) return recusa(`E-mail já cadastrado (${emailBanco.get(r.email)})`);
    if (!r.telefone_norm && !r.email) {
      if (nomeArquivo.has(nomeCidade(r))) return recusa(`Repetido no arquivo (linha ${nomeArquivo.get(nomeCidade(r))})`);
      if (nomeBanco.has(nomeCidade(r))) return recusa("Já cadastrado (mesmo nome e cidade)");
      nomeArquivo.set(nomeCidade(r), n);
    }
    if (r.telefone_norm) telArquivo.set(r.telefone_norm, n);
    if (r.email) emailArquivo.set(r.email, n);
    // importar não diz nada sobre o andamento: entra sempre como "a contatar", sem próxima ação
    aceitas.push({ ...r, etapa: "contatar", proxima_acao: "", proxima_data: "", linha: n });
  });

  const resumo = { total: dados.length, entram: aceitas.length, recusadas, colunas: Object.keys(mapa), amostra: aceitas.slice(0, 5).map(({ nome, contato, telefone, cidade }) => ({ nome, contato, telefone, cidade })) };
  if (corpo?.confirmar !== true) return json(resumo);
  if (!aceitas.length) return json({ ...resumo, inseridos: 0 });

  const t = agora();
  const sql = `INSERT OR IGNORE INTO contratantes (${CAMPOS_CONTRATANTE.join(", ")}, origem, criado, atualizado) VALUES (${CAMPOS_CONTRATANTE.map(() => "?").join(", ")}, 'csv', ?, ?)`;
  let inseridos = 0;
  for (let i = 0; i < aceitas.length; i += 100) {
    const lote = aceitas.slice(i, i + 100).map((r) => env.DB.prepare(sql).bind(...CAMPOS_CONTRATANTE.map((k) => r[k]), t, t));
    const res = await env.DB.batch(lote);
    inseridos += res.reduce((s, x) => s + (x.meta?.changes || 0), 0);
  }
  await auditoria(env, req, "importou CSV", "contratante", null, `${inseridos} contatos entraram, ${recusadas.length} linhas recusadas`).run();
  return json({ ...resumo, inseridos });
}
