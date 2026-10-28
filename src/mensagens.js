// Mensagens pelo WhatsApp (versão gratuita): o servidor confere as regras, monta o link wa.me e registra
// a abertura sem duplicar; a mensagem só conta como enviada quando o operador confirma o toque.
// Também ficam aqui as rotas dos modelos de mensagem.

import { agora, auditoria, dataBR, hojeSP, inicioDoDia, json, lerConfig, somarDias, txt } from "./banco.js";
import { descreverFalta, preencher, validarModelo, valoresDe } from "./modelos.js";
import { montarLinkWhatsApp } from "./whatsapp.js";
import { PERFIS } from "./contratantes.js";
import { concluirSeAcabou, textoDoDestinatario } from "./campanhas.js";

export const ETAPAS_MODELO = ["primeiro", "cobranca", "proposta", "outro"];

/* ---------------- regras ---------------- */

// pode abrir mensagem para este contratante agora? { ok } ou { ok: false, codigo, erro }
export async function verificarEnvio(env, c, { tipo, simulada, ignorarIntervalo = false }, config) {
  if (c.arquivado) return { ok: false, codigo: "arquivado", erro: "Este contratante está arquivado." };
  if (c.comunicacao === "bloqueado") return { ok: false, codigo: "bloqueado", erro: "Esta casa pediu para não receber mensagens. Nada pode ser enviado para ela." };
  if (!c.telefone_norm) return { ok: false, codigo: "telefone", erro: c.telefone ? "O telefone está incompleto ou inválido. Corrija na ficha." : "Este contratante não tem telefone." };
  const h = hojeSP();
  const intervalo = Number(config.intervalo_dias) || 3;
  if (!ignorarIntervalo) {
    const ultima = await env.DB.prepare("SELECT criado FROM mensagens WHERE contratante_id = ? AND situacao <> 'desistiu' AND simulada = ? ORDER BY criado DESC LIMIT 1")
      .bind(c.id, simulada ? 1 : 0).first();
    if (ultima) {
      const dia = hojeSP(Date.parse(ultima.criado));
      const libera = somarDias(dia, intervalo);
      if (libera > h) return { ok: false, codigo: "intervalo", erro: `Já recebeu mensagem em ${dataBR(dia)}. O intervalo mínimo é de ${intervalo} dias (libera em ${dataBR(libera)}).`, libera };
    }
  }
  if (tipo === "abordagem") {
    const usados = await abordagensHoje(env, simulada);
    const limite = Number(config.limite_diario) || 20;
    if (usados >= limite) return { ok: false, codigo: "limite", erro: `O limite de ${limite} novas abordagens por dia chegou. Continue amanhã ou mude o limite em Ajustes.` };
  }
  return { ok: true };
}

export async function abordagensHoje(env, simulada = false) {
  const r = await env.DB.prepare("SELECT COUNT(*) n FROM mensagens WHERE tipo = 'abordagem' AND situacao <> 'desistiu' AND simulada = ? AND criado >= ?")
    .bind(simulada ? 1 : 0, inicioDoDia(hojeSP())).first();
  return r.n;
}

// primeira mensagem para quem nunca recebeu nada é abordagem nova (conta no limite diário)
async function tipoDaMensagem(env, c, modelo) {
  if (modelo?.etapa === "cobranca") return "cobranca";
  const ja = await env.DB.prepare("SELECT id FROM mensagens WHERE contratante_id = ? AND situacao = 'enviada' LIMIT 1").bind(c.id).first();
  return !ja && c.etapa === "contatar" ? "abordagem" : "avulsa";
}

/* ---------------- rotas ---------------- */

export async function rotasMensagens(req, env, partes, corpo) {
  const metodo = req.method;
  if (partes[1] === "previa" && metodo === "POST") return previa(env, corpo);
  if (partes.length === 1 && metodo === "POST") return registrar(env, req, corpo);
  const id = Number(partes[1]);
  if (!Number.isInteger(id) || id <= 0) return json({ erro: "Mensagem não encontrada." }, 404);
  const m = await env.DB.prepare("SELECT * FROM mensagens WHERE id = ?").bind(id).first();
  if (!m) return json({ erro: "Mensagem não encontrada." }, 404);
  if (partes[2] === "confirmar" && metodo === "POST") return confirmar(env, req, m, corpo);
  if (partes[2] === "reabrir" && metodo === "POST") return reabrir(env, m);
  return json({ erro: "Rota não encontrada." }, 404);
}

