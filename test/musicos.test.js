// Cadastro de artistas e músicos: validação do Pix, busca sem acento e os fluxos pela API (só a equipe).
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { BASE, cliente, clienteAgente, entrar, tel } from "./ajuda.js";
import { filtrar, limparInstrumentos, validarPix } from "../src/musicos.js";

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
