// Funções puras: telefone, modelos, link do WhatsApp e leitura de CSV.
import { describe, it, expect } from "vitest";
import { normalizarTelefone, formatarTelefone } from "../src/telefone.js";
import { validarModelo, preencher, valoresDe } from "../src/modelos.js";
import { montarLinkWhatsApp } from "../src/whatsapp.js";
import { lerCSV, mapearColunas, perfilDoTexto, tipoDoTexto } from "../src/csv.js";
import { somarDias, inicioDoDia } from "../src/banco.js";

describe("telefone", () => {
  it("normaliza os formatos que as pessoas digitam para 55 + DDD + número", () => {
    for (const t of ["(31) 99223-3295", "31992233295", "031 99223 3295", "+55 31 9 9223-3295", "55 31 99223-3295", "0 21 31 99223-3295", "0055 31 99223 3295"]) {
      expect(normalizarTelefone(t)).toEqual({ ok: true, numero: "5531992233295" });
    }
    expect(normalizarTelefone("(31) 3532-1234")).toEqual({ ok: true, numero: "553135321234" });
  });
  it("vazio é aceito (contato sem telefone)", () => {
    expect(normalizarTelefone("")).toEqual({ ok: true, numero: "" });
  });
  it("recusa número incompleto, DDD inexistente e celular sem o 9", () => {
    expect(normalizarTelefone("99223-3295").ok).toBe(false);
    expect(normalizarTelefone("(20) 99223-3295").ok).toBe(false);
    expect(normalizarTelefone("(31) 89223-32951").ok).toBe(false);
    expect(normalizarTelefone("+1 415 555 0100").ok).toBe(false);
    expect(normalizarTelefone("abc").ok).toBe(false);
  });
  it("formata para mostrar", () => {
    expect(formatarTelefone("5531992233295")).toBe("(31) 99223-3295");
    expect(formatarTelefone("553135321234")).toBe("(31) 3532-1234");
  });
});

describe("modelos", () => {
  it("aceita as variáveis conhecidas, com e sem reserva", () => {
    expect(validarModelo("Olá, {{primeiro_nome|pessoal}}! Programação do {{casa}} em {{cidade}}. {{site}}")).toEqual([]);
  });
  it("recusa variável desconhecida, chave sem fechar e texto vazio", () => {
    expect(validarModelo("Oi {{nome}}")[0]).toMatch(/desconhecida/);
    expect(validarModelo("Oi {{casa")[0]).toMatch(/não fechada/);
    expect(validarModelo("Oi casa}}")[0]).toMatch(/sem o \{\{/);
    expect(validarModelo("Oi {{casa {{cidade}}")[0]).toMatch(/não fechada/);
    expect(validarModelo("   ")[0]).toMatch(/Escreva/);
    expect(validarModelo("Oi {{}}")[0]).toMatch(/vazia/);
  });
  it("preenche, usa a reserva e aponta o que falta", () => {
    const v = valoresDe({ nome: "Bar do Zé", contato: "", cidade: "Betim" });
    expect(preencher("Olá, {{primeiro_nome|pessoal}}! {{casa}}, {{cidade}}", v)).toEqual({ texto: "Olá, pessoal! Bar do Zé, Betim", faltando: [] });
    expect(preencher("Olá, {{primeiro_nome}}!", v).faltando).toEqual(["primeiro_nome"]);
    expect(preencher("Oi {{primeiro_nome}}", valoresDe({ contato: "Maria Clara Souza" })).texto).toBe("Oi Maria");
  });
});

describe("link do WhatsApp", () => {
  it("monta o wa.me com número normalizado e texto codificado", () => {
    const r = montarLinkWhatsApp("(31) 99223-3295", "Olá, Zé! Tudo bem?\n7A & cia");
    expect(r.ok).toBe(true);
    expect(r.link).toBe("https://wa.me/5531992233295?text=" + encodeURIComponent("Olá, Zé! Tudo bem?\n7A & cia"));
  });
  it("recusa número inválido, sem telefone, texto vazio e variável sem preencher", () => {
    expect(montarLinkWhatsApp("123", "oi").ok).toBe(false);
    expect(montarLinkWhatsApp("", "oi").erro).toMatch(/não tem telefone/);
    expect(montarLinkWhatsApp("31992233295", "  ").erro).toMatch(/vazia/);
    expect(montarLinkWhatsApp("31992233295", "Oi {{casa}}").erro).toMatch(/sem preencher/);
  });
});

describe("CSV", () => {
  it("lê ponto e vírgula do Excel, aspas e quebra de linha dentro de aspas", () => {
    const l = lerCSV('﻿Nome;Telefone;Obs\r\n"Bar ""do"" Zé";(31) 99223-3295;"linha 1\nlinha 2"\r\n;;\r\n');
    expect(l).toEqual([["Nome", "Telefone", "Obs"], ['Bar "do" Zé', "(31) 99223-3295", "linha 1\nlinha 2"]]);
  });
  it("lê vírgula do Google Planilhas e reconhece os títulos", () => {
    const l = lerCSV("Estabelecimento,Responsável,WhatsApp,E-mail,Município,Estado\nCasa X,Ana,31999990000,a@b.com,Betim,MG");
    expect(mapearColunas(l[0])).toEqual({ nome: 0, contato: 1, telefone: 2, email: 3, cidade: 4, uf: 5 });
  });
  it("traduz tipo e perfil escritos à mão", () => {
    expect(tipoDoTexto("Bar ou casa de show")).toBe("casa");
    expect(tipoDoTexto("Festa particular")).toBe("particular");
    expect(perfilDoTexto("Clássicos do rock")).toBe("classicos");
    expect(perfilDoTexto("autoral e clássicos")).toBe("ambos");
    expect(perfilDoTexto("Autoral")).toBe("autoral");
  });
});

describe("datas", () => {
  it("soma dias e acha o começo do dia em Betim", () => {
    expect(somarDias("2026-10-30", 3)).toBe("2026-11-02");
    expect(inicioDoDia("2026-10-28")).toBe("2026-10-28T03:00:00.000Z");
  });
});
