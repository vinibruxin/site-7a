// Sistema de gestão da 7A: contratantes (funil), mensagens e campanhas pelo WhatsApp, shows com cachê e repasse, e ajustes.
// Tudo fica no D1 (binding DB). As rotas abaixo exigem login, exceto pedidoDoSite (formulário público) e propostaPublica.

import { agora, auditoria, dataBR, dataOk, hojeSP, json, lerConfig, prepararBanco, txt } from "./banco.js";
import { gravarUltimoCacheDoShow, NOMES_ETAPA, NOMES_PERFIL, rotasContratantes } from "./contratantes.js";
import { rotasMensagens, rotasModelos } from "./mensagens.js";
import { indicadores, rotasCampanhas } from "./campanhas.js";
import { rotasDocumentos, salvarEmitente } from "./documentos.js";
import { rotasMusicos } from "./musicos.js";

export { prepararBanco };
export const STATUS = ["consulta", "reservado", "confirmado", "realizado", "cancelado"];
const NOMES_STATUS = { consulta: "Consulta", reservado: "Reservado", confirmado: "Confirmado", realizado: "Realizado", cancelado: "Cancelado" };

const CAMPOS_SHOW = ["data", "hora", "hora_fim", "artista", "artista_texto", "contratante_id", "particular", "cep", "endereco", "numero", "complemento", "bairro", "uf", "referencia", "evento", "local", "cidade", "status", "cache", "pct", "despesas", "recebido", "repassado", "publicar", "link", "obs"];

const horaOk = (s) => (/^\d{2}:\d{2}$/.test(s || "") ? s : "");
const centavos = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n < 1e11 ? n : 0;
};
function linkSeguro(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : "";
  } catch {
    return "";
  }
}

function limparShow(s) {
  const pct = s?.pct === "" || s?.pct == null ? null : Number(s.pct);
  const particular = s?.particular ? 1 : 0;
  const r = {
    data: dataOk(s?.data),
    hora: horaOk(s?.hora),
    hora_fim: horaOk(s?.hora_fim),
    artista: /^[a-z0-9-]{0,60}$/.test(s?.artista || "") ? s.artista || "" : "",
    artista_texto: txt(s?.artista_texto, 120),
    // um show é de um contratante ou é particular (sem contratante); nunca os dois
    contratante_id: !particular && Number.isInteger(Number(s?.contratante_id)) && Number(s.contratante_id) > 0 ? Number(s.contratante_id) : null,
    particular,
    cep: txt(s?.cep, 9),
    endereco: txt(s?.endereco, 160),
    numero: txt(s?.numero, 20),
    complemento: txt(s?.complemento, 80),
    bairro: txt(s?.bairro, 80),
    uf: txt(s?.uf, 2).toUpperCase(),
    referencia: txt(s?.referencia, 300),
    evento: txt(s?.evento, 160),
    local: txt(s?.local, 160),
    cidade: txt(s?.cidade, 80),
    status: STATUS.includes(s?.status) ? s.status : "consulta",
    cache: centavos(s?.cache),
    pct: pct != null && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : null,
    despesas: centavos(s?.despesas),
    recebido: centavos(s?.recebido),
    repassado: centavos(s?.repassado),
    publicar: s?.publicar ? 1 : 0,
    link: linkSeguro(txt(s?.link, 500)),
    obs: txt(s?.obs, 4000),
  };
  if (!r.data && r.status !== "consulta") return { erro: "Só uma consulta pode ficar sem data. Preencha o dia do show." };
  if (!r.artista && !r.artista_texto) return { erro: "Escolha o artista do show." };
  if (r.hora_fim && !r.hora) return { erro: "Preencha a hora de início antes da hora de fim." };
  if (r.hora_fim && r.hora_fim === r.hora) return { erro: "A hora de fim precisa ser diferente da hora de início." };
  return r;
}

// mesma conta que o painel mostra: comissão sobre o cachê bruto ou sobre o que sobra depois das despesas
export function contas(s, config) {
  const pct = s.pct != null ? s.pct : config.pct_padrao === "" ? null : Number(config.pct_padrao);
  const base = config.base === "liquido" ? Math.max(0, s.cache - s.despesas) : s.cache;
  const comissao = pct == null ? null : Math.round((base * pct) / 100);
  const repasse = comissao == null ? null : s.cache - s.despesas - comissao;
  return { pct, comissao, repasse, falta_receber: s.cache - s.recebido, falta_repassar: repasse == null ? null : repasse - s.repassado };
}

