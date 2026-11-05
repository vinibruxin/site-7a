// API do agente comercial (Évora): token próprio, o que pode e o que fica com a equipe.
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { BASE, cliente, clienteAgente, entrar, tel } from "./ajuda.js";
import { hojeSP, somarDias } from "../src/banco.js";

let api;
let agente;
let casaId;
beforeAll(async () => {
  api = cliente(await entrar());
  agente = clienteAgente();
  const c = await api("gestao/contratantes", "POST", { nome: "Casa Évora " + Math.random().toString(36).slice(2, 8), contato: "Ana Paula", cidade: "Betim", telefone: tel(), tipo: "casa" });
  casaId = c.id;
});

const novoShow = (dados = {}) =>
  agente("gestao/shows", "POST", { data: somarDias(hojeSP(), 40), artista: "ossos-do-banquete", contratante_id: casaId, cidade: "Betim", ...dados });

describe("autenticação do agente", () => {
  it("sem token, ou com token errado, é recusado", async () => {
    expect((await clienteAgente(null)("agente/painel")).status).toBe(401);
    expect((await clienteAgente("token-errado-qualquer-0000000000000")("agente/painel")).status).toBe(401);
    expect((await clienteAgente(null)("gestao/dados")).status).toBe(401);
  });
  it("o token não abre as rotas do painel como se fosse a senha", async () => {
    expect((await SELF.fetch(BASE + "/api/gestao/dados", { headers: { authorization: "Bearer " + env.AGENTE_TOKEN } })).status).toBe(200);
    expect((await SELF.fetch(BASE + "/api/sessao", { headers: { authorization: "Bearer " + env.AGENTE_TOKEN } })).status).toBe(403);
  });
});

describe("o que o agente lê", () => {
  it("painel com funil, vencidos, shows e limite do dia", async () => {
    const r = await agente("agente/painel");
    expect(r.status).toBe(200);
    expect(r.hoje).toBe(hojeSP());
    expect(r.etapas).toBeTypeOf("object");
    expect(Array.isArray(r.vencidos)).toBe(true);
    expect(Array.isArray(r.sem_proxima_acao)).toBe(true);
    expect(r.abordagens.limite).toBeGreaterThan(0);
  });
  it("ficha, dados e modelos para montar a mensagem", async () => {
    expect((await agente(`gestao/contratantes/${casaId}`)).status).toBe(200);
    expect((await agente("gestao/dados")).status).toBe(200);
    expect((await agente("gestao/modelos")).status).toBe(200);
  });
});

