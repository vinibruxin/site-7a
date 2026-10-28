// Utilidades dos testes: login com a senha de teste e chamadas à API como o painel faz.
import { SELF, env } from "cloudflare:test";

export const BASE = "https://7a.test";

export async function entrar() {
  const r = await SELF.fetch(BASE + "/api/entrar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ senha: env.SENHA_TESTE }) });
  if (r.status !== 200) throw new Error("login de teste falhou: " + r.status);
  return r.headers.get("set-cookie").split(";")[0];
}

export function cliente(cookie) {
  return async (rota, metodo = "GET", corpo) => {
    const r = await SELF.fetch(BASE + "/api/" + rota, {
      method: metodo,
      headers: { ...(cookie ? { cookie } : {}), ...(corpo ? { "content-type": "application/json" } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? Object.assign(j, { status: r.status }) : { status: r.status, ...j };
  };
}

// telefones únicos por teste: (31) 9xxxx-xxxx
let n = Math.floor(Math.random() * 1e6);
export const tel = () => `(31) 9${String(++n % 1e8).padStart(8, "0").replace(/^(\d{4})/, "$1-")}`;
export const chave = () => crypto.randomUUID();
