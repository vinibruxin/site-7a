// Fluxos da gestão pela API, dentro do runtime do Workers com D1 e KV locais.
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { BASE, chave, cliente, entrar, tel } from "./ajuda.js";
import { hojeSP, somarDias } from "../src/banco.js";

let api;
beforeAll(async () => {
  api = cliente(await entrar());
});

const novo = (dados = {}) => api("gestao/contratantes", "POST", { nome: "Casa " + Math.random().toString(36).slice(2, 8), contato: "Ana Paula", cidade: "Betim", telefone: tel(), tipo: "casa", ...dados });
// deixa o limite diário folgado (ou justo) para o teste não depender dos outros
async function limiteFolga(folga = 50, extra = {}) {
  const ind = await api("gestao/indicadores");
  return api("gestao/config", "PUT", { pct_padrao: "", base: "bruto", limite_diario: ind.hoje.abordagens + folga, intervalo_dias: 3, simulacao: false, ...extra });
}

describe("autorização", () => {
  it("rotas da gestão sem login são recusadas", async () => {
    const anon = cliente(null);
    expect((await anon("gestao/dados")).status).toBe(401);
    expect((await anon("gestao/contratantes", "POST", { nome: "X" })).status).toBe(401);
    expect((await anon("gestao/mensagens", "POST", { chave: chave(), contratante_id: 1 })).status).toBe(401);
    expect((await anon("gestao/campanhas")).status).toBe(401);
    expect((await anon("gestao/contratantes/importar", "POST", { csv: "Nome\nX" })).status).toBe(401);
  });
  it("pedido que muda dados vindo de outro site é recusado", async () => {
    const r = await SELF.fetch(BASE + "/api/entrar", { method: "POST", headers: { origin: "https://outro.site", "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(403);
  });
  it("senha errada não entra", async () => {
    const r = await SELF.fetch(BASE + "/api/entrar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ senha: "errada" }) });
    expect(r.status).toBe(401);
  });
});

describe("contratantes", () => {
  it("cadastra com telefone normalizado e perfil", async () => {
    const r = await novo({ telefone: "031 98877-6655", perfil: "autoral", email: "Bar@Exemplo.com" });
    expect(r.status).toBe(200);
    expect(r.telefone_norm).toBe("5531988776655");
    expect(r.telefone).toBe("(31) 98877-6655");
    expect(r.email).toBe("bar@exemplo.com");
    expect(r.perfil).toBe("autoral");
    expect(r.comunicacao).toBe("livre");
    expect(r.origem).toBe("manual");
  });
  it("recusa telefone inválido e e-mail fora do formato", async () => {
    expect((await novo({ telefone: "9988" })).status).toBe(400);
    expect((await novo({ email: "sem-arroba" })).status).toBe(400);
    expect((await novo({ nome: "" })).status).toBe(400);
  });
  it("impede duplicidade pelo telefone em formatos diferentes, e pelo e-mail", async () => {
    const t = tel();
    const a = await novo({ telefone: t, email: "dup" + Date.now() + "@x.com" });
    const digitos = t.replace(/\D/g, "");
    const b = await novo({ telefone: "+55 " + digitos.slice(0, 2) + " " + digitos.slice(2) });
    expect(b.status).toBe(409);
    expect(b.existente.id).toBe(a.id);
    const c = await novo({ email: a.email.toUpperCase() });
    expect(c.status).toBe(409);
    const outro = await novo();
    const d = await api("gestao/contratantes/" + outro.id, "PUT", { ...outro, telefone: t });
    expect(d.status).toBe(409);
  });
  it("apagar arquiva, sem perder o histórico, e o telefone continua reservado", async () => {
    const a = await novo();
    await api(`gestao/contratantes/${a.id}/notas`, "POST", { texto: "ligou" });
    expect((await api("gestao/contratantes/" + a.id, "DELETE")).ok).toBe(true);
    const f = await api("gestao/contratantes/" + a.id);
    expect(f.contratante.arquivado).toBe(hojeSP());
    expect((await api(`gestao/contratantes/${a.id}/notas`)).length).toBe(1);
    const dup = await novo({ telefone: a.telefone });
    expect(dup.status).toBe(409);
    expect(dup.existente.arquivado).toBeTruthy();
    expect((await api(`gestao/contratantes/${a.id}/restaurar`, "POST")).arquivado).toBe("");
  });
  it("busca e pagina no servidor", async () => {
    const marca = "Pag" + Date.now();
    for (let i = 0; i < 3; i++) await novo({ nome: `${marca} ${i}` });
    const p1 = await api(`gestao/contratantes?busca=${marca}&por=2`);
    expect(p1.total).toBe(3);
    expect(p1.itens.length).toBe(2);
    const p2 = await api(`gestao/contratantes?busca=${marca}&por=2&pagina=2`);
    expect(p2.itens.length).toBe(1);
    const porTelefone = await api(`gestao/contratantes?busca=${p2.itens[0].telefone_norm.slice(-8)}`);
    expect(porTelefone.itens.map((x) => x.id)).toContain(p2.itens[0].id);
  });
});

describe("bloqueio", () => {
  it("pedir para parar bloqueia na hora e o servidor recusa qualquer abertura", async () => {
    await limiteFolga();
    const c = await novo();
    const b = await api(`gestao/contratantes/${c.id}/parar`, "POST", { detalhe: "Respondeu \"me tire da lista\"" });
    expect(b.comunicacao).toBe("bloqueado");
    const m = await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: c.id, texto: "Olá!" });
    expect(m.status).toBe(409);
    expect(m.codigo).toBe("bloqueado");
    const { results } = await env.DB.prepare("SELECT * FROM mensagens WHERE contratante_id = ?").bind(c.id).all();
    expect(results.length).toBe(0);
    const prova = await env.DB.prepare("SELECT * FROM consentimentos WHERE contratante_id = ?").bind(c.id).first();
    expect(prova.situacao).toBe("bloqueado");
    expect(prova.prova).toMatch(/me tire da lista/);
  });
  it("só desbloqueia com confirmação e motivo, e fica na auditoria", async () => {
    const c = await novo();
    await api(`gestao/contratantes/${c.id}/parar`, "POST", {});
    expect((await api(`gestao/contratantes/${c.id}/desbloquear`, "POST", { motivo: "pediu para voltar" })).status).toBe(400);
    const ok = await api(`gestao/contratantes/${c.id}/desbloquear`, "POST", { confirmo: true, motivo: "pediu para voltar em 10/11" });
    expect(ok.comunicacao).toBe("livre");
    const { results } = await env.DB.prepare("SELECT acao FROM auditoria WHERE entidade = 'contratante' AND entidade_id = ?").bind(c.id).all();
    expect(results.map((r) => r.acao)).toEqual(expect.arrayContaining(["bloqueou", "desbloqueou"]));
  });
});

describe("mensagens", () => {
  it("monta o link wa.me e registra a abertura sem duplicar no toque repetido", async () => {
    await limiteFolga();
    const c = await novo({ contato: "Zé Carlos" });
    const k = chave();
    const corpo = { chave: k, contratante_id: c.id, texto: "Olá, {{primeiro_nome|pessoal}}! Aqui é da 7A." };
    const a = await api("gestao/mensagens", "POST", corpo);
    expect(a.status).toBe(200);
    expect(a.link).toBe(`https://wa.me/${c.telefone_norm}?text=${encodeURIComponent("Olá, Zé! Aqui é da 7A.")}`);
    expect(a.mensagem.situacao).toBe("aberta");
    expect(a.mensagem.tipo).toBe("abordagem");
    const b = await api("gestao/mensagens", "POST", corpo);
    expect(b.repetida).toBe(true);
    expect(b.mensagem.id).toBe(a.mensagem.id);
    const { results } = await env.DB.prepare("SELECT id FROM mensagens WHERE contratante_id = ?").bind(c.id).all();
    expect(results.length).toBe(1);
    // abrir não é enviar: o contratante só muda quando o operador confirma
    expect((await api("gestao/contratantes/" + c.id)).contratante.etapa).toBe("contatar");
    const conf = await api(`gestao/mensagens/${a.mensagem.id}/confirmar`, "POST", { enviou: true });
    expect(conf.mensagem.situacao).toBe("enviada");
    const f = await api("gestao/contratantes/" + c.id);
    expect(f.contratante.etapa).toBe("contatado");
    expect(f.contratante.proxima_data).toBe(somarDias(hojeSP(), 3));
    expect((await api(`gestao/mensagens/${a.mensagem.id}/confirmar`, "POST", { enviou: true })).status).toBe(200);
  });
  it("respeita o intervalo de 3 dias; reabrir a mesma mensagem não cria registro", async () => {
    await limiteFolga();
    const c = await novo();
    const a = await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: c.id, texto: "Oi!" });
    const b = await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: c.id, texto: "Oi de novo!" });
    expect(b.status).toBe(409);
    expect(b.codigo).toBe("intervalo");
    const r = await api(`gestao/mensagens/${a.mensagem.id}/reabrir`, "POST", {});
    expect(r.link).toMatch(/^https:\/\/wa\.me\//);
    const { results } = await env.DB.prepare("SELECT id FROM mensagens WHERE contratante_id = ?").bind(c.id).all();
    expect(results.length).toBe(1);
    // fora de campanha, o operador pode insistir com confirmação explícita
    expect((await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: c.id, texto: "Insistindo", forcar: true })).status).toBe(200);
  });
  it("respeita o limite diário de novas abordagens", async () => {
    await limiteFolga(2);
    const r = [];
    for (let i = 0; i < 3; i++) {
      const c = await novo();
      r.push(await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: c.id, texto: "Primeiro contato" }));
    }
    expect(r[0].status).toBe(200);
    expect(r[1].status).toBe(200);
    expect(r[2].status).toBe(409);
    expect(r[2].codigo).toBe("limite");
    await limiteFolga();
  });
  it("recusa texto vazio, variável sem preencher e contratante sem telefone", async () => {
    await limiteFolga();
    const c = await novo({ contato: "" });
    expect((await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: c.id, texto: "  " })).status).toBe(400);
    const v = await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: c.id, texto: "Olá, {{primeiro_nome}}!" });
    expect(v.status).toBe(400);
    expect(v.erro).toMatch(/nome do contato/);
    const s = await novo({ telefone: "" });
    const t = await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: s.id, texto: "Oi" });
    expect(t.status).toBe(409);
    expect(t.codigo).toBe("telefone");
  });
  it("não enviei: a mensagem não conta e o contratante não muda", async () => {
    await limiteFolga();
    const c = await novo();
    const a = await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: c.id, texto: "Oi" });
    await api(`gestao/mensagens/${a.mensagem.id}/confirmar`, "POST", { enviou: false });
    expect((await api("gestao/contratantes/" + c.id)).contratante.etapa).toBe("contatar");
    expect((await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: c.id, texto: "Oi" })).status).toBe(200);
  });
  it("modo simulação registra como teste e não mexe no contratante", async () => {
    await limiteFolga(50, { simulacao: true });
    const c = await novo();
    const a = await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: c.id, texto: "Teste" });
    expect(a.simulada).toBe(true);
    await api(`gestao/mensagens/${a.mensagem.id}/confirmar`, "POST", { enviou: true });
    expect((await api("gestao/contratantes/" + c.id)).contratante.etapa).toBe("contatar");
    await limiteFolga(50, { simulacao: false });
  });
});