describe("o que fica com a equipe", () => {
  it("enviar proposta por e-mail é recusado", async () => {
    const show = await novoShow();
    const r = await agente(`gestao/shows/${show.id}/proposta/email`, "POST", { para: "a@b.com.br" });
    expect(r.status).toBe(403);
  });
  it("registrar toque no WhatsApp, campanhas e configurações são recusados", async () => {
    expect((await agente("gestao/mensagens", "POST", { chave: "abcdefgh-1234", contratante_id: casaId })).status).toBe(403);
    expect((await agente("gestao/campanhas", "POST", { nome: "X" })).status).toBe(403);
    expect((await agente("gestao/config", "PUT", { limite_diario: 50 })).status).toBe(403);
  });
  it("apagar, arquivar, exportar e trocar a senha são recusados", async () => {
    expect((await agente(`gestao/contratantes/${casaId}`, "DELETE")).status).toBe(403);
    expect((await agente(`gestao/contratantes/${casaId}/parar`, "POST", {})).status).toBe(403);
    expect((await agente("gestao/exportar/contratantes.csv")).status).toBe(403);
    expect((await agente("senha", "POST", { atual: "x", nova: "y".repeat(12) })).status).toBe(403);
    expect((await agente("conteudo", "PUT", { agenda: [], artistas: {} })).status).toBe(403);
  });
  it("show do agente entra só como consulta, sem valores nem publicação", async () => {
    expect((await novoShow({ status: "confirmado" })).status).toBe(403);
    expect((await novoShow({ recebido: 5000 })).status).toBe(403);
    expect((await novoShow({ publicar: 1 })).status).toBe(403);
    const consulta = await novoShow({ status: "consulta" });
    expect(consulta.id).toBeTypeOf("number");
    expect(consulta.status).toBe("consulta");
  });
  it("cachê só acima do piso do artista", async () => {
    expect((await novoShow({ cache: 100000 })).status).toBe(403); // Ossos do Banquete: piso R$ 1.500,00
    expect((await novoShow({ cache: 0 })).status).toBe(403);
    expect((await novoShow({ artista: "aenima", cache: 59999 })).status).toBe(403); // piso R$ 600,00
    expect((await novoShow({ artista: "", artista_texto: "Banda de fora", cache: 500000 })).status).toBe(403); // sem piso cadastrado
    const ok = await novoShow({ artista: "aenima", cache: 60000 });
    expect(ok.id).toBeTypeOf("number");
    expect(ok.cache).toBe(60000);
  });
  it("alterar show pelo agente exige cachê e só se for consulta", async () => {
    const show = await novoShow({ cache: 150000 });
    expect((await agente(`gestao/shows/${show.id}`, "PUT", { artista: "ossos-do-banquete", contratante_id: casaId, cidade: "Betim" })).status).toBe(403);
    expect((await agente(`gestao/shows/${show.id}`, "PUT", { artista: "ossos-do-banquete", contratante_id: casaId, cidade: "Betim", cache: 140000 })).status).toBe(403);
    const r = await agente(`gestao/shows/${show.id}`, "PUT", { artista: "ossos-do-banquete", contratante_id: casaId, cidade: "Betim", cache: 160000 });
    expect(r.cache).toBe(160000);
  });
  it("marcar casa como fechada é recusado, pelo cadastro ou pela ação", async () => {
    expect((await agente(`gestao/contratantes/${casaId}`, "PUT", { nome: "Casa", etapa: "fechado", telefone: tel() })).status).toBe(403);
    expect((await agente(`agente/contratantes/${casaId}/acao`, "POST", { etapa: "fechado", proxima_acao: "x", proxima_data: "2026-12-01" })).status).toBe(403);
  });
});

