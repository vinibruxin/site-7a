# Site da 7A Produtora

Publicado no Cloudflare (Worker `site-7a` com arquivos estáticos). Cada push na branch `main` publica de novo.

- `public/`: o site (index.html, páginas dos artistas, `evento-particular.html`, img/, midia/) e o painel `public/admin/` (`index.html` é a Gestão, aberta em `/admin`; `site.html` é o "Editar o site", em `/admin/site`). A página de evento particular manda o pedido para o WhatsApp ou o e-mail e registra na Gestão como contratante do tipo "particular" (`POST /api/pedido`).
- `public/admin/index.html` (em `/admin`; o endereço antigo `/admin/gestao` redireciona) + `src/gestao.js`: sistema de gestão da 7A (contratantes, WhatsApp, campanhas, histórico, shows com cachê, % da 7A e repasse, planilhas). Dados no D1 `site-7a-gestao` (binding `DB`). Shows confirmados com "mostrar na agenda" entram sozinhos na agenda do site, e cada pedido do formulário do site vira um contratante. Cada show pode gerar uma proposta com a marca, aberta pelo contratante em `/proposta/<token>` (`public/proposta.html`).
- Menu da Gestão: **Hoje** (o que fazer: casas atrasadas e de hoje, shows da semana com o que falta, funil e dinheiro), **Funil** (casas em colunas por etapa, arrastar no computador ou "Mover para" no celular; lista com busca e importação ficam nas sub-abas), **Agenda** (lista, mês em calendário e Financeiro por mês e por artista, com o que falta receber e repassar; mostra também os shows que ainda estão só na agenda do "Editar o site", com o botão "Trazer para a Gestão"), **Mensagens** (fila do WhatsApp, campanhas e modelos) e **Ajustes**. Clicar numa casa abre a ficha; a conversa fica no botão "Conversa". Mudar de etapa pelo funil usa `POST /api/gestao/contratantes/:id/etapa` e grava uma nota no histórico (a Évora não tem acesso).
- `src/worker.js`: serve o site, encaixa nas páginas a agenda, os textos e a formação editados no `/admin`, e a API do painel.
- `public/dados/padrao.json`: conteúdo inicial do painel (gerado por `ferramentas/gera_artistas.py`).
- `ferramentas/`: gerador das páginas de artista (`gera_artistas.py` + `artista.css` + `comum.css`) e especificação da carta do casting.

O conteúdo editado no `/admin` fica no KV `CONTEUDO` (chave `conteudo`) e tem prioridade sobre o texto fixo das páginas.
A senha inicial do painel é verificada pelo hash em `wrangler.jsonc`; trocada no painel, passa a valer a do KV.

Gestão como app: `public/admin/manifest.json` + `sw.js` (instalável pelo navegador do celular, sem cache offline).
Envio da proposta por e-mail: Resend, remetente `propostas@7aprodutora.com.br`, respostas para o Gmail da 7A. Precisa do secret `RESEND_API_KEY` no Worker (Cloudflare > Workers > site-7a > Settings > Variables and Secrets); sem ele o botão avisa que o envio não está ligado.

## Cadastro de artistas

Menu **Artistas > Cadastro de artistas** (`src/musicos.js`, tabela `musicos`, migração v8). Agenda única de todo mundo que toca com a 7A, do casting ou de fora: nome artístico, WhatsApp, chave Pix (tipo e valor, conferidos: CPF/CNPJ pelos dígitos, celular, e-mail ou chave aleatória), cidade, estilo, formação (instrumentos) e observações, com a marca "Casting 7A".

- Busca por nome, instrumento ou cidade, sem ligar para acento ("violao" acha "Violão"); filtros por cidade, instrumento e casting. Botão de WhatsApp e "Copiar Pix" em cada artista.
- Mesmo WhatsApp não entra duas vezes. A auditoria registra quem foi cadastrado, editado ou excluído, sem gravar telefone nem Pix.
- **Sigilo**: WhatsApp e Pix ficam só no painel com senha. Não entram em `/api/gestao/dados`, no site público, em planilhas nem na API do agente Évora (barrado até para leitura). Só a equipe cadastra: não há auto-cadastro.
- Não mexe nos artistas do site (cartas e páginas do casting continuam no "Editar o site").

