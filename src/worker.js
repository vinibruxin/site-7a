// Site da 7A Produtora: serve os arquivos de public/ e encaixa nas páginas o conteúdo editado no /admin.
// O conteúdo editável (agenda, textos e formação dos artistas) fica no KV CONTEUDO, chave "conteudo".
// Sem nada salvo no KV, o site mostra o que está em public/ (gerado por ferramentas/gera_artistas.py).

const CHAVE = "conteudo";
const SESSAO_DIAS = 7;
const MAX_TENTATIVAS = 10;

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p.startsWith("/api/")) {
      try {
        return await api(req, env, url);
      } catch (e) {
        return json({ erro: "Algo deu errado no servidor. Tente de novo." }, 500);
      }
    }

    const resp = await env.ASSETS.fetch(req);
    const tipo = resp.headers.get("content-type") || "";
    if (!tipo.includes("text/html") || p.startsWith("/admin")) return resp;

    const conteudo = await lerConteudo(env);
    if (!conteudo) return resp;
    const slug = p === "/" || p === "/index.html" || p === "/index" ? "" : p.replace(/^\//, "").replace(/\.html$/, "");
    const r = slug ? reescreverArtista(resp, conteudo, slug) : reescreverInicio(resp, conteudo);
    const h = new Headers(r.headers);
    h.set("cache-control", "no-cache");
    return new Response(r.body, { status: r.status, headers: h });
  },
};

/* ---------------- conteúdo ---------------- */

async function lerConteudo(env) {
  const salvo = await env.CONTEUDO.get(CHAVE, "json");
  return salvo || null;
}

async function conteudoPadrao(env, req) {
  const r = await env.ASSETS.fetch(new Request(new URL("/dados/padrao.json", req.url)));
  return r.ok ? r.json() : { agenda: [], artistas: {} };
}

function hojeSP() {
  // data de hoje no fuso de Betim (America/Sao_Paulo), no formato AAAA-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function proximas(agenda, slug) {
  const hoje = hojeSP();
  return (agenda || [])
    .filter((d) => d && d.data && d.data >= hoje && (!slug || d.artista === slug))
    .sort((a, b) => (a.data + (a.hora || "")).localeCompare(b.data + (b.hora || "")));
}

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function linkSeguro(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:" || x.protocol === "http:" ? x.href : "";
  } catch {
    return "";
  }
}

function itemAgenda(d, conteudo, mostrarArtista) {
  const [a, m, dia] = d.data.split("-").map(Number);
  const semana = DIAS[new Date(Date.UTC(a, m - 1, dia)).getUTCDay()];
  const art = conteudo.artistas?.[d.artista];
  const nome = art ? art.nome : d.artista_texto || "";
  const ingresso = linkSeguro(d.link);
  const quem = mostrarArtista && nome
    ? art
      ? `<a class="quem" href="${esc(d.artista)}.html">${esc(nome)}</a>`
      : `<span class="quem">${esc(nome)}</span>`
    : "";
  const onde = [d.local, d.cidade].filter(Boolean).map(esc).join(", ");
  return `<li class="data-show">
        <p class="quando"><span class="dia">${String(dia).padStart(2, "0")}</span><span class="mes">${MESES[m - 1]}</span></p>
        <div class="o-que">${quem}<span class="onde">${onde}</span><span class="hora">${esc(semana)}${d.hora ? ", " + esc(d.hora) : ""}</span></div>
        ${ingresso ? `<a class="ingresso" href="${esc(ingresso)}" target="_blank" rel="noopener">Ingressos</a>` : ""}
      </li>`;
}

function reescreverInicio(resp, conteudo) {
  const lista = proximas(conteudo.agenda);
  const html = lista.map((d) => itemAgenda(d, conteudo, true)).join("\n");
  let rw = new HTMLRewriter();
  if (lista.length) {
    rw = rw
      .on('[data-campo="agenda"]', { element: (el) => { el.setInnerContent(html, { html: true }); el.removeAttribute("hidden"); } })
      .on('[data-bloco="agenda-vazia"]', { element: (el) => el.setAttribute("hidden", "") });
  }
  return rw.transform(resp);
}

function reescreverArtista(resp, conteudo, slug) {
  const a = conteudo.artistas?.[slug];
  if (!a) return resp;
  const lista = proximas(conteudo.agenda, slug);
  const form = (a.formacao || []).filter((f) => f && f.nome);
  const resumo = (a.resumo || []).filter(Boolean);
  const dest = (a.destaques || []).filter(Boolean);
  const ideal = a.ideal ? a.ideal.charAt(0).toLowerCase() + a.ideal.slice(1) : "";

  const visivel = (on) => ({ element: (el) => (on ? el.removeAttribute("hidden") : el.setAttribute("hidden", "")) });
  const texto = (t) => ({ element: (el) => el.setInnerContent(t) });
  const html = (h) => ({ element: (el) => el.setInnerContent(h, { html: true }) });

  let rw = new HTMLRewriter();
  if (a.chamada) rw = rw.on('[data-campo="chamada"]', texto(a.chamada));
  if (resumo.length) rw = rw.on('[data-campo="resumo"]', html(resumo.map((p) => `<p>${esc(p)}</p>`).join("\n")));
  if (dest.length) rw = rw.on('[data-campo="destaques"]', html(dest.map((d) => `<li data-revela>${esc(d)}</li>`).join("\n")));
  if (ideal) rw = rw.on('[data-campo="ideal"]', texto(`Ideal para ${ideal.replace(/\.$/, "")}.`));
  rw = rw
    .on('[data-campo="formacao"]', html(form.map((f) => `<li data-revela><span class="quem">${esc(f.nome)}</span><span class="faz">${esc(f.funcao || "")}</span></li>`).join("\n")))
    .on('[data-bloco="formacao"]', visivel(form.length > 0))
    .on('[data-campo="agenda"]', html(lista.map((d) => itemAgenda(d, conteudo, false)).join("\n")))
    .on('[data-bloco="agenda"]', visivel(lista.length > 0));
  return rw.transform(resp);
}

