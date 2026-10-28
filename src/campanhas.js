// Campanhas: uma lista ordenada de casas que o operador percorre uma por uma, abrindo cada mensagem
// no WhatsApp com um toque. Prévia com os excluídos e o motivo; a confirmação grava exatamente a
// lista vista; cobrança automática N dias depois, sem resposta; limites de frequência; indicadores.

import { agora, auditoria, dataBR, hojeSP, inicioDoDia, json, lerConfig, somarDias, txt } from "./banco.js";
import { descreverFalta, preencher, valoresDe } from "./modelos.js";
import { abordagensHoje, verificarEnvio } from "./mensagens.js";
import { ETAPAS, PERFIS, TIPOS } from "./contratantes.js";

export const STATUS_CAMPANHA = ["rascunho", "andamento", "pausada", "cancelada", "concluida"];
export const LISTAS = { contatar: "A contatar", cobrar: "Cobrar hoje", abertas: "Todas em aberto" };
const ATIVAS = "('pendente', 'aberta', 'aguardando')"; // situações de quem ainda está na fila

// "AAAA-MM-DDTHH:MM" agora, em Betim
function agoraSP() {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${hojeSP()}T${p.hour}:${p.minute}`;
}

function limparCampanha(c) {
  const pub = c?.publico || {};
  const r = {
    nome: txt(c?.nome, 120),
    objetivo: txt(c?.objetivo, 500),
    publico: {
      lista: LISTAS[pub.lista] ? pub.lista : "contatar",
      perfil: PERFIS.includes(pub.perfil) ? pub.perfil : "",
      cidade: txt(pub.cidade, 80),
      tipo: TIPOS.includes(pub.tipo) ? pub.tipo : "",
    },
    modelo_id: Number(c?.modelo_id) > 0 ? Number(c.modelo_id) : null,
    cobranca_modelo_id: Number(c?.cobranca_modelo_id) > 0 ? Number(c.cobranca_modelo_id) : null,
    cobranca_dias: Math.min(30, Math.max(0, Math.round(Number(c?.cobranca_dias ?? 3)) || 0)),
    inicio: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(c?.inicio || "") ? c.inicio : "",
  };
  if (!r.nome) return { erro: "Dê um nome à campanha." };
  return r;
}

/* ---------------- modelos e textos ---------------- */

const ETAPA_AUTOMATICA = { contatar: "primeiro", contatado: "cobranca", negociando: "proposta" };

// modelo ativo da etapa, preferindo o do mesmo perfil musical
function escolherModelo(modelos, etapa, perfil) {
  const da = modelos.filter((m) => m.ativo && m.etapa === etapa);
  return da.find((m) => perfil && m.perfil === perfil) || da.find((m) => !m.perfil) || null;
}

// texto que sai para um destinatário: o gravado na confirmação, ou o da cobrança quando chega a vez dela
export async function textoDoDestinatario(env, campanha, d, c) {
  const cobrancaDevida = d.situacao === "aguardando" || (d.situacao === "aberta" && d.etapa === "cobranca" && d.cobrar_em);
  if (!cobrancaDevida) {
    if (!d.texto || /\{\{|\}\}/.test(d.texto)) return { erro: "O texto gravado desta casa está incompleto." };
    const modelo = d.modelo_id ? await env.DB.prepare("SELECT * FROM modelos WHERE id = ?").bind(d.modelo_id).first() : null;
    return { texto: d.texto, modelo, etapa: d.etapa };
  }
  const { results: modelos } = await env.DB.prepare("SELECT * FROM modelos").all();
  const modelo = campanha.cobranca_modelo_id ? modelos.find((m) => m.id === campanha.cobranca_modelo_id) : escolherModelo(modelos, "cobranca", c.perfil);
  if (!modelo) return { erro: "Não há modelo de cobrança ativo para esta casa." };
  const p = preencher(modelo.texto, valoresDe(c));
  if (p.faltando.length) return { erro: descreverFalta(p.faltando) };
  return { texto: p.texto, modelo, etapa: "cobranca" };
}

/* ---------------- prévia ---------------- */

async function candidatos(env, pub) {
  const onde = ["arquivado = ''"], args = [];
  if (pub.lista === "contatar") onde.push("etapa = 'contatar'");
  else if (pub.lista === "cobrar") { onde.push("etapa = 'contatado' AND proxima_data <> '' AND proxima_data <= ?"); args.push(hojeSP()); }
  else onde.push("etapa IN ('contatar', 'contatado', 'negociando')");
  if (pub.perfil) { onde.push("perfil IN (?, 'ambos')"); args.push(pub.perfil); }
  if (pub.cidade) { onde.push("lower(cidade) = ?"); args.push(pub.cidade.toLowerCase()); }
  if (pub.tipo) { onde.push("tipo = ?"); args.push(pub.tipo); }
  const { results } = await env.DB.prepare(`SELECT * FROM contratantes WHERE ${onde.join(" AND ")} ORDER BY proxima_data = '', proxima_data, nome COLLATE NOCASE`).bind(...args).all();
  return results;
}

async function assinar(lista) {
  const dados = new TextEncoder().encode(JSON.stringify(lista.map((x) => [x.contratante_id, x.modelo_id, x.texto])));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", dados))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function montarPrevia(env, campanha, config) {
  const pub = JSON.parse(campanha.publico || "{}");
  const simulada = config.simulacao === "1";
  const intervalo = Number(config.intervalo_dias) || 3;
  const limite = Number(config.limite_diario) || 20;
  const h = hojeSP();
  const [lista, { results: modelos }, { results: ultimas }, { results: emOutra }] = await Promise.all([
    candidatos(env, pub),
    env.DB.prepare("SELECT * FROM modelos").all(),
    env.DB.prepare("SELECT contratante_id, MAX(criado) AS criado FROM mensagens WHERE situacao <> 'desistiu' AND simulada = ? GROUP BY contratante_id").bind(simulada ? 1 : 0).all(),
    env.DB.prepare(
      `SELECT d.contratante_id, ca.nome FROM campanha_destinatarios d JOIN campanhas ca ON ca.id = d.campanha_id
       WHERE ca.status IN ('andamento', 'pausada') AND d.situacao IN ${ATIVAS} AND ca.id <> ?`
    ).bind(campanha.id).all(),
  ]);
  const ultima = new Map(ultimas.map((u) => [u.contratante_id, hojeSP(Date.parse(u.criado))]));
  const outra = new Map(emOutra.map((x) => [x.contratante_id, x.nome]));
  const escolhido = campanha.modelo_id ? modelos.find((m) => m.id === campanha.modelo_id) : null;

  const incluidos = [], excluidos = [];
  for (const c of lista) {
    const fora = (motivo) => excluidos.push({ contratante_id: c.id, nome: c.nome, cidade: c.cidade, motivo });
    if (c.comunicacao === "bloqueado") { fora("Pediu para parar (bloqueado)"); continue; }
    if (!c.telefone.trim()) { fora("Sem telefone"); continue; }
    if (!c.telefone_norm) { fora("Telefone incompleto ou inválido"); continue; }
    const dia = ultima.get(c.id);
    if (dia && somarDias(dia, intervalo) > h) { fora(`Recebeu mensagem nos últimos ${intervalo} dias (${dataBR(dia)})`); continue; }
    if (outra.has(c.id)) { fora(`Já está na campanha "${outra.get(c.id)}"`); continue; }
    const modelo = escolhido && escolhido.ativo ? escolhido : escolhido ? null : escolherModelo(modelos, ETAPA_AUTOMATICA[c.etapa] || "outro", c.perfil);
    if (!modelo) { fora(escolhido ? "O modelo escolhido está desativado" : "Sem modelo ativo para a etapa e o perfil desta casa"); continue; }
    const p = preencher(modelo.texto, valoresDe(c));
    if (p.faltando.length) { fora("Falta dado no texto: " + descreverFalta(p.faltando).replace(/^Falta /, "").replace(/ para preencher o texto\.$/, "")); continue; }
    incluidos.push({
      contratante_id: c.id, nome: c.nome, cidade: c.cidade, telefone: c.telefone, etapa_funil: c.etapa,
      modelo_id: modelo.id, modelo: modelo.nome, etapa: modelo.etapa === "cobranca" ? "cobranca" : "abordagem", texto: p.texto,
    });
  }

  const usados = await abordagensHoje(env, simulada);
  const restante = Math.max(0, limite - usados);
  const abordagens = incluidos.filter((x) => x.etapa === "abordagem" && x.etapa_funil === "contatar").length;
  const alertas = [];
  if (simulada) alertas.push("Modo simulação ligado: a campanha registra tudo como teste e não abre o WhatsApp.");
  if (!incluidos.length) alertas.push("Nenhuma casa elegível: confira o público e os excluídos.");
  if (abordagens > restante) alertas.push(`Hoje cabem só mais ${restante} novas abordagens (limite diário de ${limite}). As outras ficam para os próximos dias.`);
  else if (restante - abordagens <= 3 && abordagens) alertas.push(`O limite diário fica quase no fim: sobram ${restante - abordagens} novas abordagens hoje.`);
  if (campanha.inicio && campanha.inicio > agoraSP()) alertas.push(`A fila só abre em ${dataBR(campanha.inicio.slice(0, 10))} às ${campanha.inicio.slice(11)}.`);
  const cobrancaModelo = campanha.cobranca_modelo_id ? modelos.find((m) => m.id === campanha.cobranca_modelo_id) : null;
  if (campanha.cobranca_dias > 0 && !cobrancaModelo && !modelos.some((m) => m.ativo && m.etapa === "cobranca")) alertas.push("Não há modelo de cobrança ativo: as cobranças vão ficar paradas.");

  return {
    incluidos,
    excluidos,
    assinatura: await assinar(incluidos),
    estimativa: { mensagens: incluidos.length, abordagens, toques: incluidos.length, restante_hoje: restante, limite, dias: abordagens ? Math.ceil(Math.max(0, abordagens - restante) / limite) + (restante ? 1 : 0) : incluidos.length ? 1 : 0 },
    cobranca: { dias: campanha.cobranca_dias, modelo: campanha.cobranca_dias ? cobrancaModelo?.nome || "automático (modelo de cobrança do perfil)" : "" },
    inicio: campanha.inicio,
    alertas,
    simulada,
  };
}

/* ---------------- conclusão e indicadores ---------------- */

// campanha sem ninguém pendente termina sozinha
export async function concluirSeAcabou(env, req, id) {
  const r = await env.DB.prepare(`SELECT COUNT(*) n FROM campanha_destinatarios WHERE campanha_id = ? AND situacao IN ${ATIVAS}`).bind(id).first();
  if (r.n > 0) return false;
  const up = await env.DB.prepare("UPDATE campanhas SET status = 'concluida', atualizado = ? WHERE id = ? AND status = 'andamento'").bind(agora(), id).run();
  if (up.meta.changes) await auditoria(env, req, "concluiu", "campanha", id, "Ninguém mais pendente na fila").run();
  return up.meta.changes > 0;
}

async function indicadoresCampanha(env, id) {
  const [sit, msg, fech] = await env.DB.batch([
    env.DB.prepare("SELECT situacao, COUNT(*) n FROM campanha_destinatarios WHERE campanha_id = ? GROUP BY situacao").bind(id),
    env.DB.prepare("SELECT situacao, COUNT(*) n FROM mensagens WHERE campanha_id = ? GROUP BY situacao").bind(id),
    env.DB.prepare("SELECT COUNT(*) n FROM campanha_destinatarios d JOIN contratantes c ON c.id = d.contratante_id WHERE d.campanha_id = ? AND c.etapa = 'fechado'").bind(id),
  ]);
  const s = Object.fromEntries(sit.results.map((r) => [r.situacao, r.n]));
  const m = Object.fromEntries(msg.results.map((r) => [r.situacao, r.n]));
  const total = sit.results.reduce((t, r) => t + r.n, 0);
  return {
    total,
    pendentes: (s.pendente || 0) + (s.aberta || 0),
    aguardando_cobranca: s.aguardando || 0,
    abertas: (m.aberta || 0) + (m.enviada || 0),
    enviadas: m.enviada || 0,
    respostas: s.respondeu || 0,
    fechamentos: fech.results[0].n,
    bloqueios: s.bloqueado || 0,
    pulados: s.pulado || 0,
    cancelados: s.cancelado || 0,
  };
}

// números gerais do período (mensagens de teste não contam)
export async function indicadores(env, dias = 30) {
  const h = hojeSP();
  const desde = inicioDoDia(somarDias(h, -(dias - 1)));
  const config = await lerConfig(env);
  const [env_, resp, bloq, funil, abertas] = await env.DB.batch([
    env.DB.prepare("SELECT tipo, COUNT(*) n FROM mensagens WHERE situacao = 'enviada' AND simulada = 0 AND criado >= ? GROUP BY tipo").bind(desde),
    env.DB.prepare("SELECT COUNT(DISTINCT contratante_id) n FROM eventos WHERE tipo = 'respondeu' AND criado >= ?").bind(desde),
    env.DB.prepare("SELECT COUNT(*) n FROM eventos WHERE tipo = 'pediu_parar' AND criado >= ?").bind(desde),
    env.DB.prepare("SELECT etapa, COUNT(*) n FROM contratantes WHERE arquivado = '' GROUP BY etapa"),
    env.DB.prepare("SELECT COUNT(*) n FROM mensagens WHERE situacao = 'aberta' AND simulada = 0"),
  ]);
  const porTipo = Object.fromEntries(env_.results.map((r) => [r.tipo, r.n]));
  const enviadas = env_.results.reduce((t, r) => t + r.n, 0);
  const respostas = resp.results[0].n;
  return {
    dias,
    enviadas,
    por_tipo: { abordagem: porTipo.abordagem || 0, cobranca: porTipo.cobranca || 0, avulsa: porTipo.avulsa || 0 },
    respostas,
    taxa_resposta: enviadas ? Math.round((respostas / enviadas) * 100) : null,
    bloqueios: bloq.results[0].n,
    sem_confirmar: abertas.results[0].n,
    funil: Object.fromEntries(ETAPAS.map((e) => [e, funil.results.find((r) => r.etapa === e)?.n || 0])),
    hoje: { abordagens: await abordagensHoje(env, config.simulacao === "1"), limite: Number(config.limite_diario) || 20, simulacao: config.simulacao === "1" },
  };
}

/* ---------------- rotas ---------------- */

export async function rotasCampanhas(req, env, partes, corpo) {
  const metodo = req.method;
  if (partes.length === 1 && metodo === "GET") return listar(env, req);
  if (partes.length === 1 && metodo === "POST") {
    const r = limparCampanha(corpo);
    if (r.erro) return json(r, 400);
    const t = agora();
    const linha = await env.DB.prepare(
      "INSERT INTO campanhas (nome, objetivo, publico, modelo_id, cobranca_modelo_id, cobranca_dias, inicio, status, criado, atualizado) VALUES (?, ?, ?, ?, ?, ?, ?, 'rascunho', ?, ?) RETURNING *"
    ).bind(r.nome, r.objetivo, JSON.stringify(r.publico), r.modelo_id, r.cobranca_modelo_id, r.cobranca_dias, r.inicio, t, t).first();
    await auditoria(env, req, "criou", "campanha", linha.id, linha.nome).run();
    return json(linha);
  }
  const id = Number(partes[1]);
  if (!Number.isInteger(id) || id <= 0) return json({ erro: "Campanha não encontrada." }, 404);
  let ca = await env.DB.prepare("SELECT * FROM campanhas WHERE id = ?").bind(id).first();
  if (!ca) return json({ erro: "Campanha não encontrada." }, 404);
  const acao = partes[2];

  if (!acao && metodo === "GET") {
    if (ca.status === "andamento" && (await concluirSeAcabou(env, req, id))) ca = await env.DB.prepare("SELECT * FROM campanhas WHERE id = ?").bind(id).first();
    const [dest, hist] = await env.DB.batch([
      env.DB.prepare(
        `SELECT d.id, d.contratante_id, d.ordem, d.situacao, d.etapa, d.cobrar_em, d.motivo, d.atualizado, c.nome, c.cidade
         FROM campanha_destinatarios d JOIN contratantes c ON c.id = d.contratante_id WHERE d.campanha_id = ? ORDER BY d.ordem`
      ).bind(id),
      env.DB.prepare("SELECT quando, acao, detalhe FROM auditoria WHERE entidade = 'campanha' AND entidade_id = ? ORDER BY quando DESC LIMIT 50").bind(id),
    ]);
    return json({ campanha: ca, indicadores: await indicadoresCampanha(env, id), destinatarios: dest.results, historico: hist.results });
  }
  if (!acao && metodo === "PUT") {
    if (ca.status !== "rascunho") return json({ erro: "Só dá para editar a campanha enquanto ela é rascunho." }, 409);
    const r = limparCampanha(corpo);
    if (r.erro) return json(r, 400);
    const linha = await env.DB.prepare("UPDATE campanhas SET nome = ?, objetivo = ?, publico = ?, modelo_id = ?, cobranca_modelo_id = ?, cobranca_dias = ?, inicio = ?, atualizado = ? WHERE id = ? RETURNING *")
      .bind(r.nome, r.objetivo, JSON.stringify(r.publico), r.modelo_id, r.cobranca_modelo_id, r.cobranca_dias, r.inicio, agora(), id).first();
    return json(linha);
  }
  if (acao === "previa" && metodo === "GET") {
    if (ca.status !== "rascunho") return json({ erro: "A campanha já foi iniciada." }, 409);
    return json(await montarPrevia(env, ca, await lerConfig(env)));
  }
  if (acao === "confirmar" && metodo === "POST") return confirmar(env, req, ca, corpo);
  if (acao === "fila" && metodo === "GET") return fila(env, req, ca);
  if (acao === "pular" && metodo === "POST") {
    const motivo = txt(corpo?.motivo, 200) || "Pulado pelo operador";
    const up = await env.DB.prepare(`UPDATE campanha_destinatarios SET situacao = 'pulado', motivo = ?, atualizado = ? WHERE id = ? AND campanha_id = ? AND situacao IN ('pendente', 'aguardando')`)
      .bind(motivo, agora(), Number(corpo?.destinatario_id), id).run();
    if (!up.meta.changes) return json({ erro: "Esta casa não está mais na fila." }, 409);
    await auditoria(env, req, "pulou", "campanha", id, motivo).run();
    await concluirSeAcabou(env, req, id);
    return json({ ok: true });
  }
  const trocas = { pausar: [["andamento"], "pausada", "pausou"], retomar: [["pausada"], "andamento", "retomou"], cancelar: [["rascunho", "andamento", "pausada"], "cancelada", "cancelou"] };
  if (trocas[acao] && metodo === "POST") {
    const [de, para, verbo] = trocas[acao];
    if (!de.includes(ca.status)) return json({ erro: `Não dá para ${acao} uma campanha ${ca.status === "concluida" ? "concluída" : ca.status}.` }, 409);
    const t = agora();
    const passos = [env.DB.prepare(`UPDATE campanhas SET status = ?, atualizado = ? WHERE id = ? AND status IN (${de.map(() => "?").join(", ")})`).bind(para, t, id, ...de)];
    if (para === "cancelada") passos.push(env.DB.prepare(`UPDATE campanha_destinatarios SET situacao = 'cancelado', motivo = 'Campanha cancelada', atualizado = ? WHERE campanha_id = ? AND situacao IN ${ATIVAS}`).bind(t, id));
    passos.push(auditoria(env, req, verbo, "campanha", id, ""));
    await env.DB.batch(passos);
    return json(await env.DB.prepare("SELECT * FROM campanhas WHERE id = ?").bind(id).first());
  }
  return json({ erro: "Rota não encontrada." }, 404);
}

async function listar(env, req) {
  const { results: andamento } = await env.DB.prepare("SELECT id FROM campanhas WHERE status = 'andamento'").all();
  for (const c of andamento) await concluirSeAcabou(env, req, c.id);
  const { results } = await env.DB.prepare(
    `SELECT ca.*,
       SUM(CASE WHEN d.situacao IN ('pendente', 'aberta') THEN 1 ELSE 0 END) AS pendentes,
       SUM(CASE WHEN d.situacao = 'aguardando' THEN 1 ELSE 0 END) AS aguardando,
       SUM(CASE WHEN d.situacao = 'aguardando' AND d.cobrar_em <= ? THEN 1 ELSE 0 END) AS cobrar_hoje,
       SUM(CASE WHEN d.situacao = 'respondeu' THEN 1 ELSE 0 END) AS respostas,
       COUNT(d.id) AS total
     FROM campanhas ca LEFT JOIN campanha_destinatarios d ON d.campanha_id = ca.id
     GROUP BY ca.id ORDER BY CASE ca.status WHEN 'andamento' THEN 0 WHEN 'pausada' THEN 1 WHEN 'rascunho' THEN 2 ELSE 3 END, ca.criado DESC`
  ).bind(hojeSP()).all();
  return json(results);
}

// grava exatamente a lista que o operador viu (mesma assinatura) e põe a campanha em andamento
async function confirmar(env, req, ca, corpo) {
  if (ca.status !== "rascunho") return ca.status === "andamento" ? json({ campanha: ca, repetida: true }) : json({ erro: "Esta campanha não é mais rascunho." }, 409);
  const config = await lerConfig(env);
  const previa = await montarPrevia(env, ca, config);
  if (corpo?.assinatura !== previa.assinatura) return json({ erro: "A lista mudou desde a prévia (alguém entrou, saiu ou mudou). Confira a prévia nova e confirme de novo.", codigo: "mudou", previa }, 409);
  if (!previa.incluidos.length) return json({ erro: "Nenhuma casa elegível para esta campanha." }, 400);
  const t = agora();
  const up = await env.DB.prepare("UPDATE campanhas SET status = 'andamento', simulada = ?, confirmada = ?, atualizado = ? WHERE id = ? AND status = 'rascunho'")
    .bind(previa.simulada ? 1 : 0, t, t, ca.id).run();
  if (!up.meta.changes) return json({ campanha: await env.DB.prepare("SELECT * FROM campanhas WHERE id = ?").bind(ca.id).first(), repetida: true });
  try {
    const sql = "INSERT OR IGNORE INTO campanha_destinatarios (campanha_id, contratante_id, ordem, situacao, etapa, modelo_id, texto, atualizado) VALUES (?, ?, ?, 'pendente', ?, ?, ?, ?)";
    for (let i = 0; i < previa.incluidos.length; i += 100) {
      await env.DB.batch(previa.incluidos.slice(i, i + 100).map((x, j) => env.DB.prepare(sql).bind(ca.id, x.contratante_id, i + j + 1, x.etapa, x.modelo_id, x.texto, t)));
    }
  } catch (e) {
    await env.DB.prepare("UPDATE campanhas SET status = 'rascunho', confirmada = '' WHERE id = ?").bind(ca.id).run();
    throw e;
  }
  const resumo = `${previa.incluidos.length} casas na fila, ${previa.excluidos.length} excluídas${previa.simulada ? " (simulação)" : ""}`;
  await auditoria(env, req, "iniciou", "campanha", ca.id, resumo).run();
  return json({ campanha: await env.DB.prepare("SELECT * FROM campanhas WHERE id = ?").bind(ca.id).first(), resumo });
}

// a próxima casa da fila, conferindo de novo bloqueio, intervalo e limite na hora
async function fila(env, req, ca) {
  const contagem = async () => {
    const { results } = await env.DB.prepare("SELECT situacao, COUNT(*) n, MIN(cobrar_em) prox FROM campanha_destinatarios WHERE campanha_id = ? GROUP BY situacao").bind(ca.id).all();
    return Object.fromEntries(results.map((r) => [r.situacao, r.situacao === "aguardando" ? { n: r.n, proxima: r.prox } : r.n]));
  };
  if (ca.status !== "andamento") return json({ status: ca.status, contagem: await contagem() });
  if (ca.inicio && ca.inicio > agoraSP()) return json({ status: ca.status, espera: ca.inicio, contagem: await contagem() });
  if (await concluirSeAcabou(env, req, ca.id)) return json({ status: "concluida", contagem: await contagem() });
  const config = await lerConfig(env);
  const simulada = !!ca.simulada;
  const pacote = async (d, c, pronto, mensagem = null) => ({
    status: ca.status,
    simulada,
    atual: {
      destinatario_id: d.id, etapa: pronto.etapa, texto: pronto.texto, modelo: pronto.modelo?.nome || "",
      contratante: { id: c.id, nome: c.nome, contato: c.contato, cidade: c.cidade, telefone: c.telefone, etapa: c.etapa },
    },
    mensagem,
    contagem: await contagem(),
  });

  // mensagem aberta e ainda não confirmada: fica na tela até o operador dizer se enviou
  const aberta = await env.DB.prepare("SELECT * FROM campanha_destinatarios WHERE campanha_id = ? AND situacao = 'aberta' ORDER BY ordem LIMIT 1").bind(ca.id).first();
  if (aberta) {
    const c = await env.DB.prepare("SELECT * FROM contratantes WHERE id = ?").bind(aberta.contratante_id).first();
    const m = aberta.mensagem_id ? await env.DB.prepare("SELECT * FROM mensagens WHERE id = ?").bind(aberta.mensagem_id).first() : null;
    if (m) return json(await pacote(aberta, c, { etapa: aberta.etapa, texto: m.texto, modelo: null }, m));
  }

  const h = hojeSP(), t = agora();
  const { results } = await env.DB.prepare(
    `SELECT * FROM campanha_destinatarios WHERE campanha_id = ? AND (situacao = 'pendente' OR (situacao = 'aguardando' AND cobrar_em <> '' AND cobrar_em <= ?))
     ORDER BY situacao = 'aguardando' DESC, ordem LIMIT 300`
  ).bind(ca.id, h).all();
  let esperando = 0;
  for (const d of results) {
    const c = await env.DB.prepare("SELECT * FROM contratantes WHERE id = ?").bind(d.contratante_id).first();
    const marcar = (situacao, motivo) => env.DB.prepare("UPDATE campanha_destinatarios SET situacao = ?, motivo = ?, atualizado = ? WHERE id = ?").bind(situacao, motivo, t, d.id).run();
    if (c.arquivado) { await marcar("cancelado", "Contratante arquivado"); continue; }
    if (c.comunicacao === "bloqueado") { await marcar("bloqueado", "Pediu para parar"); continue; }
    const cobranca = d.situacao === "aguardando" || d.etapa === "cobranca";
    const tipo = cobranca ? "cobranca" : c.etapa === "contatar" ? "abordagem" : "avulsa";
    const regra = await verificarEnvio(env, c, { tipo, simulada }, config);
    if (!regra.ok) {
      if (regra.codigo === "intervalo") { esperando++; continue; }
      if (regra.codigo === "limite") return json({ status: ca.status, limite: regra.erro, contagem: await contagem() });
      await marcar("pulado", regra.erro);
      continue;
    }
    const pronto = await textoDoDestinatario(env, ca, d, c);
    if (pronto.erro) { await marcar("pulado", pronto.erro); continue; }
    return json(await pacote(d, c, pronto));
  }
  if (await concluirSeAcabou(env, req, ca.id)) return json({ status: "concluida", contagem: await contagem() });
  return json({ status: ca.status, vazia: true, esperando, contagem: await contagem() });
}