// duração entre início e fim (passando da meia-noite conta como o dia seguinte): "3 horas", "2h30", "45 min"
export function duracaoTexto(inicio, fim) {
  if (!/^\d{2}:\d{2}$/.test(inicio || "") || !/^\d{2}:\d{2}$/.test(fim || "")) return "";
  const min = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const total = (min(fim) - min(inicio) + 1440) % 1440;
  if (!total) return "";
  const h = Math.floor(total / 60), m = total % 60;
  if (!h) return `${m} min`;
  if (!m) return h === 1 ? "1 hora" : `${h} horas`;
  return `${h}h${String(m).padStart(2, "0")}`;
}

/* ---------------- rotas com login ---------------- */

// quem = "equipe" (painel, com senha) ou "agente" (Évora, com token): o da Évora deixa a proposta aguardando aprovação
export async function gestao(req, env, rota, quem = "equipe") {
  await prepararBanco(env);
  const metodo = req.method;
  const partes = rota.split("/"); // ex.: ["contratantes", "12", "notas"]
  const id = Number(partes[1]);
  const corpo = metodo === "POST" || metodo === "PUT" ? await req.json().catch(() => ({})) : null;

  // carga inicial do painel: a lista completa de contratantes fica só com o essencial (a busca e a ficha vêm do servidor)
  if (rota === "dados" && metodo === "GET") {
    const h = hojeSP();
    const [cs, ss, fazer, config, nums] = await Promise.all([
      env.DB.prepare("SELECT id, nome, cidade, contato, telefone, email, etapa FROM contratantes WHERE arquivado = '' ORDER BY nome COLLATE NOCASE").all(),
      env.DB.prepare("SELECT * FROM shows ORDER BY data, hora").all(),
      env.DB.prepare("SELECT * FROM contratantes WHERE arquivado = '' AND proxima_data <> '' AND proxima_data <= ? AND etapa NOT IN ('fechado', 'perdido') ORDER BY proxima_data LIMIT 200").bind(h).all(),
      lerConfig(env),
      indicadores(env, 30),
    ]);
    const { results: campanhas } = await env.DB.prepare(
      `SELECT ca.id, ca.nome, ca.simulada, SUM(CASE WHEN d.situacao IN ('pendente', 'aberta') OR (d.situacao = 'aguardando' AND d.cobrar_em <= ?) THEN 1 ELSE 0 END) AS na_vez
       FROM campanhas ca LEFT JOIN campanha_destinatarios d ON d.campanha_id = ca.id WHERE ca.status = 'andamento' GROUP BY ca.id ORDER BY ca.criado`
    ).bind(h).all();
    return json({ contratantes: cs.results, shows: ss.results, fazer: fazer.results, campanhas, indicadores: nums, config: { ...config, email_ativo: !!env.RESEND_API_KEY } });
  }

  if (partes[0] === "contratantes") return rotasContratantes(req, env, partes, corpo, new URL(req.url));
  if (partes[0] === "mensagens") return rotasMensagens(req, env, partes, corpo);
  if (partes[0] === "modelos") return rotasModelos(req, env, partes, corpo);
  if (partes[0] === "campanhas") return rotasCampanhas(req, env, partes, corpo);
  // recibos e notas fiscais: só a equipe (o agente é barrado antes, em motivoAgente)
  if (partes[0] === "documentos") return rotasDocumentos(req, env, partes, corpo, new URL(req.url));
  // cadastro de artistas e músicos: só a equipe (o agente é barrado em motivoAgente)
  if (partes[0] === "musicos") return rotasMusicos(req, env, partes, corpo, new URL(req.url));
  if (rota === "emitente" && metodo === "PUT") return salvarEmitente(req, env, corpo);
  // fila de mensagens: rascunhos prontos para abrir e abertas aguardando a confirmação de envio
  if (rota === "fila" && metodo === "GET") {
    const [rascunhos, abertas, enviadas] = await Promise.all([
      env.DB.prepare("SELECT m.id, m.texto, m.criado, m.telefone, c.id AS contratante_id, c.nome, c.cidade, c.contato FROM mensagens m JOIN contratantes c ON c.id = m.contratante_id WHERE m.situacao = 'rascunho' ORDER BY m.criado DESC LIMIT 100").all(),
      env.DB.prepare("SELECT m.id, m.texto, m.criado, m.tipo, m.telefone, c.id AS contratante_id, c.nome FROM mensagens m JOIN contratantes c ON c.id = m.contratante_id WHERE m.situacao = 'aberta' ORDER BY m.criado DESC LIMIT 100").all(),
      env.DB.prepare("SELECT m.id, m.texto, m.atualizado, m.telefone, c.id AS contratante_id, c.nome FROM mensagens m JOIN contratantes c ON c.id = m.contratante_id WHERE m.situacao = 'enviada' ORDER BY m.atualizado DESC LIMIT 50").all(),
    ]);
    return json({ rascunhos: rascunhos.results, abertas: abertas.results, enviadas: enviadas.results });
  }
  if (rota === "indicadores" && metodo === "GET") {
    const dias = [7, 30, 90].includes(Number(new URL(req.url).searchParams.get("dias"))) ? Number(new URL(req.url).searchParams.get("dias")) : 30;
    return json(await indicadores(env, dias));
  }

  if (partes[0] === "notas" && metodo === "DELETE" && id) {
    const n = await env.DB.prepare("SELECT * FROM notas WHERE id = ?").bind(id).first();
    if (!n) return json({ ok: true });
    await env.DB.batch([
      env.DB.prepare("DELETE FROM notas WHERE id = ?").bind(id),
      auditoria(env, req, "apagou nota", "contratante", n.contratante_id, n.texto),
    ]);
    return json({ ok: true });
  }

  if (partes[0] === "shows" && partes[2] === "proposta" && partes[3] === "email" && id && metodo === "POST") return enviarProposta(env, req, id, corpo);
  // só a equipe aprova, pelo botão de aprovação: aprovar já envia a proposta por e-mail ao contratante
  if (partes[0] === "shows" && partes[2] === "proposta" && partes[3] === "aprovar" && id && metodo === "POST") return aprovarProposta(env, req, id);
  // proposta nova: a da Évora nasce aguardando; a da equipe nasce aprovada (como sempre foi)
  const situacao = quem === "agente" ? "aguardando_aprovacao" : "aprovada";

  if (partes[0] === "shows" && partes[2] === "proposta" && id) {
    if (metodo === "GET") return json((await env.DB.prepare("SELECT * FROM propostas WHERE show_id = ?").bind(id).first()) || {});
    if (metodo === "PUT") {
      const show = await env.DB.prepare("SELECT id, hora, hora_fim FROM shows WHERE id = ?").bind(id).first();
      if (!show) return json({ erro: "Salve o show antes de gerar a proposta." }, 404);
      const pr = {
        formato: txt(corpo?.formato, 160),
        // com início e fim no show, a duração é sempre a conta; sem eles, vale o texto enviado
        duracao: duracaoTexto(show.hora, show.hora_fim) || txt(corpo?.duracao, 160),
        inclui: txt(corpo?.inclui, 2000),
        rider: txt(corpo?.rider, 4000),
        condicoes: txt(corpo?.condicoes, 2000),
        validade: dataOk(corpo?.validade),
      };
      const t = agora();
      const token = hex(crypto.getRandomValues(new Uint8Array(12)));
      const linha = await env.DB.prepare(
        `INSERT INTO propostas (show_id, token, formato, duracao, inclui, rider, condicoes, validade, situacao, criado, atualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(show_id) DO UPDATE SET formato = excluded.formato, duracao = excluded.duracao, inclui = excluded.inclui, rider = excluded.rider,
         condicoes = excluded.condicoes, validade = excluded.validade, atualizado = excluded.atualizado,
         situacao = CASE WHEN excluded.situacao = 'aguardando_aprovacao' THEN 'aguardando_aprovacao' ELSE propostas.situacao END RETURNING *`
      ).bind(id, token, pr.formato, pr.duracao, pr.inclui, pr.rider, pr.condicoes, pr.validade, situacao, t, t).first();
      return json(linha);
    }
  }

  if (partes[0] === "shows") {
    if (metodo === "POST" && partes.length === 1) {
      const s = limparShow(corpo);
      if (s.erro) return json(s, 400);
      const t = agora();
      const linha = await env.DB.prepare(
        `INSERT INTO shows (${CAMPOS_SHOW.join(", ")}, criado, atualizado) VALUES (${CAMPOS_SHOW.map(() => "?").join(", ")}, ?, ?) RETURNING *`
      ).bind(...CAMPOS_SHOW.map((k) => s[k]), t, t).first();
      if (quem === "equipe") await gravarUltimoCacheDoShow(env, linha);
      return json(linha);
    }
    if (!id) return json({ erro: "Show não encontrado." }, 404);
    if (metodo === "PUT") {
      const s = limparShow(corpo);
      if (s.erro) return json(s, 400);
      const linha = await env.DB.prepare(`UPDATE shows SET ${CAMPOS_SHOW.map((k) => k + " = ?").join(", ")}, atualizado = ? WHERE id = ? RETURNING *`)
        .bind(...CAMPOS_SHOW.map((k) => s[k]), agora(), id)
        .first();
      // confirmar o show (feito pela equipe) grava o cachê como último cachê da casa
      if (linha && quem === "equipe") await gravarUltimoCacheDoShow(env, linha);
      return linha ? json(linha) : json({ erro: "Show não encontrado." }, 404);
    }
    if (metodo === "DELETE") {
      await env.DB.prepare("DELETE FROM shows WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
  }

  if (rota === "config" && metodo === "PUT") {
    const pct = corpo?.pct_padrao === "" || corpo?.pct_padrao == null ? "" : Number(corpo.pct_padrao);
    if (pct !== "" && !(Number.isFinite(pct) && pct >= 0 && pct <= 100)) return json({ erro: "O % precisa ficar entre 0 e 100." }, 400);
    const base = corpo?.base === "liquido" ? "liquido" : "bruto";
    const atual = await lerConfig(env);
    // % da 7A para artistas de fora do casting (padrão 30%)
    const fora = corpo?.pct_fora == null ? atual.pct_fora : corpo.pct_fora === "" ? "" : Number(corpo.pct_fora);
    if (fora !== "" && !(Number.isFinite(Number(fora)) && Number(fora) >= 0 && Number(fora) <= 100)) return json({ erro: "O % de artistas de fora precisa ficar entre 0 e 100." }, 400);
    const limite = corpo?.limite_diario == null ? Number(atual.limite_diario) : Math.round(Number(corpo.limite_diario));
    if (!(limite >= 1 && limite <= 250)) return json({ erro: "O limite diário precisa ficar entre 1 e 250 novas abordagens." }, 400);
    const intervalo = corpo?.intervalo_dias == null ? Number(atual.intervalo_dias) : Math.round(Number(corpo.intervalo_dias));
    if (!(intervalo >= 1 && intervalo <= 30)) return json({ erro: "O intervalo entre mensagens precisa ficar entre 1 e 30 dias." }, 400);
    const simulacao = corpo?.simulacao == null ? atual.simulacao : corpo.simulacao === true || corpo.simulacao === "1" ? "1" : "0";
    const up = "INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor";
    await env.DB.batch([
      env.DB.prepare(up).bind("pct_padrao", String(pct)),
      env.DB.prepare(up).bind("pct_fora", String(fora)),
      env.DB.prepare(up).bind("base", base),
      env.DB.prepare(up).bind("limite_diario", String(limite)),
      env.DB.prepare(up).bind("intervalo_dias", String(intervalo)),
      env.DB.prepare(up).bind("simulacao", simulacao),
      ...(simulacao !== atual.simulacao ? [auditoria(env, req, simulacao === "1" ? "ligou a simulação" : "desligou a simulação", "config", null)] : []),
    ]);
    return json({ ...(await lerConfig(env)), email_ativo: !!env.RESEND_API_KEY });
  }

  if (partes[0] === "exportar" && metodo === "GET") return exportar(env, req, partes[1]);

  return json({ erro: "Rota não encontrada." }, 404);
}

/* ---------------- envio da proposta por e-mail (Resend) ---------------- */

// remetente no domínio da 7A (verificado no Resend); as respostas vão para o Gmail da 7A
const REMETENTE = "7A Produtora <propostas@7aprodutora.com.br>";
const RESPONDER_PARA = "contato@7aprodutora.com.br";

// e-mail da proposta: saudação, parágrafos, a carta do artista e o botão (tabelas com estilo em linha, para os clientes de e-mail)
const SITE = "https://7aprodutora.com.br";
const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function montarEmailProposta({ token, artista, slug, contato, data, hora, local, cidade, mensagem }) {
  const e = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const link = SITE + "/proposta/" + token;
  const nome = (contato || "").trim().split(/\s+/)[0];
  let quando = "";
  if (data) {
    const [a, m, d] = data.split("-").map(Number);
    quando = `${DIAS_SEMANA[new Date(Date.UTC(a, m - 1, d)).getUTCDay()]}, ${d} de ${MESES_LONGOS[m - 1]}`;
    if (hora) quando += ` às ${hora.replace(":", "h")}`;
  }
  const onde = [local ? `no ${local}` : "", cidade ? `(${cidade})` : ""].filter(Boolean).join(" ");
  const recado = mensagem ? mensagem.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean) : [];
  const paragrafos = [
    nome ? `Olá, ${nome}!` : "Olá!",
    `Segue a proposta da 7A Produtora para o show de ${artista}${quando ? ` em ${quando}` : ""}${onde ? ` ${onde}` : ""}.`,
    ...recado,
    "Na proposta você encontra o formato, o que está incluso, as condições de pagamento e um botão para salvar em PDF.",
    "Qualquer dúvida, é só responder este e-mail ou chamar no WhatsApp (31) 99223-3295.",
    "Um abraço,\nEquipe 7A Produtora",
  ];
  const k = CASTING[slug] || {};
  const foto = k.foto ? `<img src="${SITE}${k.foto}" width="240" alt="${e(artista)}" style="display:block;width:240px;max-width:100%;height:auto;border:0">` : "";
  const carta = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="260" style="width:260px;background:#2B2B2B">
    <tr><td style="padding:10px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #F2D27C">
        <tr><td style="padding:12px 12px 0;font:400 22px/1 Impact,'Arial Narrow',sans-serif;color:#F2EFEA">7A<br><span style="color:#B5121B;font-size:12px;line-height:1.4">&#9670;</span></td></tr>
        <tr><td align="center" style="padding:12px 12px 0">${foto}</td></tr>
        <tr><td style="padding:14px 14px 0;font:400 34px/1 Impact,'Arial Narrow',sans-serif;text-transform:uppercase;color:#F2EFEA">${e(artista)}</td></tr>
        ${k.genero ? `<tr><td style="padding:6px 14px 0;font:400 13px/1.4 Montserrat,Arial,sans-serif;color:#B8B2AA">${e(k.genero)}</td></tr>` : ""}
        <tr><td style="padding:12px 14px 16px;font:700 12px/1 'Courier New',monospace;letter-spacing:.06em;color:#F2EFEA">${k.serie ? `SÉRIE ${e(k.serie)}` : ""}</td></tr>
      </table>
    </td></tr>
  </table>`;
  const html = `<div style="background:#0A0A0A;padding:32px 20px;font-family:Montserrat,Arial,sans-serif;color:#F2EFEA">
  <div style="max-width:560px;margin:0 auto">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle"><img src="${SITE}/img/logo-7a-g.png" width="48" alt="7A" style="display:block;border:0"></td>
      <td style="vertical-align:middle;padding-left:12px;font:400 24px/1 Impact,'Arial Narrow',sans-serif;text-transform:uppercase;color:#F2EFEA">7A Produtora</td>
    </tr></table>
    <div style="margin:32px 0 28px">${paragrafos.map((t) => `<p style="font-size:16px;line-height:1.6;margin:0 0 16px;white-space:pre-line">${e(t)}</p>`).join("")}</div>
    ${carta}
    <p style="margin:28px 0 0"><a href="${e(link)}" style="display:inline-block;background:#B5121B;color:#F2EFEA;font-weight:700;font-size:16px;line-height:1;padding:18px 26px;text-decoration:none">Ver a proposta</a></p>
    <p style="font-size:13px;line-height:1.6;color:#B8B2AA;margin:36px 0 0">(31) 99223-3295 · contato@7aprodutora.com.br<br>7aprodutora.com.br · @7a_produtora<br>Aqui o artista é levado a sério.</p>
  </div></div>`;
  const text = `${paragrafos.join("\n\n")}\n\nVer a proposta: ${link}\n\n(31) 99223-3295 · contato@7aprodutora.com.br\n7aprodutora.com.br · @7a_produtora`;
  return { html, text };
}

// aprovação da equipe: marca a proposta como aprovada e, se a casa tem e-mail e o envio está ligado, manda na hora
async function aprovarProposta(env, req, id) {
  const atual = await env.DB.prepare(
    "SELECT p.show_id, c.email AS email FROM propostas p JOIN shows s ON s.id = p.show_id LEFT JOIN contratantes c ON c.id = s.contratante_id WHERE p.show_id = ?"
  ).bind(id).first();
  if (!atual) return json({ erro: "Gere a proposta antes de aprovar." }, 404);
  await env.DB.prepare("UPDATE propostas SET situacao = 'aprovada', atualizado = ? WHERE show_id = ?").bind(agora(), id).run();
  if (!atual.email) {
    return json({ ok: true, situacao: "aprovada", enviada: false, motivo: "A proposta está aprovada, mas a casa não tem e-mail cadastrado. Envie o link pelo WhatsApp." });
  }
  const r = await enviarProposta(env, req, id, { para: atual.email });
  if (r.status !== 200) {
    const dados = await r.json().catch(() => ({}));
    return json({ ok: true, situacao: "aprovada", enviada: false, motivo: dados.erro || "Não deu para enviar o e-mail. Tente pelo botão de envio." });
  }
  return json({ ok: true, situacao: "aprovada", enviada: true, para: atual.email });
}

async function enviarProposta(env, req, id, corpo) {
  if (!env.RESEND_API_KEY) return json({ erro: "O envio por e-mail ainda não está ligado. Falta a chave do Resend na Cloudflare." }, 503);
  const para = txt(corpo?.para, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) return json({ erro: "Confira o e-mail do contratante." }, 400);
  const mensagem = txt(corpo?.mensagem, 2000);
  const p = await env.DB.prepare(
    `SELECT p.token, p.situacao, s.artista, s.artista_texto, s.data, s.hora, s.local, s.cidade, s.particular, s.contratante_id, c.contato AS contato
     FROM propostas p JOIN shows s ON s.id = p.show_id LEFT JOIN contratantes c ON c.id = s.contratante_id WHERE p.show_id = ?`
  ).bind(id).first();
  if (!p) return json({ erro: "Gere a proposta antes de enviar." }, 404);
  if (p.situacao !== "aprovada") return json({ erro: "Esta proposta ainda aguarda aprovação. Revise e salve no painel antes de enviar." }, 409);
  const artista = (await nomesArtistas(env, req))[p.artista] || p.artista_texto || p.artista;
  const { html, text } = montarEmailProposta({ token: p.token, artista, slug: p.artista, contato: p.contato, data: p.data, hora: p.hora, local: p.particular ? "Particular" : p.local, cidade: p.cidade, mensagem });
  let r;
  try {
    r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: "Bearer " + env.RESEND_API_KEY, "content-type": "application/json" },
      body: JSON.stringify({
        from: REMETENTE,
        to: [para],
        reply_to: RESPONDER_PARA,
        subject: `Proposta de show: ${artista} | 7A Produtora`,
        html,
        text,
      }),
    });
  } catch {
    return json({ erro: "Não deu para falar com o Resend agora. Tente de novo em alguns minutos." }, 502);
  }
  if (!r.ok) {
    const detalhe = await r.json().catch(() => ({}));
    return json({ erro: "O Resend recusou o envio: " + (detalhe.message || r.status) }, 502);
  }
  // registra no histórico do contratante
  if (p.contratante_id) {
    const t = agora();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO notas (contratante_id, texto, criado) VALUES (?, ?, ?)").bind(p.contratante_id, `Proposta de ${artista} enviada por e-mail para ${para}.`, t),
      env.DB.prepare("UPDATE contratantes SET atualizado = ? WHERE id = ?").bind(t, p.contratante_id),
    ]);
  }
  return json({ ok: true });
}

/* ---------------- planilha (CSV para Excel e Google Planilhas) ---------------- */

// nomes dos artistas como estão no /admin (ou no conteúdo inicial do site)
async function nomesArtistas(env, req) {
  let c = await env.CONTEUDO.get("conteudo", "json");
  if (!c) {
    const r = await env.ASSETS.fetch(new Request(new URL("/dados/padrao.json", req.url)));
    c = r.ok ? await r.json() : {};
  }
  return Object.fromEntries(Object.entries(c.artistas || {}).map(([slug, a]) => [slug, a.nome]));
}

async function exportar(env, req, qual) {
  const reais = (c) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));
  let linhas;
  if (qual === "contratantes.csv") {
    const { results } = await env.DB.prepare("SELECT * FROM contratantes ORDER BY nome").all();
    linhas = [["Nome", "Tipo", "Contato", "Telefone", "WhatsApp (55+DDD)", "E-mail", "Instagram", "CEP", "Rua", "Número", "Complemento", "Bairro", "Cidade", "UF", "Referência", "Perfil musical", "Etapa", "Comunicação", "Bloqueado em", "Próxima ação", "Data da próxima ação", "Origem", "Observações", "Criado em", "Arquivado em"]];
    const origens = { site: "Site", csv: "Importação CSV" };
    for (const c of results) linhas.push([c.nome, c.tipo, c.contato, c.telefone, c.telefone_norm, c.email, c.instagram, c.cep, c.endereco, c.numero, c.complemento, c.bairro, c.cidade, c.uf, c.referencia, NOMES_PERFIL[c.perfil] || "", NOMES_ETAPA[c.etapa] || c.etapa, c.comunicacao === "bloqueado" ? "Bloqueado (pediu para parar)" : "Livre", c.bloqueado_em.slice(0, 10), c.proxima_acao, c.proxima_data, origens[c.origem] || "Manual", c.obs, c.criado.slice(0, 10), c.arquivado]);
  } else if (qual === "shows.csv") {
    const [{ results }, config, cs, art] = await Promise.all([
      env.DB.prepare("SELECT * FROM shows ORDER BY data, hora").all(),
      lerConfig(env),
      env.DB.prepare("SELECT id, nome FROM contratantes").all(),
      nomesArtistas(env, req),
    ]);
    const nomes = Object.fromEntries(cs.results.map((c) => [c.id, c.nome]));
    linhas = [["Data", "Início", "Fim", "Duração", "Artista", "Contratante", "Evento", "Local", "Cidade", "Status", "Cachê", "% 7A", "Despesas", "Comissão 7A", "Repasse ao artista", "Recebido", "Repassado", "Falta receber", "Falta repassar", "Observações"]];
    for (const s of results) {
      const k = contas(s, config);
      linhas.push([s.data, s.hora, s.hora_fim || "", duracaoTexto(s.hora, s.hora_fim), art[s.artista] || s.artista_texto || s.artista, nomes[s.contratante_id] || "", s.evento, s.local, s.cidade, NOMES_STATUS[s.status] || s.status, reais(s.cache), k.pct == null ? "" : String(k.pct).replace(".", ","), reais(s.despesas), reais(k.comissao), reais(k.repasse), reais(s.recebido), reais(s.repassado), reais(k.falta_receber), reais(k.falta_repassar), s.obs]);
    }
  } else return json({ erro: "Planilha não encontrada." }, 404);

  // ponto e vírgula e BOM: o Excel em português abre com acentos e colunas certas
  const celula = (v) => {
    let s = String(v ?? "");
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmula escondida em texto digitado no site
    return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = "﻿" + linhas.map((l) => l.map(celula).join(";")).join("\r\n");
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="7a-${qual}"`,
      "cache-control": "no-store",
    },
  });
}

