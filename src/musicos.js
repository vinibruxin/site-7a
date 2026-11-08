// Cadastro de artistas e músicos (casting da 7A e de fora): nome artístico, WhatsApp, chave Pix, cidade, estilo e formação.
// Serve de agenda única para achar quem toca o quê e chamar no WhatsApp ou pagar no Pix.
// Regras: só a equipe (painel com senha) lê e grava; o agente Évora é barrado em motivoAgente; nada daqui vai para o site
// público, para a carga inicial do painel (/api/gestao/dados) nem para planilhas. Sem auto-cadastro.

import { agora, auditoria, json, lerConfig, txt } from "./banco.js";
import { formatarTelefone, normalizarTelefone } from "./telefone.js";
import { validarDocumento } from "./documentos.js";

export const TIPOS_PIX = ["cpf", "cnpj", "celular", "email", "aleatoria"];

// "Violão" e "violao" são a mesma coisa na busca
export const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// instrumentos: lista sem repetição (ignora maiúsculas e acento), até 20, cada um com até 40 letras
export function limparInstrumentos(v) {
  const lista = Array.isArray(v) ? v : String(v ?? "").split(/[,;\n]/);
  const vistos = new Set();
  const r = [];
  for (const i of lista) {
    const t = txt(i, 40).replace(/\s+/g, " ");
    if (!t || vistos.has(semAcento(t))) continue;
    vistos.add(semAcento(t));
    r.push(t[0].toUpperCase() + t.slice(1));
    if (r.length === 20) break;
  }
  return r;
}

// chave Pix conferida pelo tipo: { ok, valor } ou { ok: false, erro }. Vazia vale (o artista pode não ter passado ainda).
export function validarPix(tipo, chave) {
  const bruto = String(chave ?? "").trim();
  if (!bruto) return { ok: true, tipo: "", valor: "" };
  if (!TIPOS_PIX.includes(tipo)) return { ok: false, erro: "Escolha o tipo da chave Pix." };
  if (tipo === "cpf" || tipo === "cnpj") {
    const d = validarDocumento(bruto);
    if (!d.ok) return { ok: false, erro: "Chave Pix: " + d.erro.charAt(0).toLowerCase() + d.erro.slice(1) };
    if (d.tipo !== tipo) return { ok: false, erro: tipo === "cpf" ? "Chave Pix: isto não é um CPF (11 números)." : "Chave Pix: isto não é um CNPJ (14 caracteres)." };
    return { ok: true, tipo, valor: d.valor };
  }
  if (tipo === "celular") {
    const t = normalizarTelefone(bruto);
    if (!t.ok || !t.numero) return { ok: false, erro: "Chave Pix: " + (t.erro || "celular inválido.") };
    return { ok: true, tipo, valor: "+" + t.numero };
  }
  if (tipo === "email") {
    const e = bruto.toLowerCase();
    if (e.length > 77 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, erro: "Chave Pix: confira o e-mail." };
    return { ok: true, tipo, valor: e };
  }
  const a = bruto.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(a)) return { ok: false, erro: "Chave Pix aleatória tem 32 letras e números com hífens, como 1a2b3c4d-...; confira." };
  return { ok: true, tipo, valor: a };
}

// link de convite do grupo do WhatsApp (https://chat.whatsapp.com/...)
export function validarGrupo(v) {
  const t = String(v ?? "").trim();
  if (!t) return { ok: true, valor: "" };
  const m = t.match(/^(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,40})\/?(?:\?.*)?$/);
  if (!m) return { ok: false, erro: "Grupo do WhatsApp: cole o link de convite do grupo, que começa com https://chat.whatsapp.com/" };
  return { ok: true, valor: "https://chat.whatsapp.com/" + m[1] };
}

// % da 7A sobre o cachê do artista: o que vier preenchido, ou o padrão do grupo (casting: % padrão; de fora: % de fora, 30%)
export function pctDoArtista(m, config) {
  const v = m?.pct === "" || m?.pct == null ? null : Number(String(m.pct).replace(",", "."));
  if (v != null) return Number.isFinite(v) && v >= 0 && v <= 100 ? { ok: true, pct: v } : { ok: false, erro: "O % da 7A precisa ficar entre 0 e 100." };
  const padrao = m?.casting ? config.pct_padrao : config.pct_fora;
  return { ok: true, pct: padrao === "" || padrao == null ? null : Number(padrao) };
}

function limpar(m, config) {
  const nome = txt(m?.nome, 120);
  if (!nome) return { erro: "Digite o nome artístico." };
  const t = normalizarTelefone(m?.telefone);
  if (!t.ok) return { erro: t.erro };
  const pix = validarPix(m?.pix_tipo, m?.pix_chave);
  if (!pix.ok) return { erro: pix.erro };
  const pct = pctDoArtista(m, config);
  if (!pct.ok) return { erro: pct.erro };
  const grupo = validarGrupo(m?.grupo);
  if (!grupo.ok) return { erro: grupo.erro };
  return {
    grupo: grupo.valor,
    pct: pct.pct,
    nome,
    telefone: t.numero,
    pix_tipo: pix.tipo,
    pix_chave: pix.valor,
    cidade: txt(m?.cidade, 80),
    estilo: txt(m?.estilo, 160),
    instrumentos: JSON.stringify(limparInstrumentos(m?.instrumentos)),
    casting: m?.casting ? 1 : 0,
    obs: txt(m?.obs, 4000),
  };
}