## Recibos e notas fiscais

Menu **Agenda > Recibos e notas** e a seção "Recibo e nota fiscal" na ficha de cada show (`src/documentos.js`, tabela `documentos`, migração v7).

- **Recibo**: emitido pelo sistema, número em sequência (`7A-R-0001`), valor por extenso, opção de somar no "Recebido" do show. O pagador abre em `/recibo/<token>` (`public/recibo.html`) e salva em PDF (uma folha A4). Recibo emitido não muda: se sair errado, cancela (o valor sai do "Recebido") e emite outro.
- **Nota fiscal (NFS-e)**: o sistema **não emite**. Guarda tomador, serviço, valor e ISS, avisa o que falta e monta o texto para colar no [Emissor Nacional](https://www.nfse.gov.br/EmissorNacional) (Betim usa o padrão nacional desde 01/01/2026). Depois da emissão no portal, registra o número da nota. Situações: faltam dados, pronta para emitir, emitida, cancelada.
- **Dados da 7A** (nome, CPF/CNPJ, inscrição municipal, endereço, quem assina): em Ajustes, começam vazios. Sem eles o recibo sai como rascunho, com os campos marcados, e se completa sozinho quando forem preenchidos. CPF e CNPJ (inclusive o alfanumérico) são conferidos pelos dígitos.
- O agente Évora não acessa recibos nem notas.

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

## Agente comercial Évora (API)

O agente conversa com o sistema pelo token `AGENTE_TOKEN` (secret do Worker, mínimo de 32 caracteres), enviado no cabeçalho `Authorization: Bearer <token>`. Não usa a senha do painel e não tem acesso a login, conteúdo do site, configurações nem senhas.

Gerar e gravar o token (no computador, fora do repositório):

```bash
npx wrangler secret put AGENTE_TOKEN
```

**O que o agente pode**
- Ler: `GET /api/agente/painel` (funil, vencidos, sem próxima ação, shows dos próximos 60 dias, limite do dia), `GET /api/gestao/dados`, `GET /api/gestao/contratantes[/id]`, notas, modelos, campanhas e o link da proposta de um show.
- Rascunhar: `POST /api/gestao/mensagens/previa` monta o texto e mostra avisos (intervalo, limite, bloqueio) sem registrar nada.
- Cadastrar contratante (`POST /api/gestao/contratantes`) e anotar (`POST /api/gestao/contratantes/:id/notas`).
- Atualizar a ação: `POST /api/agente/contratantes/:id/acao` com `proxima_acao`, `proxima_data` (AAAA-MM-DD), `etapa` (contatar, contatado, negociando ou perdido) e `nota` opcional. A nota entra no histórico com o prefixo "Évora:".
- Criar ou alterar consulta de show (`POST /api/gestao/shows`, `PUT /api/gestao/shows/:id`), sempre com status `consulta`. O cachê (em centavos) só entra acima do piso do artista (`PISOS` em `src/agente.js`). Recebido, repasse e despesas ficam de fora.
- Montar ou atualizar a proposta (`PUT /api/gestao/shows/:id/proposta`), que devolve o token e o link `/proposta/<token>`. A proposta do agente fica com `situacao = aguardando_aprovacao`: a casa não abre o link e o envio não funciona até a equipe aprovar, o que acontece ao salvar a proposta no painel.

**O que fica com a equipe** (o agente recebe 403 com o motivo)
- Enviar proposta por e-mail, registrar toque no WhatsApp, iniciar ou alterar campanhas.
- Marcar casa como fechada, confirmar, publicar, aprovar a proposta, ou lançar recebido, repasse e despesas de show.
- Apagar, arquivar, bloquear ou desbloquear, exportar planilhas, mudar configurações, senha ou conteúdo do site.

Quem envia continua sendo uma pessoa: o WhatsApp abre pelo link do painel e o e-mail sai pelo botão da Gestão.

Testes: `test/agente.test.js` cobre a autenticação, o que é lido, o que é recusado e a atualização da ação.

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
