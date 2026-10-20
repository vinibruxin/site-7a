// Sistema de gestão da 7A: contratantes (funil), notas, shows com cachê e repasse, e ajustes.
// Tudo fica no D1 (binding DB). As rotas abaixo exigem login, exceto pedidoDoSite (formulário público).

import { ESQUEMA } from "./esquema.js";

export const ETAPAS = ["contatar", "contatado", "negociando", "fechado", "perdido"];
export const TIPOS = ["casa", "festival", "evento", "empresa", "particular", "outro"];
export const STATUS = ["consulta", "reservado", "confirmado", "realizado", "cancelado"];
const NOMES_ETAPA = { contatar: "A contatar", contatado: "Contatado", negociando: "Negociando", fechado: "Fechado", perdido: "Perdido" };
const NOMES_STATUS = { consulta: "Consulta", reservado: "Reservado", confirmado: "Confirmado", realizado: "Realizado", cancelado: "Cancelado" };

const CAMPOS_CONTRATANTE = ["nome", "tipo", "contato", "telefone", "email", "instagram", "cidade", "etapa", "proxima_acao", "proxima_data", "obs"];
const CAMPOS_SHOW = ["data", "hora", "artista", "artista_texto", "contratante_id", "evento", "local", "cidade", "status", "cache", "pct", "despesas", "recebido", "repassado", "publicar", "link", "obs"];

let pronto = null;
export function prepararBanco(env) {
  if (!pronto) pronto = env.DB.batch(ESQUEMA.map((s) => env.DB.prepare(s))).catch((e) => { pronto = null; throw e; });
  return pronto;
}

const agora = () => new Date().toISOString();
const txt = (s, n = 400) => String(s ?? "").trim().slice(0, n);
const dataOk = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : "");
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

function limparContratante(c) {
  const r = {
    nome: txt(c?.nome, 120),
    tipo: TIPOS.includes(c?.tipo) ? c.tipo : "outro",
    contato: txt(c?.contato, 120),
    telefone: txt(c?.telefone, 40),
    email: txt(c?.email, 160),
    instagram: txt(c?.instagram, 80).replace(/^@/, ""),
    cidade: txt(c?.cidade, 80),
    etapa: ETAPAS.includes(c?.etapa) ? c.etapa : "contatar",
    proxima_acao: txt(c?.proxima_acao, 200),
    proxima_data: dataOk(c?.proxima_data),
    obs: txt(c?.obs, 4000),
  };
  return r.nome ? r : { erro: "Dê um nome ao contratante (a casa, o evento ou a empresa)." };
}