describe("piso acertado com uma casa", () => {
  it("a casa com piso maior não fecha abaixo dele; as outras seguem o piso do artista", async () => {
    const topo = await api("gestao/contratantes", "POST", { nome: "Casa Piso " + Math.random().toString(36).slice(2, 8), contato: "Jaqueline", cidade: "Nova Lima", telefone: tel(), tipo: "restaurante" });
    const outra = await api("gestao/contratantes", "POST", { nome: "Outra Casa " + Math.random().toString(36).slice(2, 8), contato: "Rafa", cidade: "Betim", telefone: tel(), tipo: "casa" });
    const reg = await api(`gestao/contratantes/${topo.id}/ultimo-cache`, "POST", { artista: "aenima", valor: 80000, origem: "Pagamento do show de 04/03/2025" });
    expect(reg.ok).toBe(true);
    expect((await agente("gestao/shows", "POST", { data: somarDias(hojeSP(), 50), artista: "aenima", contratante_id: topo.id, cidade: "Nova Lima", cache: 70000 })).status).toBe(403);
    expect((await agente("gestao/shows", "POST", { data: somarDias(hojeSP(), 50), artista: "aenima", contratante_id: topo.id, cidade: "Nova Lima", cache: 80000 })).id).toBeTypeOf("number");
    expect((await agente("gestao/shows", "POST", { data: somarDias(hojeSP(), 50), artista: "aenima", contratante_id: outra.id, cidade: "Betim", cache: 70000 })).id).toBeTypeOf("number");
    expect((await api(`gestao/contratantes/${topo.id}`)).ultimos_cache[0].valor).toBe(80000);
  });
  it("o último cachê precisa de origem e valor; a equipe pode registrar abaixo do piso (corrigir), a Évora não", async () => {
    expect((await api(`gestao/contratantes/${casaId}/ultimo-cache`, "POST", { artista: "aenima", valor: 90000 })).status).toBe(400);
    expect((await api(`gestao/contratantes/${casaId}/ultimo-cache`, "POST", { artista: "aenima", valor: 0, origem: "x" })).status).toBe(400);
    expect((await api(`gestao/contratantes/${casaId}/ultimo-cache`, "POST", { artista: "aenima", valor: 30000, origem: "correção da equipe" })).ok).toBe(true);
  });
  it("a Évora não registra o último cachê: ele entra quando a equipe confirma o show", async () => {
    expect((await agente(`gestao/contratantes/${casaId}/ultimo-cache`, "POST", { artista: "aenima", valor: 65000, origem: "fechado" })).status).toBe(403);
    // show em consulta não grava nada
    const show = await api("gestao/shows", "POST", { data: somarDias(hojeSP(), 60), artista: "aenima", contratante_id: casaId, cidade: "Betim", cache: 90000 });
    let ficha = await api(`gestao/contratantes/${casaId}`);
    expect(ficha.ultimos_cache.find((u) => u.artista === "aenima").valor).toBe(30000);
    // equipe confirma: o cachê vira o último da casa
    const confirmado = await api(`gestao/shows/${show.id}`, "PUT", { data: show.data, artista: "aenima", contratante_id: casaId, cidade: "Betim", cache: 90000, status: "confirmado" });
    expect(confirmado.status).toBe("confirmado");
    ficha = await api(`gestao/contratantes/${casaId}`);
    const ultimo = ficha.ultimos_cache.find((u) => u.artista === "aenima");
    expect(ultimo.valor).toBe(90000);
    expect(ultimo.origem.startsWith("Show confirmado em")).toBe(true);
    // a Évora agora não fecha abaixo de R$ 900,00 com essa casa
    expect((await agente("gestao/shows", "POST", { data: somarDias(hojeSP(), 70), artista: "aenima", contratante_id: casaId, cidade: "Betim", cache: 85000 })).status).toBe(403);
  });
});