async function contratanteDe(env, id) {
  return Number.isInteger(Number(id)) && Number(id) > 0 ? env.DB.prepare("SELECT * FROM contratantes WHERE id = ?").bind(Number(id)).first() : null;
}
async function modeloDe(env, id) {
  return Number.isInteger(Number(id)) && Number(id) > 0 ? env.DB.prepare("SELECT * FROM modelos WHERE id = ?").bind(Number(id)).first() : null;
}

// mostra a mensagem pronta e os avisos, sem registrar nada
async function previa(env, corpo) {
  const c = await contratanteDe(env, corpo?.contratante_id);
  if (!c) return json({ erro: "Contratante não encontrado." }, 404);
  const config = await lerConfig(env);
  const modelo = await modeloDe(env, corpo?.modelo_id);
  const base = corpo?.texto != null && String(corpo.texto).trim() ? String(corpo.texto) : modelo?.texto || "";
  const erros = validarModelo(base);
  const { texto, faltando } = preencher(base, valoresDe(c));
  if (faltando.length) erros.push(descreverFalta(faltando));
  const tipo = await tipoDaMensagem(env, c, modelo);
  const regra = await verificarEnvio(env, c, { tipo, simulada: config.simulacao === "1" }, config);
  return json({ texto, erros, tipo, regra, simulacao: config.simulacao === "1" });
}