function limparShow(s) {
  const pct = s?.pct === "" || s?.pct == null ? null : Number(s.pct);
  const r = {
    data: dataOk(s?.data),
    hora: horaOk(s?.hora),
    artista: /^[a-z0-9-]{0,60}$/.test(s?.artista || "") ? s.artista || "" : "",
    artista_texto: txt(s?.artista_texto, 120),
    contratante_id: Number.isInteger(Number(s?.contratante_id)) && Number(s.contratante_id) > 0 ? Number(s.contratante_id) : null,
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
  return r;
}

async function lerConfig(env) {
  const { results } = await env.DB.prepare("SELECT chave, valor FROM config").all();
  const c = { pct_padrao: "", base: "bruto" };
  for (const l of results) c[l.chave] = l.valor;
  return c;
}

// mesma conta que o painel mostra: comissão sobre o cachê bruto ou sobre o que sobra depois das despesas
export function contas(s, config) {
  const pct = s.pct != null ? s.pct : config.pct_padrao === "" ? null : Number(config.pct_padrao);
  const base = config.base === "liquido" ? Math.max(0, s.cache - s.despesas) : s.cache;
  const comissao = pct == null ? null : Math.round((base * pct) / 100);
  const repasse = comissao == null ? null : s.cache - s.despesas - comissao;
  return { pct, comissao, repasse, falta_receber: s.cache - s.recebido, falta_repassar: repasse == null ? null : repasse - s.repassado };
}

/* ---------------- rotas com login ---------------- */

export async function gestao(req, env, rota) {
  await prepararBanco(env);
  const metodo = req.method;
  const partes = rota.split("/"); // ex.: ["contratantes", "12", "notas"]
  const id = Number(partes[1]);
  const corpo = metodo === "POST" || metodo === "PUT" ? await req.json().catch(() => ({})) : null;

  if (rota === "dados" && metodo === "GET") {
    const [cs, ss, config] = await Promise.all([
      env.DB.prepare("SELECT * FROM contratantes ORDER BY atualizado DESC").all(),
      env.DB.prepare("SELECT * FROM shows ORDER BY data, hora").all(),
      lerConfig(env),
    ]);
    return json({ contratantes: cs.results, shows: ss.results, config });
  }

  if (partes[0] === "contratantes") {
    if (metodo === "POST" && partes.length === 1) {
      const c = limparContratante(corpo);
      if (c.erro) return json(c, 400);
      const t = agora();
      const linha = await env.DB.prepare(
        `INSERT INTO contratantes (${CAMPOS_CONTRATANTE.join(", ")}, origem, criado, atualizado) VALUES (${CAMPOS_CONTRATANTE.map(() => "?").join(", ")}, 'manual', ?, ?) RETURNING *`
      ).bind(...CAMPOS_CONTRATANTE.map((k) => c[k]), t, t).first();
      return json(linha);
    }
    if (!id) return json({ erro: "Contratante não encontrado." }, 404);
    if (partes[2] === "notas") {
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
    if (metodo === "PUT") {
      const c = limparContratante(corpo);
      if (c.erro) return json(c, 400);
      const linha = await env.DB.prepare(
        `UPDATE contratantes SET ${CAMPOS_CONTRATANTE.map((k) => k + " = ?").join(", ")}, atualizado = ? WHERE id = ? RETURNING *`
      ).bind(...CAMPOS_CONTRATANTE.map((k) => c[k]), agora(), id).first();
      return linha ? json(linha) : json({ erro: "Contratante não encontrado." }, 404);
    }
    if (metodo === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM notas WHERE contratante_id = ?").bind(id),
        env.DB.prepare("UPDATE shows SET contratante_id = NULL WHERE contratante_id = ?").bind(id),
        env.DB.prepare("DELETE FROM contratantes WHERE id = ?").bind(id),
      ]);
      return json({ ok: true });
    }
  }

  if (partes[0] === "notas" && metodo === "DELETE" && id) {
    await env.DB.prepare("DELETE FROM notas WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }

  if (partes[0] === "shows") {
    if (metodo === "POST" && partes.length === 1) {
      const s = limparShow(corpo);
      if (s.erro) return json(s, 400);
      const t = agora();
      const linha = await env.DB.prepare(
        `INSERT INTO shows (${CAMPOS_SHOW.join(", ")}, criado, atualizado) VALUES (${CAMPOS_SHOW.map(() => "?").join(", ")}, ?, ?) RETURNING *`
      ).bind(...CAMPOS_SHOW.map((k) => s[k]), t, t).first();
      return json(linha);
    }
    if (!id) return json({ erro: "Show não encontrado." }, 404);
    if (metodo === "PUT") {
      const s = limparShow(corpo);
      if (s.erro) return json(s, 400);
      const linha = await env.DB.prepare(`UPDATE shows SET ${CAMPOS_SHOW.map((k) => k + " = ?").join(", ")}, atualizado = ? WHERE id = ? RETURNING *`)
        .bind(...CAMPOS_SHOW.map((k) => s[k]), agora(), id)
        .first();
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
    const up = "INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor";
    await env.DB.batch([env.DB.prepare(up).bind("pct_padrao", String(pct)), env.DB.prepare(up).bind("base", base)]);
    return json(await lerConfig(env));
  }

  if (partes[0] === "exportar" && metodo === "GET") return exportar(env, req, partes[1]);

  return json({ erro: "Rota não encontrada." }, 404);
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
    linhas = [["Nome", "Tipo", "Contato", "Telefone", "E-mail", "Instagram", "Cidade", "Etapa", "Próxima ação", "Data da próxima ação", "Origem", "Observações", "Criado em"]];
    for (const c of results) linhas.push([c.nome, c.tipo, c.contato, c.telefone, c.email, c.instagram, c.cidade, NOMES_ETAPA[c.etapa] || c.etapa, c.proxima_acao, c.proxima_data, c.origem === "site" ? "Site" : "Manual", c.obs, c.criado.slice(0, 10)]);
  } else if (qual === "shows.csv") {
    const [{ results }, config, cs, art] = await Promise.all([
      env.DB.prepare("SELECT * FROM shows ORDER BY data, hora").all(),
      lerConfig(env),
      env.DB.prepare("SELECT id, nome FROM contratantes").all(),
      nomesArtistas(env, req),
    ]);
    const nomes = Object.fromEntries(cs.results.map((c) => [c.id, c.nome]));
    linhas = [["Data", "Hora", "Artista", "Contratante", "Evento", "Local", "Cidade", "Status", "Cachê", "% 7A", "Despesas", "Comissão 7A", "Repasse ao artista", "Recebido", "Repassado", "Falta receber", "Falta repassar", "Observações"]];
    for (const s of results) {
      const k = contas(s, config);
      linhas.push([s.data, s.hora, art[s.artista] || s.artista_texto || s.artista, nomes[s.contratante_id] || "", s.evento, s.local, s.cidade, NOMES_STATUS[s.status] || s.status, reais(s.cache), k.pct == null ? "" : String(k.pct).replace(".", ","), reais(s.despesas), reais(k.comissao), reais(k.repasse), reais(s.recebido), reais(s.repassado), reais(k.falta_receber), reais(k.falta_repassar), s.obs]);
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
  const assinatura = [nome, artista, evento, cidade, data].join("|").toLowerCase();
  const umaHora = new Date(Date.now() - 3600e3).toISOString();
  const umDia = new Date(Date.now() - 86400e3).toISOString();
  const [porIp, repetido, noDia] = await env.DB.batch([
    env.DB.prepare("SELECT COUNT(*) n FROM pedidos_ip WHERE ip = ? AND quando > ?").bind(ip, umaHora),
    env.DB.prepare("SELECT COUNT(*) n FROM pedidos_ip WHERE ip = ? AND assinatura = ? AND quando > ?").bind(ip, assinatura, umDia),
    env.DB.prepare("SELECT COUNT(*) n FROM pedidos_ip WHERE quando > ?").bind(umDia),
  ]);
  // mesmo pedido clicado duas vezes, ou excesso: responde ok sem gravar de novo
  if (porIp.results[0].n >= LIMITE_IP_HORA || repetido.results[0].n > 0 || noDia.results[0].n >= LIMITE_DIA) return json({ ok: true });

  const t = agora();
  const tipo = { "Bar ou casa de show": "casa", Festival: "festival", "Evento de empresa": "empresa", "Festa particular": "particular" }[evento] || "outro";
  const detalhe = [`Pedido pelo site: ${artista}`, `Evento: ${evento}`, data ? `Data: ${data.split("-").reverse().join("/")}` : "", cidade ? `Cidade: ${cidade}` : ""].filter(Boolean).join(". ");
  const titulo = nome || `Pedido do site (${cidade || evento})`;
  const c = await env.DB.prepare(
    `INSERT INTO contratantes (nome, tipo, contato, cidade, etapa, proxima_acao, proxima_data, origem, obs, criado, atualizado)
     VALUES (?, ?, ?, ?, 'contatar', 'Responder pedido do site no WhatsApp', ?, 'site', '', ?, ?) RETURNING id`
  ).bind(titulo, tipo, nome, cidade, t.slice(0, 10), t, t).first();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO notas (contratante_id, texto, criado) VALUES (?, ?, ?)").bind(c.id, detalhe + ".", t),
    env.DB.prepare("INSERT INTO pedidos_ip (ip, quando, assinatura) VALUES (?, ?, ?)").bind(ip, t, assinatura),
    env.DB.prepare("DELETE FROM pedidos_ip WHERE quando < ?").bind(umDia),
  ]);
  return json({ ok: true });
}

/* ---------------- agenda pública ---------------- */

// shows confirmados (ou já realizados) marcados para aparecer no site, de hoje em diante
export async function showsPublicos(env, hoje) {
  await prepararBanco(env);
  const { results } = await env.DB.prepare(
    "SELECT data, hora, artista, artista_texto, evento, local, cidade, link FROM shows WHERE publicar = 1 AND status IN ('confirmado', 'realizado') AND data >= ? ORDER BY data, hora"
  ).bind(hoje).all();
  return results;
}

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