describe("respostas", () => {
  it("respondeu: negociando, próxima ação e fora das cobranças", async () => {
    const c = await novo();
    const r = await api(`gestao/contratantes/${c.id}/respondeu`, "POST", {});
    expect(r.etapa).toBe("negociando");
    expect(r.proxima_acao).toBe("Responder e mandar a proposta");
    expect(r.proxima_data).toBe(hojeSP());
    // toque repetido não duplica o evento
    await api(`gestao/contratantes/${c.id}/respondeu`, "POST", {});
    const { results } = await env.DB.prepare("SELECT id FROM eventos WHERE contratante_id = ? AND tipo = 'respondeu'").bind(c.id).all();
    expect(results.length).toBe(1);
  });
});

describe("modelos", () => {
  it("recusa variável desconhecida ou chave sem fechar ao salvar", async () => {
    expect((await api("gestao/modelos", "POST", { nome: "X", texto: "Oi {{nome}}" })).status).toBe(400);
    expect((await api("gestao/modelos", "POST", { nome: "X", texto: "Oi {{casa" })).status).toBe(400);
    const ok = await api("gestao/modelos", "POST", { nome: "Ok", etapa: "primeiro", texto: "Oi {{primeiro_nome|pessoal}}" });
    expect(ok.status).toBe(200);
  });
  it("vem com os modelos iniciais", async () => {
    const lista = await api("gestao/modelos");
    expect(lista.map((m) => m.nome)).toEqual(expect.arrayContaining(["Primeiro contato", "Cobrança gentil"]));
  });
});

