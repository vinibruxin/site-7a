# Site da 7A Produtora

Publicado no Cloudflare (Worker `site-7a` com arquivos estáticos). Cada push na branch `main` publica de novo.

- `public/`: o site (index.html, páginas dos artistas, img/, midia/) e o painel `public/admin/`.
- `public/admin/gestao.html` + `src/gestao.js`: sistema de gestão da 7A (contratantes, histórico, shows com cachê, % da 7A e repasse, planilhas). Dados no D1 `site-7a-gestao` (binding `DB`); as tabelas (`src/esquema.js`) são criadas pelo próprio worker. Shows confirmados com "mostrar na agenda" entram sozinhos na agenda do site, e cada pedido do formulário do site vira um contratante. Cada show pode gerar uma proposta com a marca, aberta pelo contratante em `/proposta/<token>` (`public/proposta.html`).
- `src/worker.js`: serve o site, encaixa nas páginas a agenda, os textos e a formação editados no `/admin`, e a API do painel.
- `public/dados/padrao.json`: conteúdo inicial do painel (gerado por `ferramentas/gera_artistas.py`).
- `ferramentas/`: gerador das páginas de artista (`gera_artistas.py` + `artista.css` + `comum.css`) e especificação da carta do casting.

O conteúdo editado no `/admin` fica no KV `CONTEUDO` (chave `conteudo`) e tem prioridade sobre o texto fixo das páginas.
A senha inicial do painel é verificada pelo hash em `wrangler.jsonc`; trocada no painel, passa a valer a do KV.

Gestão como app: `public/admin/manifest.json` + `sw.js` (instalável pelo navegador do celular, sem cache offline).
Envio da proposta por e-mail: Resend, remetente `propostas@7aprodutora.com.br`, respostas para o Gmail da 7A. Precisa do secret `RESEND_API_KEY` no Worker (Cloudflare > Workers > site-7a > Settings > Variables and Secrets); sem ele o botão avisa que o envio não está ligado.