/* ---------------- pedido do formulário do site (público) ---------------- */

const LIMITE_IP_HORA = 5;
const LIMITE_DIA = 100;
// tipo do contratante a partir do que a pessoa escolheu no site (home e página de evento particular)
const TIPO_DO_EVENTO = {
  "Bar ou casa de show": "casa",
  Festival: "festival",
  "Evento de empresa": "empresa",
  "Confraternização de empresa": "empresa",
  "Festa particular": "particular",
  Aniversário: "particular",
  Casamento: "particular",
  Formatura: "particular",
  "Festa em casa": "particular",
};

// duração entre início e fim (fim antes do início passa da meia-noite), ex.: "3 h 30 min"
export function duracaoShow(inicio, fim) {
  const min = (h) => +h.slice(0, 2) * 60 + +h.slice(3, 5);
  let d = min(fim) - min(inicio);
  if (d <= 0) d += 1440;
  const h = Math.floor(d / 60), m = d % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}

export async function pedidoDoSite(req, env) {
  await prepararBanco(env);
  const p = await req.json().catch(() => ({}));
  const nome = txt(p?.nome, 120);
  const artista = txt(p?.artista, 80);
  const evento = txt(p?.evento, 80);
  const cidade = txt(p?.cidade, 80);
  const data = dataOk(p?.data);
  if (!artista || !evento) return json({ ok: false }, 400);

  const ip = req.headers.get("cf-connecting-ip") || "local";
  const assinatura = [nome, artista, evento, cidade, data, String(p?.local || "").slice(0, 120)].join("|").toLowerCase();
  const umaHora = new Date(Date.now() - 3600e3).toISOString();
  const umDia = new Date(Date.now() - 86400e3).toISOString();
  const [porIp, repetido, noDia] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) n FROM pedidos_ip WHERE ip = ? AND quando > ?").bind(ip, umaHora),
    env.DB.prepare("SELECT COUNT(*) n FROM pedidos_ip WHERE ip = ? AND assinatura = ? AND quando > ?").bind(ip, assinatura, umDia),
    env.DB.prepare("SELECT COUNT(*) n FROM pedidos_ip WHERE quando > ?").bind(umDia),
  ]);
  // mesmo pedido clicado duas vezes, ou excesso: responde ok sem gravar de novo
  if (porIp.results[0].n >= LIMITE_IP_HORA || repetido.results[0].n > 0 || noDia.results[0].n >= LIMITE_DIA) return json({ ok: true });

  // página de evento particular manda também horário, convidados e local
  const hora = (x) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(x || "") ? x : "");
  const inicio = hora(p?.inicio), fim = hora(p?.fim);
  const horario = inicio && fim ? `${inicio} às ${fim} (${duracaoShow(inicio, fim)})` : inicio || (fim ? `até ${fim}` : "");
  const convidados = txt(p?.convidados, 20);
  const local = txt(p?.local, 120);

  const t = agora();
  const tipo = TIPO_DO_EVENTO[evento] || (p?.particular ? "particular" : "outro");
  const detalhe = [
    `Pedido pelo site: ${artista}`,
    `Evento: ${evento}`,
    data ? `Data: ${data.split("-").reverse().join("/")}` : "",
    horario ? `Horário: ${horario}` : "",
    cidade ? `Cidade: ${cidade}` : "",
    local ? `Local: ${local}` : "",
    convidados ? `Convidados: ${convidados}` : "",
  ].filter(Boolean).join(". ");
  const titulo = nome || `Pedido do site (${cidade || evento})`;
  const c = await env.DB.prepare(
    `INSERT INTO contratantes (nome, tipo, contato, cidade, etapa, proxima_acao, proxima_data, origem, obs, criado, atualizado)
     VALUES (?, ?, ?, ?, 'contatar', 'Responder pedido do site no WhatsApp', ?, 'site', '', ?, ?) RETURNING id`
  ).bind(titulo, tipo, nome, cidade, t.slice(0, 10), t, t).first();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO notas (contratante_id, texto, criado) VALUES (?, ?, ?)").bind(c.id, detalhe + ".", t),
    // quem pede pelo site autoriza o contato sobre o pedido; fica a prova
    env.DB.prepare("INSERT INTO consentimentos (contratante_id, situacao, origem, prova, criado) VALUES (?, 'pediu_contato', 'site', ?, ?)").bind(c.id, `Pedido pelo site em ${dataBR(hojeSP())}`, t),
    env.DB.prepare("INSERT INTO pedidos_ip (ip, quando, assinatura) VALUES (?, ?, ?)").bind(ip, t, assinatura),
    env.DB.prepare("DELETE FROM pedidos_ip WHERE quando < ?").bind(umDia),
  ]);
  return json({ ok: true });
}

