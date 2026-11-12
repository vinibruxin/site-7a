// Cadastro de artistas e músicos: validação do Pix, busca sem acento e os fluxos pela API (só a equipe).
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { BASE, cliente, clienteAgente, entrar, tel } from "./ajuda.js";
import { filtrar, limparInstrumentos, validarGrupo, validarPix } from "../src/musicos.js";

let api;
beforeAll(async () => {
  api = cliente(await entrar());
});

describe("chave Pix", () => {
  it("confere cada tipo e guarda no formato do Pix", () => {
    expect(validarPix("cnpj", "11.222.333/0001-81")).toEqual({ ok: true, tipo: "cnpj", valor: "11222333000181" });
    expect(validarPix("celular", "(31) 99223-3295")).toEqual({ ok: true, tipo: "celular", valor: "+5531992233295" });
    expect(validarPix("email", " Banda@Exemplo.com ")).toEqual({ ok: true, tipo: "email", valor: "banda@exemplo.com" });
    expect(validarPix("aleatoria", "123E4567-E89B-12D3-A456-426614174000").valor).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(validarPix("", "")).toEqual({ ok: true, tipo: "", valor: "" });
  });
  it("recusa chave que não bate com o tipo", () => {
    expect(validarPix("cpf", "11.222.333/0001-81").ok).toBe(false);
    expect(validarPix("cpf", "111.111.111-11").ok).toBe(false);
    expect(validarPix("email", "sem-arroba").ok).toBe(false);
    expect(validarPix("aleatoria", "1234").ok).toBe(false);
    expect(validarPix("", "qualquer").ok).toBe(false);
  });
});

describe("grupo do WhatsApp", () => {
  it("aceita o link de convite e recusa outro endereço", () => {
    expect(validarGrupo("chat.whatsapp.com/AbCdEfGhIjKlMnOp")).toEqual({ ok: true, valor: "https://chat.whatsapp.com/AbCdEfGhIjKlMnOp" });
    expect(validarGrupo("https://chat.whatsapp.com/AbCdEfGhIjKlMnOp?mode=r_c").valor).toBe("https://chat.whatsapp.com/AbCdEfGhIjKlMnOp");
    expect(validarGrupo("").ok).toBe(true);
    expect(validarGrupo("https://exemplo.com/grupo").ok).toBe(false);
  });
});

describe("casting já cadastrado", () => {
  it("os 6 do casting entram marcados, ligados ao site, só com o nome", async () => {
    const lista = await api("gestao/musicos?casting=sim");
    const porSlug = Object.fromEntries(lista.filter((m) => m.slug).map((m) => [m.slug, m]));
    expect(Object.keys(porSlug).sort()).toEqual(["aenima", "athos-tibaes", "dj-ivan-lennon", "ordem-mor", "ossos-do-banquete", "sub-rosa"]);
    expect(porSlug.aenima.nome).toBe("Ænima");
    for (const m of Object.values(porSlug)) {
      expect(m.casting).toBe(true);
      expect(m.pct).toBe(20);
      expect([m.telefone, m.pix_chave, m.grupo, m.cidade, m.estilo]).toEqual(["", "", "", "", ""]);
    }
    // editar mantém a ligação com o site e grava o grupo
    const ed = await api("gestao/musicos/" + porSlug["sub-rosa"].id, "PUT", { ...porSlug["sub-rosa"], grupo: "https://chat.whatsapp.com/GrupoTesteSubRosa1" });
    expect(ed.slug).toBe("sub-rosa");
    expect(ed.grupo).toBe("https://chat.whatsapp.com/GrupoTesteSubRosa1");
    await api("gestao/musicos/" + ed.id, "PUT", { ...ed, grupo: "" });
  });
});

describe("formação e busca", () => {
  it("instrumentos sem repetição, com inicial maiúscula", () => {
    expect(limparInstrumentos("voz, Violão, violao,  guitarra ")).toEqual(["Voz", "Violão", "Guitarra"]);
  });
  it("busca por nome, instrumento ou cidade, sem ligar para acento", () => {
    const l = [
      { nome: "Zé da Guitarra", cidade: "Betim", estilo: "Rock", instrumentos: ["Guitarra"], casting: false },
      { nome: "Ana Voz", cidade: "Contagem", estilo: "MPB", instrumentos: ["Voz", "Violão"], casting: true },
    ];
    expect(filtrar(l, { q: "violao" }).map((m) => m.nome)).toEqual(["Ana Voz"]);
    expect(filtrar(l, { q: "guitarra betim" }).map((m) => m.nome)).toEqual(["Zé da Guitarra"]);
    expect(filtrar(l, { cidade: "contagem" }).length).toBe(1);
    expect(filtrar(l, { instrumento: "Violão" }).length).toBe(1);
    expect(filtrar(l, { casting: "nao" }).map((m) => m.nome)).toEqual(["Zé da Guitarra"]);
  });
});

