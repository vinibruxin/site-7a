// Migrações: um banco no formato antigo (antes das versões) sobe para a versão atual sem perder nada.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { migrar } from "../src/banco.js";
import { MIGRACOES } from "../src/esquema.js";

describe("migrações", () => {
  it("leva o banco antigo à versão atual, normaliza telefones e não apaga nada", async () => {
    // tabelas como estavam em produção antes desta versão (sem esquema_versao)
    await env.DB.batch([
      env.DB.prepare("DROP TABLE IF EXISTS antigo_teste"),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS contratantes (id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'casa',
        contato TEXT NOT NULL DEFAULT '', telefone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', instagram TEXT NOT NULL DEFAULT '',
        cidade TEXT NOT NULL DEFAULT '', etapa TEXT NOT NULL DEFAULT 'contatar', proxima_acao TEXT NOT NULL DEFAULT '', proxima_data TEXT NOT NULL DEFAULT '',
        origem TEXT NOT NULL DEFAULT 'manual', obs TEXT NOT NULL DEFAULT '', criado TEXT NOT NULL, atualizado TEXT NOT NULL)`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS notas (id INTEGER PRIMARY KEY AUTOINCREMENT, contratante_id INTEGER NOT NULL REFERENCES contratantes(id) ON DELETE CASCADE, texto TEXT NOT NULL, criado TEXT NOT NULL)`),
    ]);
    const t = new Date().toISOString();
    const ins = (nome, telefone) => env.DB.prepare("INSERT INTO contratantes (nome, telefone, etapa, criado, atualizado) VALUES (?, ?, 'negociando', ?, ?) RETURNING id").bind(nome, telefone, t, t).first();
    const a = await ins("Restaurante Antigo", "31987650001");
    const b = await ins("Casa Repetida", "(31) 98765-0001");
    const c = await ins("Casa Telefone Ruim", "12345");
    const d = await ins("Casa Sem Telefone", "");

    expect(await migrar(env)).toBe(MIGRACOES.at(-1).versao);
    const versoes = (await env.DB.prepare("SELECT versao FROM esquema_versao ORDER BY versao").all()).results.map((r) => r.versao);
    expect(versoes).toEqual(MIGRACOES.map((m) => m.versao));

    const linha = (id) => env.DB.prepare("SELECT * FROM contratantes WHERE id = ?").bind(id).first();
    expect((await linha(a.id)).telefone_norm).toBe("5531987650001");
    expect((await linha(a.id)).etapa).toBe("negociando");
    expect((await linha(a.id)).comunicacao).toBe("livre");
    expect((await linha(b.id)).telefone_norm).toBe(""); // repetido: fica vazio e ganha nota
    expect((await linha(c.id)).telefone_norm).toBe("");
    expect((await linha(d.id)).telefone_norm).toBe("");
    const notas = (id) => env.DB.prepare("SELECT texto FROM notas WHERE contratante_id = ?").bind(id).all();
    expect((await notas(b.id)).results[0].texto).toMatch(/igual ao de Restaurante Antigo/);
    expect((await notas(c.id)).results[0].texto).toMatch(/fora do formato/);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM contratantes").first()).n).toBe(4);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM modelos").first()).n).toBe(2);

    // rodar de novo não muda nada
    await env.DB.prepare("DELETE FROM esquema_versao WHERE versao = 2").run();
    await migrar(env);
    expect((await env.DB.prepare("SELECT COUNT(*) n FROM modelos").first()).n).toBe(2);
    expect((await notas(b.id)).results.length).toBe(1);
  });
});