/* ---------------- proposta (pública, pelo link com token) ---------------- */

// dados de cada artista que o site já mostra nas cartas do casting
export const CASTING = {
  "ordem-mor": { genero: "Rock autoral", serie: "7A-001", formato: "Banda completa", foto: "/img/ordem-mor.jpg", foco: "50% 100%", claro: true },
  "sub-rosa": { genero: "Rock progressivo autoral", serie: "7A-002", formato: "Banda completa", foto: "/img/sub-rosa.jpg", foco: "50% 50%" },
  "ossos-do-banquete": { genero: "Rock Clássico / Autoral", serie: "7A-003", formato: "Banda completa", foto: "/img/ossos.jpg", foco: "47% 50%" },
  "athos-tibaes": { genero: "MPB e pop rock, voz e violão", serie: "7A-004", formato: "Voz e violão", foto: "/img/athos.jpg", foco: "50% 25%" },
  aenima: { genero: "Clássicos do rock em versões acústicas", serie: "7A-005", formato: "Duo acústico", foto: "/img/aenima.jpg", foco: "50% 30%", claro: true },
  "dj-ivan-lennon": { genero: "Pop e pop rock na pista", serie: "7A-006", formato: "Cabine de DJ", foto: "/img/dj-ivan.jpg", foco: "55% 40%" },
};

