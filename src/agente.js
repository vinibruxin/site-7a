// API do agente comercial (Évora): acesso por token próprio (segredo AGENTE_TOKEN do Worker), sem a senha do painel.
// O agente lê a gestão, rascunha mensagens e propostas, negocia cachê acima do piso, anota e agenda a próxima ação.
// Enviar, aprovar proposta, registrar um toque no WhatsApp, mexer em campanhas, recebido e repasse, configurações,
// login ou site continuam com a equipe.

import { agora, auditoria, dataOk, hojeSP, json, lerConfig, prepararBanco, txt } from "./banco.js";
import { abordagensHoje } from "./mensagens.js";

export const ETAPAS_AGENTE = ["contatar", "contatado", "negociando", "perdido"];
const PREFIXO_NOTA = "Évora: ";
const TAMANHO_MINIMO_TOKEN = 32;

// piso de cachê por artista ("a partir de"), em centavos: o sistema guarda valores assim (150000 = R$ 1.500,00)
export const PISOS = {
  "athos-tibaes": 30000,
  "dj-ivan-lennon": 30000,
  aenima: 60000,
  "ordem-mor": 120000,
  "ossos-do-banquete": 150000,
  "sub-rosa": 150000,
};

// rotas da gestão que o agente pode usar (caminho depois de "gestao/")
const LEITURA = [/^dados$/, /^fila$/, /^indicadores$/, /^contratantes\/\d+\/conversa$/, /^contratantes$/, /^contratantes\/\d+$/, /^contratantes\/\d+\/notas$/, /^modelos$/, /^campanhas$/, /^shows\/\d+\/proposta$/];