// registra a abertura (idempotente pela chave) e devolve o link wa.me; recusa casa bloqueada
async function registrar(env, req, corpo) {
  const chave = String(corpo?.chave ?? "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(chave)) return json({ erro: "Pedido sem identificação. Recarregue a página." }, 400);
  const existente = await env.DB.prepare("SELECT * FROM mensagens WHERE chave = ?").bind(chave).first();
  if (existente) {
    const c = await contratanteDe(env, existente.contratante_id);
    if (c?.comunicacao === "bloqueado") return json({ erro: "Esta casa pediu para não receber mensagens.", codigo: "bloqueado" }, 409);
    return json({ mensagem: existente, link: montarLinkWhatsApp(existente.telefone, existente.texto).link, repetida: true, simulada: !!existente.simulada });
  }
  const c = await contratanteDe(env, corpo?.contratante_id);
  if (!c) return json({ erro: "Contratante não encontrado." }, 404);
  const config = await lerConfig(env);

  let texto, modelo, tipo, simulada, campanha = null, dest = null;
  if (corpo?.destinatario_id) {
    dest = await env.DB.prepare("SELECT * FROM campanha_destinatarios WHERE id = ?").bind(Number(corpo.destinatario_id)).first();
    if (!dest || dest.contratante_id !== c.id) return json({ erro: "Esta casa não está nesta campanha." }, 404);
    campanha = await env.DB.prepare("SELECT * FROM campanhas WHERE id = ?").bind(dest.campanha_id).first();
    if (campanha.status !== "andamento") return json({ erro: "A campanha não está em andamento.", codigo: "campanha" }, 409);
    const devida = dest.situacao === "pendente" || (dest.situacao === "aguardando" && dest.cobrar_em && dest.cobrar_em <= hojeSP());
    if (!devida) return json({ erro: "Esta casa não está na vez da fila.", codigo: "fila" }, 409);
    const pronto = await textoDoDestinatario(env, campanha, dest, c);
    if (pronto.erro) return json({ erro: pronto.erro }, 400);
    ({ texto, modelo } = pronto);
    tipo = pronto.etapa === "cobranca" ? "cobranca" : await tipoDaMensagem(env, c, modelo);
    simulada = !!campanha.simulada;
  } else {
    modelo = await modeloDe(env, corpo?.modelo_id);
    const base = corpo?.texto != null && String(corpo.texto).trim() ? String(corpo.texto) : modelo?.texto || "";
    const erros = validarModelo(base);
    if (erros.length) return json({ erro: erros[0] }, 400);
    const p = preencher(base, valoresDe(c));
    if (p.faltando.length) return json({ erro: descreverFalta(p.faltando) }, 400);
    texto = p.texto;
    tipo = await tipoDaMensagem(env, c, modelo);
    simulada = config.simulacao === "1";
  }

  const regra = await verificarEnvio(env, c, { tipo, simulada, ignorarIntervalo: !dest && corpo?.forcar === true }, config);
  if (!regra.ok) return json({ erro: regra.erro, codigo: regra.codigo }, 409);
  const link = montarLinkWhatsApp(c.telefone_norm, texto);
  if (!link.ok) return json({ erro: link.erro }, 400);

  const t = agora();
  const passos = [
    env.DB.prepare(
      `INSERT INTO mensagens (chave, contratante_id, campanha_id, destinatario_id, modelo_id, tipo, telefone, texto, situacao, simulada, criado, atualizado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'aberta', ?, ?, ?) ON CONFLICT(chave) DO NOTHING RETURNING *`
    ).bind(chave, c.id, campanha?.id ?? null, dest?.id ?? null, modelo?.id ?? null, tipo, link.numero, texto, simulada ? 1 : 0, t, t),
  ];
  if (dest) {
    passos.push(
      env.DB.prepare("UPDATE campanha_destinatarios SET situacao = 'aberta', etapa = ?, mensagem_id = (SELECT id FROM mensagens WHERE chave = ?), atualizado = ? WHERE id = ? AND situacao IN ('pendente', 'aguardando')")
        .bind(tipo === "cobranca" ? "cobranca" : dest.etapa, chave, t, dest.id)
    );
  }
  const [ins] = await env.DB.batch(passos);
  const mensagem = ins.results[0] || (await env.DB.prepare("SELECT * FROM mensagens WHERE chave = ?").bind(chave).first());
  return json({ mensagem, link: link.link, repetida: !ins.results[0], simulada });
}

// o operador diz se enviou de fato; só então conta como enviada
async function confirmar(env, req, m, corpo) {
  const enviou = corpo?.enviou === true;
  if (m.situacao !== "aberta") {
    if ((enviou && m.situacao === "enviada") || (!enviou && m.situacao === "desistiu")) return json({ mensagem: m });
    return json({ erro: "Esta mensagem já foi marcada antes." }, 409);
  }
  const c = await contratanteDe(env, m.contratante_id);
  if (enviou && c.comunicacao === "bloqueado") return json({ erro: "Esta casa pediu para parar. O envio não foi registrado.", codigo: "bloqueado" }, 409);
  const t = agora(), h = hojeSP();
  const dest = m.destinatario_id ? await env.DB.prepare("SELECT * FROM campanha_destinatarios WHERE id = ?").bind(m.destinatario_id).first() : null;
  const campanha = dest ? await env.DB.prepare("SELECT * FROM campanhas WHERE id = ?").bind(dest.campanha_id).first() : null;
  const passos = [
    env.DB.prepare("UPDATE mensagens SET situacao = ?, atualizado = ? WHERE id = ? AND situacao = 'aberta'").bind(enviou ? "enviada" : "desistiu", t, m.id),
    env.DB.prepare("INSERT INTO eventos (contratante_id, mensagem_id, tipo, criado) VALUES (?, ?, ?, ?)").bind(m.contratante_id, m.id, enviou ? "enviada" : "desistiu", t),
  ];
  if (enviou) {
    if (!m.simulada) {
      const config = await lerConfig(env);
      const dias = campanha ? campanha.cobranca_dias : Number(config.intervalo_dias) || 3;
      const proxima = m.tipo === "cobranca" ? ["", ""] : m.tipo === "abordagem" || c.etapa === "contatar" ? ["Cobrar resposta da mensagem no WhatsApp", dias ? somarDias(h, dias) : ""] : null;
      passos.push(
        env.DB.prepare(
          `UPDATE contratantes SET etapa = CASE WHEN etapa = 'contatar' THEN 'contatado' ELSE etapa END${proxima ? ", proxima_acao = ?, proxima_data = ?" : ""}, atualizado = ? WHERE id = ?`
        ).bind(...(proxima || []), t, c.id)
      );
      if (m.tipo === "cobranca") {
        passos.push(env.DB.prepare("UPDATE campanha_destinatarios SET situacao = 'cobrada', atualizado = ? WHERE contratante_id = ? AND situacao = 'aguardando' AND id <> ?").bind(t, c.id, m.destinatario_id ?? 0));
      }
    }
    if (dest && dest.situacao === "aberta") {
      const fim = dest.etapa === "cobranca" ? ["cobrada", ""] : campanha.cobranca_dias > 0 ? ["aguardando", somarDias(h, campanha.cobranca_dias)] : ["enviada", ""];
      passos.push(env.DB.prepare("UPDATE campanha_destinatarios SET situacao = ?, cobrar_em = ?, atualizado = ? WHERE id = ?").bind(fim[0], fim[1], t, dest.id));
    }
  } else if (dest && dest.situacao === "aberta") {
    // não enviou: volta para a fila no mesmo ponto
    passos.push(
      env.DB.prepare("UPDATE campanha_destinatarios SET situacao = ?, mensagem_id = NULL, atualizado = ? WHERE id = ?").bind(dest.etapa === "cobranca" && dest.cobrar_em ? "aguardando" : "pendente", t, dest.id)
    );
  }
  await env.DB.batch(passos);
  if (campanha) await concluirSeAcabou(env, req, campanha.id);
  return json({ mensagem: await env.DB.prepare("SELECT * FROM mensagens WHERE id = ?").bind(m.id).first() });
}

// abrir de novo a mesma mensagem (o painel pede confirmação antes); não cria registro novo
async function reabrir(env, m) {
  const c = await contratanteDe(env, m.contratante_id);
  if (c.comunicacao === "bloqueado") return json({ erro: "Esta casa pediu para não receber mensagens.", codigo: "bloqueado" }, 409);
  const link = montarLinkWhatsApp(m.telefone, m.texto);
  if (!link.ok) return json({ erro: link.erro }, 400);
  await env.DB.prepare("INSERT INTO eventos (contratante_id, mensagem_id, tipo, criado) VALUES (?, ?, 'reaberta', ?)").bind(m.contratante_id, m.id, agora()).run();
  return json({ link: link.link });
}

/* ---------------- modelos ---------------- */

function limparModelo(m) {
  const r = {
    nome: txt(m?.nome, 80),
    etapa: ETAPAS_MODELO.includes(m?.etapa) ? m.etapa : "outro",
    perfil: PERFIS.includes(m?.perfil) ? m.perfil : "",
    texto: String(m?.texto ?? "").replace(/\r\n/g, "\n").trim(),
    ativo: m?.ativo === false || m?.ativo === 0 ? 0 : 1,
  };
  if (!r.nome) return { erro: "Dê um nome ao modelo." };
  const erros = validarModelo(r.texto);
  if (erros.length) return { erro: erros[0], erros };
  return r;
}

export async function rotasModelos(req, env, partes, corpo) {
  const metodo = req.method;
  if (partes.length === 1 && metodo === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT m.*, (SELECT COUNT(*) FROM mensagens WHERE modelo_id = m.id AND situacao = 'enviada' AND simulada = 0) AS enviadas FROM modelos m ORDER BY ativo DESC, etapa, nome COLLATE NOCASE"
    ).all();
    return json(results);
  }
  if (partes.length === 1 && metodo === "POST") {
    const r = limparModelo(corpo);
    if (r.erro) return json(r, 400);
    const t = agora();
    const linha = await env.DB.prepare("INSERT INTO modelos (nome, etapa, perfil, texto, ativo, criado, atualizado) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *")
      .bind(r.nome, r.etapa, r.perfil, r.texto, r.ativo, t, t).first();
    await auditoria(env, req, "criou", "modelo", linha.id, linha.nome).run();
    return json(linha);
  }
  const id = Number(partes[1]);
  if (!Number.isInteger(id) || id <= 0) return json({ erro: "Modelo não encontrado." }, 404);
  if (metodo === "PUT") {
    const r = limparModelo(corpo);
    if (r.erro) return json(r, 400);
    const [linha] = await env.DB.batch([
      env.DB.prepare("UPDATE modelos SET nome = ?, etapa = ?, perfil = ?, texto = ?, ativo = ?, atualizado = ? WHERE id = ? RETURNING *").bind(r.nome, r.etapa, r.perfil, r.texto, r.ativo, agora(), id),
      auditoria(env, req, "editou", "modelo", id, r.nome),
    ]);
    return linha.results[0] ? json(linha.results[0]) : json({ erro: "Modelo não encontrado." }, 404);
  }
  return json({ erro: "Rota não encontrada." }, 404);
}
