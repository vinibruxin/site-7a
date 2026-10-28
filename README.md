# Site da 7A Produtora

Publicado no Cloudflare (Worker `site-7a` com arquivos estáticos). Cada push na branch `main` publica de novo.

- `public/`: o site (index.html, páginas dos artistas, img/, midia/) e o painel `public/admin/`.
- `public/admin/gestao.html` + `src/gestao.js`: sistema de gestão da 7A (contratantes, WhatsApp, campanhas, histórico, shows com cachê, % da 7A e repasse, planilhas). Dados no D1 `site-7a-gestao` (binding `DB`). Shows confirmados com "mostrar na agenda" entram sozinhos na agenda do site, e cada pedido do formulário do site vira um contratante. Cada show pode gerar uma proposta com a marca, aberta pelo contratante em `/proposta/<token>` (`public/proposta.html`).
- `src/worker.js`: serve o site, encaixa nas páginas a agenda, os textos e a formação editados no `/admin`, e a API do painel.
- `public/dados/padrao.json`: conteúdo inicial do painel (gerado por `ferramentas/gera_artistas.py`).
- `ferramentas/`: gerador das páginas de artista (`gera_artistas.py` + `artista.css` + `comum.css`) e especificação da carta do casting.

O conteúdo editado no `/admin` fica no KV `CONTEUDO` (chave `conteudo`) e tem prioridade sobre o texto fixo das páginas.
A senha inicial do painel é verificada pelo hash em `wrangler.jsonc`; trocada no painel, passa a valer a do KV.

Gestão como app: `public/admin/manifest.json` + `sw.js` (instalável pelo navegador do celular, sem cache offline).
Envio da proposta por e-mail: Resend, remetente `propostas@7aprodutora.com.br`, respostas para o Gmail da 7A. Precisa do secret `RESEND_API_KEY` no Worker (Cloudflare > Workers > site-7a > Settings > Variables and Secrets); sem ele o botão avisa que o envio não está ligado.

## Relacionamento pelo WhatsApp (versão gratuita)

Custo zero: não usa a API paga da Meta, nem intermediários (Twilio, Z-API...), nem robôs de WhatsApp Web. O sistema monta cada mensagem e abre o WhatsApp do operador pelo link oficial `https://wa.me/<número>?text=<mensagem>`; quem confere e toca em enviar é sempre uma pessoa.

**O que esta versão não faz** (e o painel diz isso nas telas):
- envio automático, sem toque humano;
- disparo em lote de uma vez (cada mensagem é um toque);
- status de entregue ou lida;
- recebimento automático das respostas: elas chegam só no celular, e o operador marca "Respondeu" ou "Pediu para parar".

**Como funciona**
- **Contratantes**: telefone guardado também no formato do WhatsApp (`telefone_norm`, 55 + DDD + número). Mesmo telefone (em qualquer formato) ou mesmo e-mail não entra duas vezes: o sistema mostra o cadastro que já existe. Busca e paginação no servidor. "Apagar" arquiva: some das listas e campanhas, o histórico fica.
- **Importação por planilha (CSV)**: prévia antes de gravar, com cada linha recusada e o motivo (sem nome, telefone inválido, repetido no arquivo, já cadastrado). Até 1.000 linhas. Quem é importado entra como "a contatar", sem contar como contato feito e sem autorização registrada.
- **Modelos**: variáveis `{{primeiro_nome}}`, `{{nome_contato}}`, `{{casa}}`, `{{cidade}}`, `{{site}}`, com reserva `{{primeiro_nome|pessoal}}`. Variável desconhecida ou chave sem fechar é recusada ao salvar; o texto é conferido de novo no servidor antes de abrir o WhatsApp.
- **Mensagem avulsa** (ficha do contratante): escolhe o modelo, ajusta o texto e toca em "Abrir no WhatsApp". O toque fica registrado (data, hora, texto, modelo) sem duplicar em toque repetido. A mensagem só conta como enviada quando o operador marca "Enviei".
- **Regras**: casa que pediu para parar fica bloqueada na hora, sai de todas as campanhas, e o servidor recusa qualquer abertura para ela; só um desbloqueio confirmado, com motivo, desfaz (fica na auditoria). Mínimo de 3 dias entre mensagens para a mesma casa e limite diário de novas abordagens (padrão 20), ambos em Ajustes.
- **Respondeu**: passa para "negociando", sai das cobranças e das campanhas pendentes e ganha a próxima ação "Responder e mandar a proposta" para hoje.
- **Campanhas**: público (a contatar, cobrar hoje, todas em aberto; perfil musical; cidade; tipo), modelo escolhido ou automático pela etapa e pelo perfil, início, cobrança automática N dias depois sem resposta. Antes de iniciar, a prévia mostra os destinatários com o texto de cada um, os excluídos com o motivo, os toques necessários e os alertas; a confirmação grava exatamente a lista vista (se algo mudou, pede para revisar). A fila mostra uma casa por vez. Pausar, retomar e cancelar; a campanha sem ninguém pendente termina sozinha. Indicadores por campanha e gerais (enviadas, respostas, bloqueios, funil).
- **Modo simulação** (Ajustes): registra tudo como teste, não abre o WhatsApp, não muda os contratantes e fica fora dos números.
- **Autorização de contato**: tabela `consentimentos` com situação, origem e prova ("Pedido pelo site em 28/10", "Respondeu no WhatsApp em 30/10", "Pediu para parar").