function igual(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

// o pedido traz "Authorization: Bearer <token>" igual ao segredo do Worker; sem segredo forte, o acesso fica desligado
export function agenteAutorizado(req, env) {
  const m = (req.headers.get("authorization") || "").match(/^Bearer (.+)$/);
  if (!m || !env.AGENTE_TOKEN || env.AGENTE_TOKEN.length < TAMANHO_MINIMO_TOKEN) return false;
  return igual(m[1].trim(), env.AGENTE_TOKEN);
}

// qualquer valor enviado, mesmo zero, conta como lançamento
const valorLancado = (v) => v !== undefined && v !== null && v !== "";
const reais = (c) => (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// piso que vale para este show: o do artista, ou o último cachê fechado com a casa se for maior (nunca abaixo do padrão)
async function pisoDoShow(env, contratanteId, artista) {
  const padrao = PISOS[artista];
  if (!padrao) return null;
  const ultimo = contratanteId ? await env.DB.prepare("SELECT valor FROM ultimos_cache WHERE contratante_id = ? AND artista = ?").bind(Number(contratanteId), artista).first() : null;
  return ultimo ? Math.max(padrao, ultimo.valor) : padrao;
}

// regras de um show escrito pela Évora: consulta, sem recebido, repasse, despesas nem publicação; cachê só acima do piso
async function regraDeShow(env, corpo, atual) {
  if ((corpo?.status || "consulta") !== "consulta") return "O agente só trabalha com consultas. Confirmar e publicar fica com a equipe.";
  if (corpo?.publicar) return "Publicar na agenda fica com a equipe.";
  if (valorLancado(corpo?.recebido) || valorLancado(corpo?.repassado) || valorLancado(corpo?.despesas)) {
    return "Recebido, repasse e despesas ficam com a equipe.";
  }
  if (!valorLancado(corpo?.cache)) return null;
  const artista = corpo?.artista || atual?.artista || "";
  const piso = await pisoDoShow(env, corpo?.contratante_id ?? atual?.contratante_id, artista);
  if (!piso) return "Este show não tem artista com piso cadastrado. Leve à equipe antes de falar em valor.";
  if (!(Number(corpo.cache) >= piso)) return `Esse cachê está abaixo do piso de R$ ${reais(piso)}. Leve à equipe antes de propor.`;
  return null;
}

// null = pode; texto = motivo da recusa (o agente deve repassar à equipe)
export async function motivoAgente(env, metodo, rota, corpo) {
  if (metodo === "GET" && LEITURA.some((r) => r.test(rota))) return null;
  if (metodo === "POST" && rota === "contratantes") return null;
  if (metodo === "POST" && /^contratantes\/\d+\/notas$/.test(rota)) return null;
  if (metodo === "POST" && rota === "mensagens/previa") return null; // só monta o texto e os avisos; não registra nada
  if (metodo === "POST" && rota === "mensagens/rascunho") return null; // deixa o rascunho na fila; quem abre e envia é a equipe
  if (metodo === "POST" && rota === "shows") return regraDeShow(env, corpo, null);
  if (metodo === "PUT" && /^shows\/\d+$/.test(rota)) {
    const atual = await env.DB.prepare("SELECT * FROM shows WHERE id = ?").bind(Number(rota.split("/")[1])).first();
    if (!atual) return null; // a gestão responde 404
    if (atual.status !== "consulta") return "Show confirmado ou realizado fica com a equipe.";
    if (atual.recebido || atual.repassado || atual.despesas) return "Show com valores lançados fica com a equipe.";
    // a gestão grava o show inteiro: sem cachê no pedido, o valor voltaria a zero
    if (!valorLancado(corpo?.cache)) return "Ao alterar o show, informe o cachê (em centavos), mesmo que seja o mesmo.";
    return regraDeShow(env, corpo, atual);
  }
  if (metodo === "PUT" && /^shows\/\d+\/proposta$/.test(rota)) return null; // gera o link e deixa aguardando aprovação; o envio é outra rota, bloqueada
  if (metodo === "PUT" && /^contratantes\/\d+$/.test(rota)) {
    const id = Number(rota.split("/")[1]);
    const atual = await env.DB.prepare("SELECT etapa FROM contratantes WHERE id = ?").bind(id).first();
    if (atual?.etapa === "fechado") return "Contato já fechado fica com a equipe.";
    return corpo?.etapa === "fechado" ? "Marcar uma casa como fechada fica com a equipe." : null;
  }
  return "Esta ação fica com a equipe. O agente rascunha, negocia dentro do piso, anota e agenda; o envio e a aprovação são feitos pela equipe.";
}

export async function rotasAgente(req, env, rota) {
  await prepararBanco(env);
  const metodo = req.method;
  if (rota === "painel" && metodo === "GET") return painel(env);
  const acao = rota.match(/^contratantes\/(\d+)\/acao$/);
  if (acao && metodo === "POST") return acaoDoAgente(req, env, Number(acao[1]), await req.json().catch(() => ({})));
  return json({ erro: "Rota não encontrada." }, 404);
}

// o que o agente precisa para decidir o próximo passo: funil, vencidos, sem ação, shows, propostas à espera e limite do dia
async function painel(env) {
  const hoje = hojeSP();
  const daqui60 = hojeSP(Date.now() + 60 * 86400e3);
  const config = await lerConfig(env);
  const simulada = config.simulacao === "1";
  const [etapas, vencidos, semAcao, shows, bloqueados, aguardando] = await env.DB.batch([
    env.DB.prepare("SELECT etapa, COUNT(*) n FROM contratantes WHERE arquivado = '' GROUP BY etapa"),
    env.DB.prepare(
      "SELECT id, nome, cidade, etapa, proxima_acao, proxima_data FROM contratantes WHERE arquivado = '' AND proxima_data <> '' AND proxima_data <= ? AND etapa NOT IN ('fechado', 'perdido') ORDER BY proxima_data LIMIT 50"
    ).bind(hoje),
    env.DB.prepare(
      "SELECT id, nome, cidade, etapa FROM contratantes WHERE arquivado = '' AND proxima_data = '' AND etapa NOT IN ('fechado', 'perdido') ORDER BY nome COLLATE NOCASE LIMIT 50"
    ),
    env.DB.prepare(
      `SELECT s.id, s.data, s.hora, s.artista, s.artista_texto, s.cidade, s.status, s.cache, s.contratante_id, p.token AS token_proposta, p.situacao AS situacao_proposta
       FROM shows s LEFT JOIN propostas p ON p.show_id = s.id WHERE s.data >= ? AND s.data <= ? AND s.status <> 'cancelado' ORDER BY s.data, s.hora LIMIT 50`
    ).bind(hoje, daqui60),
    env.DB.prepare("SELECT COUNT(*) n FROM contratantes WHERE arquivado = '' AND comunicacao = 'bloqueado'"),
    env.DB.prepare(
      `SELECT s.id, s.data, s.artista, s.artista_texto, s.cache, s.contratante_id, p.token FROM propostas p JOIN shows s ON s.id = p.show_id
       WHERE p.situacao = 'aguardando_aprovacao' ORDER BY s.data LIMIT 50`
    ),
  ]);
  return json({
    hoje,
    etapas: Object.fromEntries(etapas.results.map((r) => [r.etapa, r.n])),
    vencidos: vencidos.results,
    sem_proxima_acao: semAcao.results,
    shows_60_dias: shows.results,
    propostas_aguardando_aprovacao: aguardando.results,
    bloqueados: bloqueados.results[0].n,
    abordagens: { hoje: await abordagensHoje(env, simulada), limite: Number(config.limite_diario), simulacao: simulada },
  });
}

// atualiza a etapa (sem "fechado"), a próxima ação com data e, se vier, uma anotação marcada como do agente
async function acaoDoAgente(req, env, id, corpo) {
  const c = await env.DB.prepare("SELECT * FROM contratantes WHERE id = ?").bind(id).first();
  if (!c) return json({ erro: "Contratante não encontrado." }, 404);
  if (c.arquivado) return json({ erro: "Este contratante está arquivado." }, 409);
  if (c.etapa === "fechado") return json({ erro: "Contato já fechado fica com a equipe." }, 403);
  const etapa = corpo?.etapa == null || corpo.etapa === "" ? c.etapa : corpo.etapa;
  if (!ETAPAS_AGENTE.includes(etapa)) return json({ erro: "O agente só move para: a contatar, contatado, negociando ou perdido." }, 403);
  const proximaAcao = txt(corpo?.proxima_acao, 200);
  if (!proximaAcao) return json({ erro: "Diga qual é a próxima ação." }, 400);
  const proximaData = dataOk(corpo?.proxima_data);
  if (!proximaData) return json({ erro: "Marque a data da próxima ação (AAAA-MM-DD)." }, 400);
  const nota = txt(corpo?.nota, 2000);

  const t = agora();
  const detalhe = `${c.etapa} -> ${etapa}; próxima ação: ${proximaAcao} (${proximaData})`;
  const [linha] = await env.DB.batch([
    env.DB.prepare("UPDATE contratantes SET etapa = ?, proxima_acao = ?, proxima_data = ?, atualizado = ? WHERE id = ? RETURNING *").bind(etapa, proximaAcao, proximaData, t, id),
    ...(nota ? [env.DB.prepare("INSERT INTO notas (contratante_id, texto, criado) VALUES (?, ?, ?)").bind(id, PREFIXO_NOTA + nota, t)] : []),
    auditoria(env, req, "agente: atualizou a ação", "contratante", id, detalhe),
  ]);
  return json(linha.results[0]);
}