/* ---------------- api ---------------- */

async function api(req, env, url) {
  const rota = url.pathname.replace(/^\/api\//, "");
  const metodo = req.method;

  if (rota === "conteudo" && metodo === "GET") {
    return json((await lerConteudo(env)) || (await conteudoPadrao(env, req)));
  }
  if (rota === "entrar" && metodo === "POST") return entrar(req, env);
  if (rota === "sair" && metodo === "POST") {
    const t = token(req);
    if (t) await env.CONTEUDO.delete("sessao:" + t);
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }

  if (!(await logado(req, env))) return json({ erro: "Entre com a senha para continuar." }, 401);

  if (rota === "sessao" && metodo === "GET") return json({ ok: true });
  if (rota === "conteudo" && metodo === "PUT") {
    const novo = await req.json();
    const limpo = validar(novo);
    if (limpo.erro) return json(limpo, 400);
    limpo.atualizado = new Date().toISOString();
    await env.CONTEUDO.put(CHAVE, JSON.stringify(limpo));
    return json({ ok: true, atualizado: limpo.atualizado });
  }
  if (rota === "senha" && metodo === "POST") {
    const { atual, nova } = await req.json();
    if (!(await senhaConfere(env, atual))) return json({ erro: "A senha atual não confere." }, 400);
    if (!nova || nova.length < 10) return json({ erro: "A senha nova precisa de pelo menos 10 caracteres." }, 400);
    const sal = hex(crypto.getRandomValues(new Uint8Array(16)));
    await env.CONTEUDO.put("senha", JSON.stringify({ sal, hash: await sha(sal + nova) }));
    return json({ ok: true });
  }
  return json({ erro: "Rota não encontrada." }, 404);
}

function validar(c) {
  if (!c || typeof c !== "object") return { erro: "Conteúdo inválido." };
  const txt = (s, n = 400) => String(s ?? "").trim().slice(0, n);
  const agenda = (Array.isArray(c.agenda) ? c.agenda : []).slice(0, 300).map((d) => ({
    data: /^\d{4}-\d{2}-\d{2}$/.test(d?.data || "") ? d.data : "",
    hora: /^\d{2}:\d{2}$/.test(d?.hora || "") ? d.hora : "",
    artista: txt(d?.artista, 60),
    artista_texto: txt(d?.artista_texto, 120),
    local: txt(d?.local, 160),
    cidade: txt(d?.cidade, 80),
    link: linkSeguro(txt(d?.link, 500)),
  }));
  if (agenda.some((d) => !d.data)) return { erro: "Toda data da agenda precisa de dia, mês e ano." };
  const artistas = {};
  for (const [slug, a] of Object.entries(c.artistas || {})) {
    if (!/^[a-z0-9-]{1,60}$/.test(slug)) continue;
    artistas[slug] = {
      nome: txt(a?.nome, 80),
      chamada: txt(a?.chamada, 400),
      resumo: (a?.resumo || []).map((p) => txt(p, 2000)).filter(Boolean).slice(0, 12),
      destaques: (a?.destaques || []).map((p) => txt(p, 160)).filter(Boolean).slice(0, 12),
      ideal: txt(a?.ideal, 200),
      formacao: (a?.formacao || []).map((f) => ({ nome: txt(f?.nome, 80), funcao: txt(f?.funcao, 80) })).filter((f) => f.nome).slice(0, 20),
    };
  }
  return { agenda, artistas };
}

/* ---------------- senha e sessão ---------------- */

async function sha(s) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

async function senhaConfere(env, senha) {
  if (!senha) return false;
  const trocada = await env.CONTEUDO.get("senha", "json");
  const sal = trocada ? trocada.sal : env.ADMIN_SAL;
  const alvo = trocada ? trocada.hash : env.ADMIN_HASH;
  const h = await sha(sal + senha);
  // comparação em tempo constante
  if (h.length !== alvo.length) return false;
  let d = 0;
  for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ alvo.charCodeAt(i);
  return d === 0;
}

async function entrar(req, env) {
  const ip = req.headers.get("cf-connecting-ip") || "local";
  const chave = "tentativas:" + ip;
  const n = Number((await env.CONTEUDO.get(chave)) || 0);
  if (n >= MAX_TENTATIVAS) return json({ erro: "Muitas tentativas. Espere 15 minutos e tente de novo." }, 429);
  const { senha } = await req.json().catch(() => ({}));
  if (!(await senhaConfere(env, senha))) {
    await env.CONTEUDO.put(chave, String(n + 1), { expirationTtl: 900 });
    return json({ erro: "Senha incorreta." }, 401);
  }
  const t = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.CONTEUDO.put("sessao:" + t, "1", { expirationTtl: SESSAO_DIAS * 86400 });
  return json({ ok: true }, 200, { "set-cookie": cookie(t, SESSAO_DIAS * 86400) });
}

function token(req) {
  const m = (req.headers.get("cookie") || "").match(/(?:^|;\s*)sessao7a=([a-f0-9]{64})/);
  return m ? m[1] : "";
}

async function logado(req, env) {
  const t = token(req);
  return t ? (await env.CONTEUDO.get("sessao:" + t)) === "1" : false;
}

function cookie(v, idade) {
  return `sessao7a=${v}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${idade}`;
}

function json(dados, status = 200, extra = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });
}
