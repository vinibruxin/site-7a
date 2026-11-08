// Recibos e notas fiscais: validação de CPF/CNPJ, valor por extenso e os fluxos pela API.
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { BASE, cliente, clienteAgente, entrar, tel } from "./ajuda.js";
import { formatarDocumento, porExtenso, validarDocumento } from "../src/documentos.js";
import { hojeSP, somarDias } from "../src/banco.js";

// CPF válido gerado na hora (não é de ninguém de propósito: base aleatória)
function cpfValido() {
  const b = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  if (b.every((x) => x === b[0])) b[0] = (b[0] + 1) % 10;
  const dv = (arr) => { const n = arr.length; const s = arr.reduce((t, x, i) => t + x * (n + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  b.push(dv(b)); b.push(dv(b));
  return b.join("");
}

let api;
beforeAll(async () => {
  api = cliente(await entrar());
});

describe("CPF e CNPJ", () => {
  it("aceita CPF e CNPJ válidos, com ou sem pontuação", () => {
    const cpf = cpfValido();
    expect(validarDocumento(formatarDocumento(cpf))).toEqual({ ok: true, valor: cpf, tipo: "cpf" });
    expect(validarDocumento("11.222.333/0001-81")).toEqual({ ok: true, valor: "11222333000181", tipo: "cnpj" });
    expect(validarDocumento("")).toEqual({ ok: true, valor: "", tipo: "" });
  });
  it("aceita o CNPJ alfanumérico da Receita", () => {
    expect(validarDocumento("12.ABC.345/01DE-35").ok).toBe(true);
    expect(validarDocumento("12.ABC.345/01DE-36").ok).toBe(false);
  });
  it("recusa dígito errado, repetido e tamanho estranho", () => {
    expect(validarDocumento("111.111.111-11").ok).toBe(false);
    expect(validarDocumento("11.222.333/0001-82").ok).toBe(false);
    expect(validarDocumento("12345").ok).toBe(false);
  });
});

describe("valor por extenso", () => {
  it("escreve os valores do jeito do recibo", () => {
    expect(porExtenso(150000)).toBe("mil e quinhentos reais");
    expect(porExtenso(80000)).toBe("oitocentos reais");
    expect(porExtenso(30050)).toBe("trezentos reais e cinquenta centavos");
    expect(porExtenso(100)).toBe("um real");
    expect(porExtenso(10000)).toBe("cem reais");
    expect(porExtenso(12000)).toBe("cento e vinte reais");
    expect(porExtenso(123456)).toBe("mil duzentos e trinta e quatro reais e cinquenta e seis centavos");
    expect(porExtenso(210000)).toBe("dois mil e cem reais");
    expect(porExtenso(2500000)).toBe("vinte e cinco mil reais");
    expect(porExtenso(1)).toBe("um centavo");
    expect(porExtenso(100000000)).toBe("um milhão de reais");
  });
});

async function showComCasa(dados = {}) {
  const c = await api("gestao/contratantes", "POST", { nome: "Bar " + Math.random().toString(36).slice(2, 7), contato: "Ana", cidade: "Betim", telefone: tel(), tipo: "casa" });
  const s = await api("gestao/shows", "POST", { data: somarDias(hojeSP(), -2), hora: "20:00", artista: "aenima", contratante_id: c.id, local: c.nome, cidade: "Betim", status: "realizado", cache: 80000, ...dados });
  return { c, s };
}

describe("recibo", () => {
  it("sem os dados da 7A, emite com os campos marcados como faltando", async () => {
    await api("gestao/emitente", "PUT", { emit_nome: "", emit_doc: "" });
    const { s } = await showComCasa();
    const r = await api("gestao/documentos", "POST", { tipo: "recibo", show_id: s.id, valor: 40000, data: hojeSP(), forma: "Pix", pagador_nome: "Bar Teste", referente: "Sinal do show" });
    expect(r.status).toBe(200);
    expect(r.faltas_emitente).toEqual(["Nome ou razão social", "CPF ou CNPJ"]);
    const p = await (await SELF.fetch(BASE + "/api/recibo/" + r.token)).json();
    expect(p.emitente.nome).toBe("");
    expect(p.faltas.length).toBe(2);
  });

  it("numera em sequência, soma no recebido do show, aparece no link e cancela desfazendo", async () => {
    const cpf = cpfValido();
    await api("gestao/emitente", "PUT", { emit_nome: "Nome de Teste", emit_doc: "11.222.333/0001-81", emit_cidade: "Betim, MG" });
    const { c, s } = await showComCasa();
    const r1 = await api("gestao/documentos", "POST", { tipo: "recibo", show_id: s.id, valor: 30000, data: hojeSP(), forma: "Pix", pagador_nome: c.nome, pagador_doc: formatarDocumento(cpf), referente: "Sinal", lancar_recebido: true });
    const r2 = await api("gestao/documentos", "POST", { tipo: "recibo", show_id: s.id, valor: 50000, data: hojeSP(), forma: "Dinheiro", pagador_nome: c.nome, referente: "Restante", lancar_recebido: true });
    expect(r2.numero).toBe(r1.numero + 1);
    expect(r1.numero_texto).toMatch(/^7A-R-\d{4}$/);
    expect(r1.faltas_emitente).toEqual([]);

    const dados = await api("gestao/dados");
    expect(dados.shows.find((x) => x.id === s.id).recebido).toBe(80000);
    // o CPF fica guardado no cadastro da casa para o próximo documento
    expect((await api("gestao/contratantes/" + c.id)).contratante.documento).toBe(cpf);

    const pagina = await SELF.fetch(BASE + "/recibo/" + r1.token);
    expect(pagina.status).toBe(200);
    expect(pagina.headers.get("x-robots-tag")).toBe("noindex");
    const p = await (await SELF.fetch(BASE + "/api/recibo/" + r1.token)).json();
    expect(p).toMatchObject({ valor: 30000, extenso: "trezentos reais", situacao: "emitido", emitente: { nome: "Nome de Teste", doc: "11.222.333/0001-81" } });
    expect(p.pagador.doc).toBe(formatarDocumento(cpf));

    // recibo emitido não se edita
    expect((await api("gestao/documentos/" + r1.id, "PUT", { valor: 1 })).status).toBe(409);
    expect((await api("gestao/documentos/" + r1.id + "/cancelar", "POST", {})).status).toBe(400);
    const can = await api("gestao/documentos/" + r1.id + "/cancelar", "POST", { motivo: "Valor errado" });
    expect(can.situacao).toBe("cancelado");
    expect((await api("gestao/dados")).shows.find((x) => x.id === s.id).recebido).toBe(50000);
    expect((await (await SELF.fetch(BASE + "/api/recibo/" + r1.token)).json()).situacao).toBe("cancelado");

    const lista = await api("gestao/documentos?show=" + s.id);
    expect(lista.length).toBe(2);
  });

  it("recusa recibo sem valor, com data futura ou com CPF errado", async () => {
    const base = { tipo: "recibo", valor: 10000, data: hojeSP(), pagador_nome: "Fulano", referente: "Show" };
    expect((await api("gestao/documentos", "POST", { ...base, valor: 0 })).status).toBe(400);
    expect((await api("gestao/documentos", "POST", { ...base, data: somarDias(hojeSP(), 3) })).status).toBe(400);
    expect((await api("gestao/documentos", "POST", { ...base, pagador_doc: "123.456.789-00" })).status).toBe(400);
    expect((await api("gestao/emitente", "PUT", { emit_doc: "11.222.333/0001-00" })).status).toBe(400);
  });

  it("token inválido ou de nota fiscal não abre recibo", async () => {
    expect((await SELF.fetch(BASE + "/api/recibo/zzz")).status).toBe(404);
    const n = await api("gestao/documentos", "POST", { tipo: "nfse", valor: 10000, pagador_nome: "X" });
    expect((await SELF.fetch(BASE + "/api/recibo/" + n.token)).status).toBe(404);
  });
});

describe("nota fiscal (preparo, sem emissão)", () => {
  it("vai de rascunho a pronta, monta o texto do Emissor Nacional e registra o número depois", async () => {
    const { c, s } = await showComCasa({ cache: 150000 });
    const n = await api("gestao/documentos", "POST", { tipo: "nfse", show_id: s.id, valor: 150000, data: hojeSP(), pagador_nome: c.nome, nfse: { descricao: "Show musical" } });
    expect(n.situacao).toBe("rascunho");
    expect(n.numero).toBe(null);
    expect(n.faltas).toContain("CPF ou CNPJ do tomador");
    expect(n.emissor).toBe("https://www.nfse.gov.br/EmissorNacional");

    const p = await api("gestao/documentos/" + n.id, "PUT", { pagador_doc: "11222333000181", nfse: { codigo_servico: "teste", municipio: "Betim/MG", aliquota: "2,5" } });
    expect(p.situacao).toBe("pronta");
    expect(p.faltas).toEqual([]);
    expect(p.texto_emissor).toContain("Valor do serviço: R$ 1.500,00");
    expect(p.texto_emissor).toContain("ISS estimado: R$ 37,50");
    expect(p.texto_emissor).toContain("11.222.333/0001-81");

    expect((await api("gestao/documentos/" + n.id + "/emitida", "POST", { emitida_em: hojeSP() })).status).toBe(400);
    const e = await api("gestao/documentos/" + n.id + "/emitida", "POST", { numero_nota: "123", emitida_em: hojeSP() });
    expect(e.situacao).toBe("emitida");
    expect(e.nfse.numero_nota).toBe("123");
    expect((await api("gestao/documentos/" + n.id, "PUT", { valor: 1 })).status).toBe(409);
    // registrar a nota não mexe no recebido do show
    expect((await api("gestao/dados")).shows.find((x) => x.id === s.id).recebido).toBe(0);
  });
});

describe("agente e anônimo", () => {
  it("o agente e quem não entrou não mexem em recibos nem notas", async () => {
    const ag = clienteAgente();
    expect((await ag("gestao/documentos")).status).toBe(403);
    expect((await ag("gestao/documentos", "POST", { tipo: "recibo", valor: 100, data: hojeSP(), pagador_nome: "X", referente: "Y" })).status).toBe(403);
    expect((await ag("gestao/emitente", "PUT", { emit_nome: "X" })).status).toBe(403);
    const anon = cliente(null);
    expect((await anon("gestao/documentos")).status).toBe(401);
  });
});
