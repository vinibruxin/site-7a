# Site da 7A Produtora

Publicado no Cloudflare (Worker `site-7a` com arquivos estáticos). Cada push na branch `main` publica de novo.

- `public/`: o site (index.html, páginas dos artistas, img/, midia/) e o painel `public/admin/`.
- `src/worker.js`: serve o site, encaixa nas páginas a agenda, os textos e a formação editados no `/admin`, e a API do painel.
- `public/dados/padrao.json`: conteúdo inicial do painel (gerado por `ferramentas/gera_artistas.py`).
- `ferramentas/`: gerador das páginas de artista (`gera_artistas.py` + `artista.css` + `comum.css`) e especificação da carta do casting.

O conteúdo editado no `/admin` fica no KV `CONTEUDO` (chave `conteudo`) e tem prioridade sobre o texto fixo das páginas.
A senha inicial do painel é verificada pelo hash em `wrangler.jsonc`; trocada no painel, passa a valer a do KV.