describe("importação por CSV", () => {
  it("mostra a prévia com as linhas recusadas e o motivo, e importa sem marcar contato nem consentimento", async () => {
    const existente = await novo();
    const t1 = tel(), t2 = tel();
    const csv = [
      "Nome;Responsável;WhatsApp;E-mail;Cidade;UF;Categoria;Estilo;Etapa",
      `Bar Importado 1;Rita;${t1};rita${Date.now()}@x.com;Contagem;MG;Bar;Autoral;fechado`,
      `;Sem nome;${tel()};;;;;;`,
      `Bar Telefone Ruim;;12345;;;;;;`,
      `Bar Repetido;;${t1};;;;;;`,
      `Bar Já Cadastrado;;${existente.telefone};;;;;;`,
      `Bar Sem Telefone;;;;Betim;MG;Restaurante;Clássicos do rock;`,
      `Bar Importado 2;Leo;${t2};;Betim;MG;Festival;;`,
    ].join("\r\n");
    const p = await api("gestao/contratantes/importar", "POST", { csv });
    expect(p.total).toBe(7);
    expect(p.entram).toBe(3);
    expect(p.recusadas.map((r) => [r.linha, r.motivo])).toEqual([
      [3, "Sem nome"],
      [4, "Telefone inválido"],
      [5, "Telefone repetido no arquivo (linha 2)"],
      [6, `Telefone já cadastrado (${existente.nome})`],
    ]);
    expect((await api(`gestao/contratantes?busca=Bar Importado`)).total).toBe(0); // prévia não grava
    const f = await api("gestao/contratantes/importar", "POST", { csv, confirmar: true });
    expect(f.inseridos).toBe(3);
    const l = await api(`gestao/contratantes?busca=Bar Importado`);
    expect(l.total).toBe(2);
    for (const c of l.itens) {
      expect(c.origem).toBe("csv");
      expect(c.etapa).toBe("contatar");
      expect(c.comunicacao).toBe("livre");
      const cons = await env.DB.prepare("SELECT COUNT(*) n FROM consentimentos WHERE contratante_id = ?").bind(c.id).first();
      expect(cons.n).toBe(0);
    }
    expect(l.itens.find((c) => c.nome === "Bar Importado 1").perfil).toBe("autoral");
    // de novo: tudo recusado por já existir, nada duplicado
    const de_novo = await api("gestao/contratantes/importar", "POST", { csv, confirmar: true });
    expect(de_novo.inseridos).toBe(0);
  });
  it("recusa arquivo sem coluna de nome ou com mais de 1.000 linhas", async () => {
    expect((await api("gestao/contratantes/importar", "POST", { csv: "Telefone\n31999990000" })).status).toBe(400);
    const grande = "Nome\n" + Array.from({ length: 1001 }, (_, i) => "Casa " + i).join("\n");
    const r = await api("gestao/contratantes/importar", "POST", { csv: grande });
    expect(r.status).toBe(400);
    expect(r.erro).toMatch(/1000/);
  });
});