describe("fila de mensagens", () => {
  it("a Évora deixa rascunho, a equipe abre e confirma, a Évora não abre", async () => {
    const casa = await api("gestao/contratantes", "POST", { nome: "Casa Fila " + Math.random().toString(36).slice(2, 8), contato: "Lucas", cidade: "Betim", telefone: tel(), tipo: "casa" });
    const r = await agente("gestao/mensagens/rascunho", "POST", { contratante_id: casa.id, texto: "Oi, Lucas! Tudo bem? Temos datas em novembro." });
    expect(r.mensagem.situacao).toBe("rascunho");
    expect((await agente("gestao/mensagens/rascunho", "POST", { contratante_id: casa.id, texto: "" })).status).toBe(400);
    expect((await agente(`gestao/mensagens/${r.mensagem.id}/abrir`, "POST", {})).status).toBe(403);
    const fila = await agente("gestao/fila");
    expect(fila.rascunhos.some((m) => m.id === r.mensagem.id)).toBe(true);
    const aberta = await api(`gestao/mensagens/${r.mensagem.id}/abrir`, "POST", {});
    expect(aberta.erro).toBeUndefined();
    expect(aberta.mensagem.situacao).toBe("aberta");
    expect(aberta.link).toMatch(/^https:\/\/wa\.me\//);
    const enviada = await api(`gestao/mensagens/${r.mensagem.id}/confirmar`, "POST", { enviou: true });
    expect(enviada.mensagem.situacao).toBe("enviada");
  });
  it("a equipe lê a mensagem por completo e ajusta o texto; a Évora não edita depois de enviada", async () => {
    const casa = await api("gestao/contratantes", "POST", { nome: "Casa Editar " + Math.random().toString(36).slice(2, 8), contato: "Joana", cidade: "Betim", telefone: tel(), tipo: "casa" });
    const r = await agente("gestao/mensagens/rascunho", "POST", { contratante_id: casa.id, texto: "Oi, Joana. Primeiro texto." });
    const detalhe = await api(`gestao/mensagens/${r.mensagem.id}`);
    expect(detalhe.mensagem.texto).toBe("Oi, Joana. Primeiro texto.");
    expect(detalhe.contratante.nome).toBe(casa.nome);
    const editada = await api(`gestao/mensagens/${r.mensagem.id}/texto`, "PUT", { texto: "Oi, Joana. Texto ajustado pela equipe." });
    expect(editada.mensagem.texto).toBe("Oi, Joana. Texto ajustado pela equipe.");
    expect((await agente(`gestao/mensagens/${r.mensagem.id}/texto`, "PUT", { texto: "outro" })).status).toBe(403);
    expect((await api(`gestao/mensagens/${r.mensagem.id}/texto`, "PUT", { texto: "" })).status).toBe(400);
  });
  it("rascunho para casa sem WhatsApp válido é recusado; descartar só vale para rascunho", async () => {
    const semFone = await api("gestao/contratantes", "POST", { nome: "Casa Sem Fone " + Math.random().toString(36).slice(2, 8), contato: "Ana", cidade: "Betim", tipo: "casa" });
    expect((await agente("gestao/mensagens/rascunho", "POST", { contratante_id: semFone.id, texto: "Oi" })).status).toBe(400);
    const casa = await api("gestao/contratantes", "POST", { nome: "Casa Descarte " + Math.random().toString(36).slice(2, 8), contato: "Rafa", cidade: "Betim", telefone: tel(), tipo: "casa" });
    const r = await agente("gestao/mensagens/rascunho", "POST", { contratante_id: casa.id, texto: "Oi, Rafa." });
    expect((await api(`gestao/mensagens/${r.mensagem.id}/descartar`, "POST", {})).ok).toBe(true);
    expect((await api(`gestao/mensagens/${r.mensagem.id}/descartar`, "POST", {})).status).toBe(409);
  });
  it("resposta colada marca a casa como negociando e guarda o texto no histórico", async () => {
    const casa = await api("gestao/contratantes", "POST", { nome: "Casa Resposta " + Math.random().toString(36).slice(2, 8), contato: "Mari", cidade: "Betim", telefone: tel(), tipo: "casa" });
    const r = await api(`gestao/contratantes/${casa.id}/resposta`, "POST", { texto: "Pode ser sexta, qual o cachê?" });
    expect(r.etapa).toBe("negociando");
    const notas = await api(`gestao/contratantes/${casa.id}/notas`);
    expect(notas.some((n) => n.texto === "Resposta da casa: Pode ser sexta, qual o cachê?")).toBe(true);
  });
});

describe("o que o agente faz", () => {
  it("rascunha a mensagem sem registrar nada", async () => {
    const r = await agente("gestao/mensagens/previa", "POST", { contratante_id: casaId, texto: "Oi, {{primeiro_nome}}! Tudo bem?" });
    expect(r.status).toBe(200);
    expect(r.texto).toBe("Oi, Ana! Tudo bem?");
    const ficha = await api(`gestao/contratantes/${casaId}`);
    expect(ficha.mensagens.length).toBe(0);
  });
  it("monta a proposta, que fica aguardando aprovação e não aparece para a casa", async () => {
    const show = await novoShow({ cache: 150000 });
    const r = await agente(`gestao/shows/${show.id}/proposta`, "PUT", { formato: "Acústico", duracao: "2 horas", condicoes: "Pix", validade: "2026-12-31" });
    expect(r.status).toBe(200);
    expect(r.token).toMatch(/^[a-f0-9]{24}$/);
    expect(r.situacao).toBe("aguardando_aprovacao");
    expect((await SELF.fetch(BASE + "/api/proposta/" + r.token)).status).toBe(404);
    const painel = await agente("agente/painel");
    expect(painel.propostas_aguardando_aprovacao.some((p) => p.token === r.token)).toBe(true);
  });
  it("só a equipe aprova, pelo botão próprio; a casa só vê a proposta depois", async () => {
    const show = await novoShow({ cache: 150000 });
    const token = (await agente(`gestao/shows/${show.id}/proposta`, "PUT", { formato: "Acústico", duracao: "2 horas", condicoes: "Pix", validade: "2026-12-31" })).token;
    expect((await agente(`gestao/shows/${show.id}/proposta/aprovar`, "POST", {})).status).toBe(403);
    // salvar pelo painel não aprova: a proposta da Évora continua aguardando
    const salva = await api(`gestao/shows/${show.id}/proposta`, "PUT", { formato: "Acústico", duracao: "2 horas", condicoes: "Pix", validade: "2026-12-31" });
    expect(salva.situacao).toBe("aguardando_aprovacao");
    expect((await SELF.fetch(BASE + "/api/proposta/" + token)).status).toBe(404);
    const aprovada = await api(`gestao/shows/${show.id}/proposta/aprovar`, "POST", {});
    expect(aprovada.status).toBe(200);
    expect(aprovada.situacao).toBe("aprovada");
    expect(aprovada.enviada).toBe(false); // sem e-mail da casa, ou sem chave do Resend no teste: não envia, e avisa
    expect((await SELF.fetch(BASE + "/api/proposta/" + token)).status).toBe(200);
  });
  it("negociar cachê não reabre a aprovação; mudar a proposta, sim", async () => {
    const show = await novoShow({ cache: 500000 }); // Athos-style: abre acima do piso
    await agente(`gestao/shows/${show.id}/proposta`, "PUT", { formato: "Acústico", duracao: "2 horas", condicoes: "Pix", validade: "2026-12-31" });
    await api(`gestao/shows/${show.id}/proposta/aprovar`, "POST", {});
    await agente(`gestao/shows/${show.id}`, "PUT", { artista: "ossos-do-banquete", contratante_id: casaId, cidade: "Betim", cache: 160000 });
    expect((await api(`gestao/shows/${show.id}/proposta`)).situacao).toBe("aprovada");
    await agente(`gestao/shows/${show.id}/proposta`, "PUT", { formato: "Voz e violão", duracao: "2 horas", condicoes: "Pix", validade: "2026-12-31" });
    expect((await api(`gestao/shows/${show.id}/proposta`)).situacao).toBe("aguardando_aprovacao");
  });
  it("atualiza etapa, próxima ação e anota com a marca do agente", async () => {
    const data = somarDias(hojeSP(), 3);
    const r = await agente(`agente/contratantes/${casaId}/acao`, "POST", { etapa: "negociando", proxima_acao: "Mandar a proposta", proxima_data: data, nota: "Pediu valores para março" });
    expect(r.status).toBe(200);
    expect(r.etapa).toBe("negociando");
    expect(r.proxima_data).toBe(data);
    const notas = await api(`gestao/contratantes/${casaId}/notas`);
    expect(notas.some((n) => n.texto === "Évora: Pediu valores para março")).toBe(true);
    const ficha = await api(`gestao/contratantes/${casaId}`);
    expect(ficha.contratante.etapa).toBe("negociando");
  });
  it("sem data ou sem ação, a atualização é recusada", async () => {
    expect((await agente(`agente/contratantes/${casaId}/acao`, "POST", { proxima_acao: "Ligar" })).status).toBe(400);
    expect((await agente(`agente/contratantes/${casaId}/acao`, "POST", { proxima_data: "2026-12-01" })).status).toBe(400);
  });
});
