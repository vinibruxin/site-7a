// Tabelas do sistema de gestão (banco D1 "site-7a-gestao", binding DB).
// Migrações versionadas: o próprio worker aplica, em ordem, as que ainda não constam em esquema_versao
// (o deploy automático da Cloudflare não roda comandos de migração). Regras:
// - cada passo pode rodar de novo sem estragar nada (IF NOT EXISTS, coluna só se faltar);
// - nenhuma migração apaga tabela, coluna ou linha;
// - migração nova entra sempre no fim da lista, com o número seguinte.
// Valores em dinheiro ficam em centavos (inteiros).

import { normalizarTelefone } from "./telefone.js";

// acrescenta uma coluna se ela ainda não existir (duas instâncias migrando juntas não quebram)
export function coluna(tabela, nome, definicao) {
  return async (env) => {
    const { results } = await env.DB.prepare(`PRAGMA table_info(${tabela})`).all();
    if (results.some((r) => r.name === nome)) return;
    try {
      await env.DB.prepare(`ALTER TABLE ${tabela} ADD COLUMN ${nome} ${definicao}`).run();
    } catch (e) {
      if (!/duplicate column/i.test(String(e?.message || e))) throw e;
    }
  };
}

// v1: o banco como estava antes das versões (tabelas da primeira versão + colunas de endereço)
const BASE = [
  `CREATE TABLE IF NOT EXISTS contratantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'casa',
    contato TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    instagram TEXT NOT NULL DEFAULT '',
    endereco TEXT NOT NULL DEFAULT '',
    numero TEXT NOT NULL DEFAULT '',
    complemento TEXT NOT NULL DEFAULT '',
    bairro TEXT NOT NULL DEFAULT '',
    uf TEXT NOT NULL DEFAULT '',
    cep TEXT NOT NULL DEFAULT '',
    referencia TEXT NOT NULL DEFAULT '',
    cidade TEXT NOT NULL DEFAULT '',
    etapa TEXT NOT NULL DEFAULT 'contatar',
    proxima_acao TEXT NOT NULL DEFAULT '',
    proxima_data TEXT NOT NULL DEFAULT '',
    origem TEXT NOT NULL DEFAULT 'manual',
    obs TEXT NOT NULL DEFAULT '',
    criado TEXT NOT NULL,
    atualizado TEXT NOT NULL
  )`,
  ...["endereco", "numero", "complemento", "bairro", "uf", "cep", "referencia"].map((c) => coluna("contratantes", c, "TEXT NOT NULL DEFAULT ''")),
  `CREATE TABLE IF NOT EXISTS notas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contratante_id INTEGER NOT NULL REFERENCES contratantes(id) ON DELETE CASCADE,
    texto TEXT NOT NULL,
    criado TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS notas_contratante ON notas(contratante_id)`,
  `CREATE TABLE IF NOT EXISTS shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT NOT NULL DEFAULT '',
    hora TEXT NOT NULL DEFAULT '',
    artista TEXT NOT NULL DEFAULT '',
    artista_texto TEXT NOT NULL DEFAULT '',
    contratante_id INTEGER REFERENCES contratantes(id) ON DELETE SET NULL,
    evento TEXT NOT NULL DEFAULT '',
    local TEXT NOT NULL DEFAULT '',
    cidade TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'consulta',
    cache INTEGER NOT NULL DEFAULT 0,
    pct REAL,
    despesas INTEGER NOT NULL DEFAULT 0,
    recebido INTEGER NOT NULL DEFAULT 0,
    repassado INTEGER NOT NULL DEFAULT 0,
    publicar INTEGER NOT NULL DEFAULT 1,
    link TEXT NOT NULL DEFAULT '',
    obs TEXT NOT NULL DEFAULT '',
    criado TEXT NOT NULL,
    atualizado TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS shows_data ON shows(data)`,
  `CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)`,
  // proposta enviada ao contratante: uma por show, aberta pelo link /proposta/<token>
  `CREATE TABLE IF NOT EXISTS propostas (
    show_id INTEGER PRIMARY KEY REFERENCES shows(id) ON DELETE CASCADE,
    token TEXT NOT NULL UNIQUE,
    formato TEXT NOT NULL DEFAULT '',
    duracao TEXT NOT NULL DEFAULT '',
    inclui TEXT NOT NULL DEFAULT '',
    rider TEXT NOT NULL DEFAULT '',
    condicoes TEXT NOT NULL DEFAULT '',
    validade TEXT NOT NULL DEFAULT '',
    criado TEXT NOT NULL,
    atualizado TEXT NOT NULL
  )`,
  // controle de pedidos públicos do site (limite por IP)
  `CREATE TABLE IF NOT EXISTS pedidos_ip (ip TEXT NOT NULL, quando TEXT NOT NULL, assinatura TEXT NOT NULL)`,
];

