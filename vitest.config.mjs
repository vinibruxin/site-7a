// Testes dentro do runtime do Workers (Miniflare), com D1 e KV locais e vazios.
// Nada aqui fala com a Cloudflare de verdade: remoteBindings desligado.
import { createHash } from "node:crypto";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

// senha só dos testes (a de produção continua só como hash no wrangler.jsonc)
const SAL = "sal-dos-testes";
const SENHA = "senha-dos-testes-7a";

export default defineConfig({
  plugins: [
    cloudflareTest({
      remoteBindings: false,
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          ADMIN_SAL: SAL,
          ADMIN_HASH: createHash("sha256").update(SAL + SENHA).digest("hex"),
          SENHA_TESTE: SENHA,
        },
      },
    }),
  ],
  // um arquivo de cada vez: com vários runtimes subindo juntos, o Windows passa do tempo de partida
  test: { fileParallelism: false },
});
