// Banco D1 e utilidades comuns da gestão: migrações, datas no fuso de Betim, auditoria e respostas JSON.

import { MIGRACOES } from "./esquema.js";

let pronto = null;
export function prepararBanco(env) {
  if (!pronto) pronto = migrar(env).catch((e) => { pronto = null; throw e; });
  return pronto;
}

// aplica, em ordem, as migrações que faltam; uma migração que parou no meio roda de novo inteira (os passos são idempotentes)
export async function migrar(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS esquema_versao (versao INTEGER PRIMARY KEY, nome TEXT NOT NULL, aplicada TEXT NOT NULL)").run();
  const { results } = await env.DB.prepare("SELECT versao FROM esquema_versao").all();
  const feitas = new Set(results.map((r) => r.versao));
  for (const m of MIGRACOES) {
    if (feitas.has(m.versao)) continue;
    for (const passo of m.passos) {
      if (typeof passo === "function") await passo(env);
      else await env.DB.prepare(passo).run();
    }
    await env.DB.prepare("INSERT OR IGNORE INTO esquema_versao (versao, nome, aplicada) VALUES (?, ?, ?)").bind(m.versao, m.nome, new Date().toISOString()).run();
  }
  return MIGRACOES[MIGRACOES.length - 1].versao;
}

export const agora = () => new Date().toISOString();
export const txt = (s, n = 400) => String(s ?? "").trim().slice(0, n);
export const dataOk = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s || "") ? s : "");

// data de hoje no fuso de Betim (America/Sao_Paulo), no formato AAAA-MM-DD
export const hojeSP = (ms = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(ms));
// instante (ISO, UTC) em que começou um dia em Betim (UTC-3, sem horário de verão desde 2019)
export const inicioDoDia = (data) => new Date(`${data}T00:00:00-03:00`).toISOString();
export function somarDias(data, n) {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
export const dataBR = (data) => (data ? data.slice(0, 10).split("-").reverse().join("/") : "");

// registro de auditoria, para entrar no mesmo batch da mudança
export function auditoria(env, req, acao, entidade, id, detalhe = "") {
  const ip = req?.headers?.get?.("cf-connecting-ip") || "";
  return env.DB.prepare("INSERT INTO auditoria (quando, acao, entidade, entidade_id, detalhe, ip) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(agora(), acao, entidade, id ?? null, String(detalhe).slice(0, 2000), ip);
}

// configurações com padrão
export const CONFIG_PADRAO = { pct_padrao: "", base: "bruto", limite_diario: "20", intervalo_dias: "3", simulacao: "0" };
export async function lerConfig(env) {
  const { results } = await env.DB.prepare("SELECT chave, valor FROM config").all();
  const c = { ...CONFIG_PADRAO };
  for (const l of results) c[l.chave] = l.valor;
  return c;
}

export function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