describe("campanhas", () => {
  // público isolado por cidade, para o teste não pegar casas de outros testes
  async function cenario() {
    const cidade = "Cidade " + Math.random().toString(36).slice(2, 8);
    const ok1 = await novo({ cidade, contato: "Ana" });
    const ok2 = await novo({ cidade, contato: "Bia" });
    const bloq = await novo({ cidade });
    await api(`gestao/contratantes/${bloq.id}/parar`, "POST", {});
    const semTel = await novo({ cidade, telefone: "" });
    const recente = await novo({ cidade });
    await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: recente.id, texto: "Oi" });
    return { cidade, ok1, ok2, bloq, semTel, recente };
  }
  const criar = (cidade, extra = {}) => api("gestao/campanhas", "POST", { nome: "Campanha " + cidade, objetivo: "Apresentar o casting", publico: { lista: "contatar", cidade }, cobranca_dias: 3, ...extra });

  it("prévia mostra destinatários, excluídos com motivo, prévia de cada texto e estimativa", async () => {
    await limiteFolga();
    const s = await cenario();
    const ca = await criar(s.cidade);
    const p = await api(`gestao/campanhas/${ca.id}/previa`);
    expect(p.incluidos.map((x) => x.contratante_id).sort()).toEqual([s.ok1.id, s.ok2.id].sort());
    expect(p.incluidos.find((x) => x.contratante_id === s.ok1.id).texto).toMatch(/^Olá, Ana!/);
    const motivos = Object.fromEntries(p.excluidos.map((x) => [x.contratante_id, x.motivo]));
    expect(motivos[s.bloq.id]).toMatch(/Pediu para parar/);
    expect(motivos[s.semTel.id]).toBe("Sem telefone");
    expect(motivos[s.recente.id]).toMatch(/últimos 3 dias/);
    expect(p.estimativa.mensagens).toBe(2);
    expect(p.assinatura).toMatch(/^[a-f0-9]{32}$/);
  });
  it("exclui quem já está em outra campanha e quem não tem o dado que o modelo exige", async () => {
    await limiteFolga();
    const s = await cenario();
    const a = await criar(s.cidade);
    const pa = await api(`gestao/campanhas/${a.id}/previa`);
    await api(`gestao/campanhas/${a.id}/confirmar`, "POST", { assinatura: pa.assinatura });
    const semContato = await novo({ cidade: s.cidade, contato: "" });
    const modelo = await api("gestao/modelos", "POST", { nome: "Exige nome", etapa: "primeiro", texto: "Oi {{primeiro_nome}}, tudo bem?" });
    const b = await criar(s.cidade, { modelo_id: modelo.id });
    const pb = await api(`gestao/campanhas/${b.id}/previa`);
    const motivos = Object.fromEntries(pb.excluidos.map((x) => [x.contratante_id, x.motivo]));
    expect(motivos[s.ok1.id]).toMatch(/Já está na campanha/);
    expect(motivos[semContato.id]).toMatch(/Falta dado no texto/);
  });
  it("confirmação exige a mesma lista da prévia e grava exatamente essa lista", async () => {
    await limiteFolga();
    const s = await cenario();
    const ca = await criar(s.cidade);
    const p = await api(`gestao/campanhas/${ca.id}/previa`);
    expect((await api(`gestao/campanhas/${ca.id}/confirmar`, "POST", { assinatura: "0".repeat(32) })).status).toBe(409);
    // a lista muda depois da prévia: uma casa nova entra no público
    await novo({ cidade: s.cidade, contato: "Caio" });
    const mudou = await api(`gestao/campanhas/${ca.id}/confirmar`, "POST", { assinatura: p.assinatura });
    expect(mudou.status).toBe(409);
    expect(mudou.codigo).toBe("mudou");
    const ok = await api(`gestao/campanhas/${ca.id}/confirmar`, "POST", { assinatura: mudou.previa.assinatura });
    expect(ok.campanha.status).toBe("andamento");
    const d = await api(`gestao/campanhas/${ca.id}`);
    expect(d.destinatarios.length).toBe(3);
    // confirmar de novo não duplica
    expect((await api(`gestao/campanhas/${ca.id}/confirmar`, "POST", { assinatura: mudou.previa.assinatura })).repetida).toBe(true);
    expect((await api(`gestao/campanhas/${ca.id}`)).destinatarios.length).toBe(3);
  });
  it("fila: abrir, confirmar, cobrança 3 dias depois e conclusão automática", async () => {
    await limiteFolga();
    const cidade = "Fila " + Math.random().toString(36).slice(2, 8);
    const c = await novo({ cidade, contato: "Duda" });
    const ca = await criar(cidade);
    const p = await api(`gestao/campanhas/${ca.id}/previa`);
    await api(`gestao/campanhas/${ca.id}/confirmar`, "POST", { assinatura: p.assinatura });
    const f = await api(`gestao/campanhas/${ca.id}/fila`);
    expect(f.atual.contratante.id).toBe(c.id);
    expect(f.atual.texto).toBe(p.incluidos[0].texto);
    const k = chave();
    const a = await api("gestao/mensagens", "POST", { chave: k, contratante_id: c.id, destinatario_id: f.atual.destinatario_id });
    expect(a.status).toBe(200);
    expect(a.mensagem.campanha_id).toBe(ca.id);
    // duplo toque na fila
    expect((await api("gestao/mensagens", "POST", { chave: k, contratante_id: c.id, destinatario_id: f.atual.destinatario_id })).repetida).toBe(true);
    // enquanto não confirma, a fila mostra a mesma casa
    expect((await api(`gestao/campanhas/${ca.id}/fila`)).mensagem.id).toBe(a.mensagem.id);
    await api(`gestao/mensagens/${a.mensagem.id}/confirmar`, "POST", { enviou: true });
    let d = await api(`gestao/campanhas/${ca.id}`);
    expect(d.destinatarios[0].situacao).toBe("aguardando");
    expect(d.destinatarios[0].cobrar_em).toBe(somarDias(hojeSP(), 3));
    expect(d.campanha.status).toBe("andamento");
    expect((await api(`gestao/campanhas/${ca.id}/fila`)).vazia).toBe(true);

    // passam 3 dias sem resposta
    const tres = new Date(Date.now() - 3 * 86400e3).toISOString();
    await env.DB.prepare("UPDATE mensagens SET criado = ? WHERE id = ?").bind(tres, a.mensagem.id).run();
    await env.DB.prepare("UPDATE campanha_destinatarios SET cobrar_em = ? WHERE campanha_id = ?").bind(hojeSP(), ca.id).run();
    const cob = await api(`gestao/campanhas/${ca.id}/fila`);
    expect(cob.atual.etapa).toBe("cobranca");
    expect(cob.atual.texto).toMatch(/^Oi, Duda! Passando para saber/);
    const m2 = await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: c.id, destinatario_id: cob.atual.destinatario_id });
    expect(m2.mensagem.tipo).toBe("cobranca");
    await api(`gestao/mensagens/${m2.mensagem.id}/confirmar`, "POST", { enviou: true });
    d = await api(`gestao/campanhas/${ca.id}`);
    expect(d.destinatarios[0].situacao).toBe("cobrada");
    expect(d.campanha.status).toBe("concluida");
    expect(d.indicadores.enviadas).toBe(2);
  });
  it("respondeu tira a casa da cobrança; pediu para parar tira da fila na hora", async () => {
    await limiteFolga();
    const cidade = "Resp " + Math.random().toString(36).slice(2, 8);
    const a = await novo({ cidade, contato: "Eva" });
    const b = await novo({ cidade, contato: "Fabi" });
    const ca = await criar(cidade);
    const p = await api(`gestao/campanhas/${ca.id}/previa`);
    await api(`gestao/campanhas/${ca.id}/confirmar`, "POST", { assinatura: p.assinatura });
    const f = await api(`gestao/campanhas/${ca.id}/fila`);
    const primeiro = f.atual.contratante.id;
    const outro = primeiro === a.id ? b.id : a.id;
    const m = await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: primeiro, destinatario_id: f.atual.destinatario_id });
    await api(`gestao/mensagens/${m.mensagem.id}/confirmar`, "POST", { enviou: true });
    await api(`gestao/contratantes/${primeiro}/respondeu`, "POST", {});
    // o outro pede para parar antes de chegar a vez dele
    await api(`gestao/contratantes/${outro}/parar`, "POST", {});
    const d = await api(`gestao/campanhas/${ca.id}`);
    const sit = Object.fromEntries(d.destinatarios.map((x) => [x.contratante_id, x.situacao]));
    expect(sit[primeiro]).toBe("respondeu");
    expect(sit[outro]).toBe("bloqueado");
    expect(d.campanha.status).toBe("concluida");
    expect(d.indicadores.respostas).toBe(1);
    expect(d.indicadores.bloqueios).toBe(1);
  });
  it("pausar para a fila e recusa abertura; cancelar encerra os pendentes", async () => {
    await limiteFolga();
    const cidade = "Pausa " + Math.random().toString(36).slice(2, 8);
    await novo({ cidade });
    await novo({ cidade });
    const ca = await criar(cidade);
    const p = await api(`gestao/campanhas/${ca.id}/previa`);
    await api(`gestao/campanhas/${ca.id}/confirmar`, "POST", { assinatura: p.assinatura });
    const f = await api(`gestao/campanhas/${ca.id}/fila`);
    expect((await api(`gestao/campanhas/${ca.id}/pausar`, "POST")).status).toBe("pausada");
    expect((await api(`gestao/campanhas/${ca.id}/fila`)).atual).toBeUndefined();
    const m = await api("gestao/mensagens", "POST", { chave: chave(), contratante_id: f.atual.contratante.id, destinatario_id: f.atual.destinatario_id });
    expect(m.status).toBe(409);
    expect((await api(`gestao/campanhas/${ca.id}/retomar`, "POST")).status).toBe("andamento");
    expect((await api(`gestao/campanhas/${ca.id}/cancelar`, "POST")).status).toBe("cancelada");
    const d = await api(`gestao/campanhas/${ca.id}`);
    expect(d.destinatarios.every((x) => x.situacao === "cancelado")).toBe(true);
    expect((await api(`gestao/campanhas/${ca.id}/retomar`, "POST")).status).toBe(409);
    const hist = d.historico.map((h) => h.acao);
    expect(hist).toEqual(expect.arrayContaining(["criou", "iniciou", "pausou", "retomou", "cancelou"]));
  });
  it("só edita rascunho e não abre antes do horário de início", async () => {
    await limiteFolga();
    const cidade = "Agenda " + Math.random().toString(36).slice(2, 8);
    await novo({ cidade });
    const ca = await criar(cidade, { inicio: somarDias(hojeSP(), 2) + "T09:00" });
    const p = await api(`gestao/campanhas/${ca.id}/previa`);
    expect(p.alertas.join(" ")).toMatch(/só abre em/);
    await api(`gestao/campanhas/${ca.id}/confirmar`, "POST", { assinatura: p.assinatura });
    expect((await api(`gestao/campanhas/${ca.id}/fila`)).espera).toBe(ca.inicio);
    expect((await api(`gestao/campanhas/${ca.id}`, "PUT", { nome: "Outro" })).status).toBe(409);
  });
});
