// Tabelas do sistema de gestão (banco D1 "site-7a-gestao", binding DB).
// O worker cria o que faltar na primeira chamada de cada instância, então não há migração para rodar à mão.
// Valores em dinheiro ficam em centavos (inteiros).

export const ESQUEMA = [
  `CREATE TABLE IF NOT EXISTS contratantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT 'casa',
    contato TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    instagram TEXT NOT NULL DEFAULT '',
    cidade TEXT NOT NULL DEFAULT '',
    etapa TEXT NOT NULL DEFAULT 'contatar',
    proxima_acao TEXT NOT NULL DEFAULT '',
    proxima_data TEXT NOT NULL DEFAULT '',
    origem TEXT NOT NULL DEFAULT 'manual',
    obs TEXT NOT NULL DEFAULT '',
    criado TEXT NOT NULL,
    atualizado TEXT NOT NULL
  )`,
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
  // controle de pedidos públicos do site (limite por IP)
  `CREATE TABLE IF NOT EXISTS pedidos_ip (ip TEXT NOT NULL, quando TEXT NOT NULL, assinatura TEXT NOT NULL)`,
];