describe("API do cadastro", () => {
  it("cadastra, busca, edita e exclui", async () => {
    const telefone = tel();
    const novo = await api("gestao/musicos", "POST", {
      nome: "Teste Baterista", telefone, pix_tipo: "email", pix_chave: "pix@exemplo.com", cidade: "Betim", estilo: "Rock",
      instrumentos: ["Bateria", "voz"], casting: false, obs: "Toca em casamento também",
    });
    expect(novo.status).toBe(200);
    expect(novo.telefone).toMatch(/^5531/);
    expect(novo.instrumentos).toEqual(["Bateria", "Voz"]);
    expect(novo.casting).toBe(false);

    const achados = await api("gestao/musicos?q=bateria%20betim");
    expect(achados.some((m) => m.id === novo.id)).toBe(true);
    expect((await api("gestao/musicos?instrumento=guitarra")).some((m) => m.id === novo.id)).toBe(false);

    // mesmo WhatsApp não entra duas vezes
    const repetido = await api("gestao/musicos", "POST", { nome: "Outro", telefone });
    expect(repetido.status).toBe(409);
    expect(repetido.existente.id).toBe(novo.id);

    const editado = await api("gestao/musicos/" + novo.id, "PUT", { ...novo, casting: true, instrumentos: ["Bateria"] });
    expect(editado.casting).toBe(true);
    expect(editado.instrumentos).toEqual(["Bateria"]);

    expect((await api("gestao/musicos/" + novo.id, "DELETE")).ok).toBe(true);
    expect((await api("gestao/musicos/" + novo.id)).status).toBe(404);
  });

  it("% da 7A: 30% para quem é de fora, % padrão para o casting, e cada um pode ter o seu", async () => {
    await api("gestao/config", "PUT", { pct_padrao: 20, base: "bruto" });
    const fora = await api("gestao/musicos", "POST", { nome: "Teste Fora", telefone: tel() });
    expect(fora.pct).toBe(30);
    const casting = await api("gestao/musicos", "POST", { nome: "Teste Casting", telefone: tel(), casting: true });
    expect(casting.pct).toBe(20);
    const proprio = await api("gestao/musicos", "POST", { nome: "Teste Próprio", telefone: tel(), pct: "25,5" });
    expect(proprio.pct).toBe(25.5);
    expect((await api("gestao/musicos", "POST", { nome: "Teste Ruim", pct: 120 })).status).toBe(400);
    // o % de fora muda em Ajustes
    const cfg = await api("gestao/config", "PUT", { pct_padrao: 20, pct_fora: 35, base: "bruto" });
    expect(cfg.pct_fora).toBe("35");
    expect((await api("gestao/musicos", "POST", { nome: "Teste Fora 2", telefone: tel() })).pct).toBe(35);
    await api("gestao/config", "PUT", { pct_padrao: 20, pct_fora: 30, base: "bruto" });
  });

  it("recusa sem nome, telefone ruim e Pix errado", async () => {
    expect((await api("gestao/musicos", "POST", { nome: "" })).status).toBe(400);
    expect((await api("gestao/musicos", "POST", { nome: "X", telefone: "123" })).status).toBe(400);
    expect((await api("gestao/musicos", "POST", { nome: "X", pix_tipo: "cpf", pix_chave: "123" })).status).toBe(400);
  });

  it("sem login não lê nada, e o agente também não", async () => {
    const r = await SELF.fetch(BASE + "/api/gestao/musicos");
    expect(r.status).toBe(401);
    const agente = clienteAgente();
    expect((await agente("gestao/musicos")).status).toBe(403);
    expect((await agente("gestao/musicos", "POST", { nome: "Invasor" })).status).toBe(403);
  });

  it("WhatsApp e Pix não aparecem na carga do painel nem no site público", async () => {
    const pix = "segredo-" + Date.now() + "@exemplo.com";
    const m = await api("gestao/musicos", "POST", { nome: "Teste Sigilo", telefone: tel(), pix_tipo: "email", pix_chave: pix });
    expect(m.status).toBe(200);
    const dados = await api("gestao/dados");
    expect(JSON.stringify(dados)).not.toContain(pix);
    for (const p of ["/", "/api/conteudo", "/agenda.json"]) {
      const corpo = await (await SELF.fetch(BASE + p)).text();
      expect(corpo).not.toContain(pix);
    }
    await api("gestao/musicos/" + m.id, "DELETE");
  });
});