O código que monta o link fica isolado em `src/whatsapp.js`. As regras comerciais estão em `src/mensagens.js` e `src/campanhas.js`, e não dependem do link.

## Banco de dados e migrações

As tabelas ficam em `src/esquema.js` como migrações versionadas (`MIGRACOES`). O deploy automático da Cloudflare não roda comandos de migração, então o próprio worker aplica, na primeira chamada de cada instância, as versões que ainda não estão na tabela `esquema_versao` (`src/banco.js`).

- v1: o banco como estava antes (contratantes, notas, shows, propostas, config, pedidos_ip).
- v2: colunas novas em contratantes (`telefone_norm`, `perfil`, `comunicacao`, `bloqueado_em`, `arquivado`), índices (telefone único, e-mail, próxima ação) e as tabelas `consentimentos`, `modelos`, `campanhas`, `campanha_destinatarios`, `mensagens`, `eventos` e `auditoria`. Os telefones antigos são normalizados; um repetido ou fora do formato fica sem `telefone_norm` e ganha uma nota na ficha.

Regras para migração nova: entra no fim da lista, com o número seguinte; cada passo pode rodar de novo sem estragar nada; nenhuma migração apaga tabela, coluna ou linha. Antes de publicar uma mudança de tabela, baixe as planilhas em Ajustes e exporte o D1:

```bash
npx wrangler d1 export site-7a-gestao --remote --output=backup-gestao.sql
```

## Rodar no computador e testar

```bash
npm install
```

Copie `.dev.vars.example` para `.dev.vars` e preencha a senha local. Depois `npm run dev` abre o site em `http://localhost:8787` com banco e KV locais (vazios, separados da produção).

```bash
npm test
```

Os testes (`test/`) rodam dentro do runtime do Workers com D1 e KV locais: telefone, modelos, link do WhatsApp, CSV, cadastro e duplicidade, bloqueio e recusa no servidor, registro sem duplicar, intervalo e limite diário, campanhas (prévia, confirmação, fila, cobrança, pausa, cancelamento, conclusão), rotas sem login e migração de um banco antigo. Ficam só como dependência de desenvolvimento.

## Segurança

- Todas as rotas `/api/gestao/*` exigem a sessão do `/admin` (cookie `HttpOnly`, `Secure`, `SameSite=Strict`), e pedidos que mudam dados vindos de outro site são recusados.
- Login com limite de 10 tentativas a cada 15 minutos por IP.
- Validação de tudo no servidor; mensagens de erro sem detalhes internos.
- Segredos só como secrets do Worker (`RESEND_API_KEY`; na versão paga, o token da Meta). Nunca no repositório nem no navegador.
- Auditoria (`auditoria`) de bloqueio, desbloqueio, arquivamento, importação, campanhas e modo simulação.

## Versão paga (só se a 7A decidir pagar)

Trocar `src/whatsapp.js` pela API oficial da Meta (WhatsApp Business Platform), mantendo as mesmas regras. Exige verificação do negócio, aprovação do nome "7A Produtora" e dos modelos, opt-in de quem recebe, cartão na conta da Meta e cobrança por mensagem iniciada pela empresa (confira os valores atuais na tabela da Meta). Entram: webhooks com assinatura `X-Hub-Signature-256`, status de enviada, entregue, lida e falhou (tabela `eventos`, coluna `externo_id`), e recebimento automático das respostas.