// preenche telefone_norm dos contratantes que já existiam; repetido ou inválido fica vazio e ganha uma nota
async function normalizarTelefonesAntigos(env) {
  const { results } = await env.DB.prepare("SELECT id, nome, telefone, telefone_norm FROM contratantes ORDER BY id").all();
  const usados = new Map(results.filter((c) => c.telefone_norm).map((c) => [c.telefone_norm, c]));
  // se a migração rodar de novo, não repete a mesma nota
  const { results: notas } = await env.DB.prepare("SELECT contratante_id, texto FROM notas").all();
  const jaTem = new Set(notas.map((n) => n.contratante_id + "|" + n.texto));
  const t = new Date().toISOString();
  const passos = [];
  for (const c of results) {
    if (c.telefone_norm || !c.telefone.trim()) continue;
    const tel = normalizarTelefone(c.telefone);
    let nota = "";
    if (!tel.ok) nota = `Telefone "${c.telefone}" fora do formato. Corrija na ficha para usar o WhatsApp pelo sistema.`;
    else if (usados.has(tel.numero)) nota = `Telefone igual ao de ${usados.get(tel.numero).nome}. Confira qual cadastro está certo.`;
    else {
      usados.set(tel.numero, c);
      passos.push(env.DB.prepare("UPDATE contratantes SET telefone_norm = ? WHERE id = ?").bind(tel.numero, c.id));
    }
    if (nota && !jaTem.has(c.id + "|" + nota)) passos.push(env.DB.prepare("INSERT INTO notas (contratante_id, texto, criado) VALUES (?, ?, ?)").bind(c.id, nota, t));
  }
  if (passos.length) await env.DB.batch(passos);
}

// modelos iniciais (só entram se ainda não houver nenhum)
const MODELOS_INICIAIS = [
  {
    nome: "Primeiro contato",
    etapa: "primeiro",
    perfil: "",
    texto:
      "Olá, {{primeiro_nome|pessoal}}! Tudo bem?\n\nSou da 7A Produtora, de Betim/MG. Trabalhamos com artistas e bandas para apresentações em bares, casas de shows, festivais e eventos.\n\nGostaria de apresentar nosso casting e conhecer melhor a programação do {{casa}}.\n\nPosso te encaminhar nosso material de apresentação?",
  },
  {
    nome: "Cobrança gentil",
    etapa: "cobranca",
    perfil: "",
    texto:
      "Oi, {{primeiro_nome|pessoal}}! Passando para saber se você conseguiu ver minha mensagem sobre o casting da 7A Produtora.\n\nSe fizer sentido para o {{casa}}, te mando o material com os artistas e as datas livres. Nosso site: {{site}}",
  },
];

async function modelosIniciais(env) {
  const tem = await env.DB.prepare("SELECT COUNT(*) n FROM modelos").first();
  if (tem.n > 0) return;
  const t = new Date().toISOString();
  await env.DB.batch(
    MODELOS_INICIAIS.map((m) =>
      env.DB.prepare("INSERT INTO modelos (nome, etapa, perfil, texto, ativo, criado, atualizado) VALUES (?, ?, ?, ?, 1, ?, ?)").bind(m.nome, m.etapa, m.perfil, m.texto, t, t)
    )
  );
}