export async function propostaPublica(req, env, token) {
  if (!/^[a-f0-9]{24}$/.test(token)) return json({ erro: "Proposta não encontrada." }, 404);
  await prepararBanco(env);
  const p = await env.DB.prepare(
    `SELECT p.*, s.data, s.hora, s.hora_fim, s.artista, s.artista_texto, s.evento, s.local, s.cidade, s.particular, s.cache, s.status, c.nome AS contratante, c.contato
     FROM propostas p JOIN shows s ON s.id = p.show_id LEFT JOIN contratantes c ON c.id = s.contratante_id WHERE p.token = ? AND p.situacao = 'aprovada'`
  ).bind(token).first();
  if (!p || p.status === "cancelado") return json({ erro: "Proposta não encontrada." }, 404);
  let conteudo = await env.CONTEUDO.get("conteudo", "json");
  if (!conteudo) {
    const r = await env.ASSETS.fetch(new Request(new URL("/dados/padrao.json", req.url)));
    conteudo = r.ok ? await r.json() : {};
  }
  const a = conteudo.artistas?.[p.artista] || {};
  const k = CASTING[p.artista] || {};
  return json({
    numero: "7A-P-" + String(p.show_id).padStart(4, "0"),
    emitida: p.atualizado.slice(0, 10),
    contratante: p.contratante || "",
    contato: p.contato || "",
    artista: {
      slug: CASTING[p.artista] ? p.artista : "",
      nome: a.nome || p.artista_texto || p.artista,
      genero: k.genero || "",
      serie: k.serie || "",
      foto: k.foto || "",
      foco: k.foco || "50% 50%",
      claro: !!k.claro,
      chamada: a.chamada || "",
      resumo: (a.resumo || [])[0] || "",
      destaques: (a.destaques || []).slice(0, 4),
      formacao: (a.formacao || []).filter((f) => f.nome),
    },
    data: p.data, hora: p.hora, hora_fim: p.hora_fim || "", evento: p.evento, local: p.particular ? "Particular" : p.local, cidade: p.cidade, cache: p.cache,
    // com início e fim no show, a duração da proposta é sempre a conta entre os dois
    formato: p.formato, duracao: duracaoTexto(p.hora, p.hora_fim) || p.duracao, inclui: p.inclui, rider: p.rider, condicoes: p.condicoes, validade: p.validade,
  });
}

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

/* ---------------- agenda pública ---------------- */

// shows confirmados (ou já realizados) marcados para aparecer no site, de hoje em diante
export async function showsPublicos(env, hoje) {
  await prepararBanco(env);
  const { results } = await env.DB.prepare(
    "SELECT data, hora, artista, artista_texto, evento, local, cidade, link FROM shows WHERE publicar = 1 AND status IN ('confirmado', 'realizado') AND data >= ? ORDER BY data, hora"
  ).bind(hoje).all();
  return results;
}