const saida = (l) => ({ ...l, instrumentos: JSON.parse(l.instrumentos || "[]"), casting: !!l.casting, telefone_formatado: formatarTelefone(l.telefone) });

// busca: nome, instrumento ou cidade, sem acento; vários termos precisam bater todos ("guitarra betim")
export function filtrar(lista, { q = "", instrumento = "", cidade = "", casting = "" } = {}) {
  const termos = semAcento(q).split(/\s+/).filter(Boolean);
  const inst = semAcento(instrumento);
  const cid = semAcento(cidade);
  return lista.filter((m) => {
    const insts = m.instrumentos.map(semAcento);
    if (inst && !insts.some((i) => i.includes(inst))) return false;
    if (cid && semAcento(m.cidade) !== cid) return false;
    if (casting === "sim" && !m.casting) return false;
    if (casting === "nao" && m.casting) return false;
    const onde = [m.nome, m.cidade, m.estilo, ...insts].map(semAcento).join(" | ");
    return termos.every((t) => onde.includes(t));
  });
}

export async function rotasMusicos(req, env, partes, corpo, url) {
  const metodo = req.method;
  const id = Number(partes[1]);
  const buscar = (mid) => env.DB.prepare("SELECT * FROM musicos WHERE id = ?").bind(mid).first();

  if (partes.length === 1 && metodo === "GET") {
    const { results } = await env.DB.prepare("SELECT * FROM musicos ORDER BY casting DESC, nome COLLATE NOCASE").all();
    const p = url.searchParams;
    return json(filtrar(results.map(saida), { q: p.get("q") || "", instrumento: p.get("instrumento") || "", cidade: p.get("cidade") || "", casting: p.get("casting") || "" }));
  }

  if (partes.length === 1 && metodo === "POST") {
    const m = limpar(corpo, await lerConfig(env));
    if (m.erro) return json(m, 400);
    if (m.telefone) {
      const igual = await env.DB.prepare("SELECT id, nome FROM musicos WHERE telefone = ?").bind(m.telefone).first();
      if (igual) return json({ erro: `Este WhatsApp já está no cadastro de ${igual.nome}.`, existente: igual }, 409);
    }
    const t = agora();
    const novo = await env.DB.prepare(
      `INSERT INTO musicos (nome, telefone, pix_tipo, pix_chave, cidade, estilo, instrumentos, casting, pct, grupo, obs, criado, atualizado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(m.nome, m.telefone, m.pix_tipo, m.pix_chave, m.cidade, m.estilo, m.instrumentos, m.casting, m.pct, m.grupo, m.obs, t, t).first();
    // a auditoria guarda só o nome: telefone e Pix não vão para o registro
    await auditoria(env, req, "cadastrou artista", "musico", novo.id, m.nome).run();
    return json(saida(novo));
  }

  if (partes.length === 2 && id) {
    const atual = await buscar(id);
    if (!atual) return json({ erro: "Cadastro não encontrado." }, 404);
    if (metodo === "GET") return json(saida(atual));
    if (metodo === "PUT") {
      const m = limpar(corpo, await lerConfig(env));
      if (m.erro) return json(m, 400);
      if (m.telefone) {
        const igual = await env.DB.prepare("SELECT id, nome FROM musicos WHERE telefone = ? AND id <> ?").bind(m.telefone, id).first();
        if (igual) return json({ erro: `Este WhatsApp já está no cadastro de ${igual.nome}.`, existente: igual }, 409);
      }
      const mudou = ["nome", "telefone", "pix_chave", "cidade", "estilo", "instrumentos", "casting", "pct", "grupo", "obs"].filter((k) => String(m[k]) !== String(atual[k]))
        .map((k) => ({ telefone: "WhatsApp", pix_chave: "Pix", instrumentos: "formação", casting: "casting", pct: "% da 7A", grupo: "grupo do WhatsApp", obs: "observações" })[k] || k);
      const [{ results }] = await env.DB.batch([
        env.DB.prepare(
          `UPDATE musicos SET nome = ?, telefone = ?, pix_tipo = ?, pix_chave = ?, cidade = ?, estilo = ?, instrumentos = ?, casting = ?, pct = ?, grupo = ?, obs = ?, atualizado = ?
           WHERE id = ? RETURNING *`
        ).bind(m.nome, m.telefone, m.pix_tipo, m.pix_chave, m.cidade, m.estilo, m.instrumentos, m.casting, m.pct, m.grupo, m.obs, agora(), id),
        auditoria(env, req, "editou artista", "musico", id, `${m.nome}${mudou.length ? ": " + mudou.join(", ") : ""}`),
      ]);
      return json(saida(results[0]));
    }
    if (metodo === "DELETE") {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM musicos WHERE id = ?").bind(id),
        auditoria(env, req, "excluiu artista", "musico", id, atual.nome),
      ]);
      return json({ ok: true });
    }
  }
  return json({ erro: "Rota não encontrada." }, 404);
}