// v2: relacionamento comercial pelo WhatsApp (versão gratuita, com o link wa.me)
const RELACIONAMENTO = [
  coluna("contratantes", "telefone_norm", "TEXT NOT NULL DEFAULT ''"), // 55 + DDD + número
  coluna("contratantes", "perfil", "TEXT NOT NULL DEFAULT ''"), // '' (não definido) | autoral | classicos | ambos
  coluna("contratantes", "comunicacao", "TEXT NOT NULL DEFAULT 'livre'"), // livre | bloqueado
  coluna("contratantes", "bloqueado_em", "TEXT NOT NULL DEFAULT ''"),
  coluna("contratantes", "arquivado", "TEXT NOT NULL DEFAULT ''"), // data em que foi arquivado ('' = ativo)
  normalizarTelefonesAntigos,
  `CREATE UNIQUE INDEX IF NOT EXISTS contratantes_telefone ON contratantes(telefone_norm) WHERE telefone_norm <> ''`,
  `CREATE INDEX IF NOT EXISTS contratantes_email ON contratantes(email) WHERE email <> ''`,
  `CREATE INDEX IF NOT EXISTS contratantes_proxima ON contratantes(proxima_data)`,
  // cada mudança na autorização de contato, com a prova (ex.: "respondeu em 28/10", "pedido pelo site")
  `CREATE TABLE IF NOT EXISTS consentimentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contratante_id INTEGER NOT NULL REFERENCES contratantes(id),
    situacao TEXT NOT NULL,
    origem TEXT NOT NULL,
    prova TEXT NOT NULL DEFAULT '',
    criado TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS consentimentos_contratante ON consentimentos(contratante_id, criado)`,
  `CREATE TABLE IF NOT EXISTS modelos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    etapa TEXT NOT NULL DEFAULT 'primeiro',
    perfil TEXT NOT NULL DEFAULT '',
    texto TEXT NOT NULL,
    ativo INTEGER NOT NULL DEFAULT 1,
    criado TEXT NOT NULL,
    atualizado TEXT NOT NULL
  )`,
  modelosIniciais,
  `CREATE TABLE IF NOT EXISTS campanhas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    objetivo TEXT NOT NULL DEFAULT '',
    publico TEXT NOT NULL DEFAULT '{}',
    modelo_id INTEGER REFERENCES modelos(id) ON DELETE SET NULL,
    cobranca_modelo_id INTEGER REFERENCES modelos(id) ON DELETE SET NULL,
    cobranca_dias INTEGER NOT NULL DEFAULT 3,
    inicio TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'rascunho',
    simulada INTEGER NOT NULL DEFAULT 0,
    confirmada TEXT NOT NULL DEFAULT '',
    criado TEXT NOT NULL,
    atualizado TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS campanha_destinatarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campanha_id INTEGER NOT NULL REFERENCES campanhas(id),
    contratante_id INTEGER NOT NULL REFERENCES contratantes(id),
    ordem INTEGER NOT NULL,
    situacao TEXT NOT NULL DEFAULT 'pendente',
    etapa TEXT NOT NULL DEFAULT 'abordagem',
    modelo_id INTEGER REFERENCES modelos(id) ON DELETE SET NULL,
    texto TEXT NOT NULL DEFAULT '',
    mensagem_id INTEGER,
    cobrar_em TEXT NOT NULL DEFAULT '',
    motivo TEXT NOT NULL DEFAULT '',
    atualizado TEXT NOT NULL,
    UNIQUE (campanha_id, contratante_id)
  )`,
  `CREATE INDEX IF NOT EXISTS destinatarios_situacao ON campanha_destinatarios(campanha_id, situacao)`,
  `CREATE INDEX IF NOT EXISTS destinatarios_contratante ON campanha_destinatarios(contratante_id)`,
  // cada mensagem aberta no WhatsApp pelo sistema; "enviada" só depois que o operador confirma
  `CREATE TABLE IF NOT EXISTS mensagens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chave TEXT NOT NULL UNIQUE,
    contratante_id INTEGER NOT NULL REFERENCES contratantes(id),
    campanha_id INTEGER REFERENCES campanhas(id),
    destinatario_id INTEGER REFERENCES campanha_destinatarios(id),
    modelo_id INTEGER REFERENCES modelos(id) ON DELETE SET NULL,
    tipo TEXT NOT NULL DEFAULT 'avulsa',
    telefone TEXT NOT NULL,
    texto TEXT NOT NULL,
    situacao TEXT NOT NULL DEFAULT 'aberta',
    simulada INTEGER NOT NULL DEFAULT 0,
    externo_id TEXT UNIQUE,
    criado TEXT NOT NULL,
    atualizado TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS mensagens_contratante ON mensagens(contratante_id, criado)`,
  `CREATE INDEX IF NOT EXISTS mensagens_criado ON mensagens(criado)`,
  // o que aconteceu com as mensagens: nesta versão, marcado pelo operador; na paga, os status da Meta
  `CREATE TABLE IF NOT EXISTS eventos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contratante_id INTEGER NOT NULL REFERENCES contratantes(id),
    mensagem_id INTEGER REFERENCES mensagens(id),
    tipo TEXT NOT NULL,
    origem TEXT NOT NULL DEFAULT 'operador',
    detalhe TEXT NOT NULL DEFAULT '',
    externo_id TEXT UNIQUE,
    criado TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS eventos_contratante ON eventos(contratante_id, criado)`,
  `CREATE INDEX IF NOT EXISTS eventos_tipo ON eventos(tipo, criado)`,
  `CREATE TABLE IF NOT EXISTS auditoria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quando TEXT NOT NULL,
    acao TEXT NOT NULL,
    entidade TEXT NOT NULL,
    entidade_id INTEGER,
    detalhe TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS auditoria_entidade ON auditoria(entidade, entidade_id, quando)`,
];

export const MIGRACOES = [
  { versao: 1, nome: "base", passos: BASE },
  { versao: 2, nome: "relacionamento pelo WhatsApp", passos: RELACIONAMENTO },
];
