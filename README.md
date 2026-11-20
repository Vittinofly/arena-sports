# Arena Esporte: site, agendamento e painel da arena

Site e app de reservas da Arena Esporte, arena de futevôlei e vôlei de areia em São Luís de Montes Belos (GO). Páginas estáticas (HTML, CSS e JS puros) e um banco no Supabase, que guarda as reservas e confere as regras de negócio. Não depende de sistema de terceiros para agendar.

| Página | Para quê |
| :--- | :--- |
| `index.html` | Landing: horários livres de hoje ao vivo, a arena, modalidades, combinados, depoimentos, fotos, dúvidas, como chegar |
| `agendar.html` | Agendamento do cliente: dia, hora, quadra e dados. É também a tela inicial do app instalado |
| `reserva.html` | "Minha reserva": status, salvar na agenda, cancelar no prazo, achar pelo código + WhatsApp |
| `admin.html` | Painel da arena, **com login obrigatório** |

## Arquivos

| Arquivo | O que é |
| :--- | :--- |
| `style.css` | Design system "Fim de tarde na areia" (tokens em `:root`), landing e telas do app |
| `admin.css` | Estilo do painel (usa os tokens do `style.css`) |
| `script.js` | Interação da landing: header, menu, revelação, FAQ, carrossel, galeria, bola em arco |
| `js/config.js` | **Chaves do Supabase**, endereço do site, contatos padrão e login do modo demonstração |
| `js/regras.js` | Regras de negócio (funções puras, testadas). As mesmas regras estão no banco |
| `js/dados.js` | Camada de dados: Supabase ou, sem chaves, modo demonstração |
| `js/publico.js` | Partes vivas da landing (horários livres, aberto agora, números das regras) |
| `js/agendar.js`, `js/reserva.js`, `js/bilhete.js` | Fluxo de reserva do cliente e o "bilhete" da reserva |
| `js/pix.js` | Pix copia e cola (BR Code), só aparece se o Pix for ligado no painel |
| `js/admin.js` | Painel |
| `js/app.js`, `sw.js`, `manifest.webmanifest` | App instalável (PWA) |
| `js/seed.js` | Dados de exemplo do modo demonstração |
| `supabase/schema.sql` | Tabelas, regras (funções e gatilhos), segurança (RLS) e tempo real |
| `tests/` | Testes das regras e do banco (não vai para o ar) |
| `fonts/` | Archivo variável (licença OFL) |
| `img/` | Fotos em WebP com metadados; originais em `img/originais/` |
| `design/` | Filosofia visual "Arco Medido", a Prancha 17 (PNG 2160 × 2700 e PDF vetorial, com o HTML que a gera), o gerador da imagem de compartilhamento (`gerar-og.py`) e as fontes com licença OFL |
| `ficha.md` | Ficha do cliente: o que foi confirmado e o que falta |
| `vercel.json`, `publicar.mjs` | Publicação na Vercel: monta a pasta `publico/` só com o que vai para o ar, cabeçalhos de cache e segurança |

## Regras de negócio

Valem no site, no app e no banco. Com o Supabase ligado, o site só cria reserva pela função `criar_reserva()`, que confere tudo de novo no servidor: ninguém fura a regra mexendo no navegador.

| Regra | Padrão | Onde muda |
| :--- | :--- | :--- |
| Mesma quadra nunca tem 2 reservas ativas no mesmo horário (inclusive 2h que invadem outra) | sempre | trava no banco (`exclude using gist`) |
| Dia passado, horário que já começou e data que não existe (30/02) | bloqueados | fixo |
| Horário que não existe: fora da grade (19:30), antes de abrir, depois de fechar, 25:00 | bloqueado | grade = abertura + duração do horário |
| Dia fechado na semana, feriado fechado ou horário especial do feriado | segue o painel | Horário e regras / Feriados |
| Quadra fora de uso | some de tudo | Quadras |
| Quadra "só no balcão" (aula, escolinha) | o site não oferece, o ADM marca | Quadras |
| Turma fixa toda semana ocupa o horário (dá para pular uma data) | segue o painel | Horários fixos |
| Bloqueio de quadra (manutenção, torneio), de uma ou de todas | segue o painel | Feriados e bloqueios |
| **Reservas ativas por WhatsApp** | **1** (jogou ou cancelou, pode marcar outra) | Horário e regras |
| Antecedência mínima pelo site | 1 hora | Horário e regras |
| Agenda aberta para os próximos | 30 dias | Horário e regras |
| Horários seguidos por reserva | até 2 | Horário e regras |
| Cancelamento pelo cliente (reserva confirmada) | até 3h antes; pendente pode cancelar até começar | Horário e regras |
| Faltas sem aviso em 6 meses que suspendem a reserva pelo site | 2 | Horário e regras |
| WhatsApp suspenso manualmente | não reserva pelo site | Clientes |
| Nome (3+ letras) e WhatsApp brasileiro válido (DDD real, celular com 9) | obrigatório | fixo |
| Freio contra robô: campo invisível, 30 pedidos/10 min no site, 4 cancelamentos/24h por WhatsApp | ativo | fixo |
| Fuso de Brasília em todas as contas | sempre | `OFFSET_MIN` em `js/regras.js` |

No painel o ADM pode passar por cima de antecedência, janela, limite do cliente e quadra "só no balcão", mas **nunca** marca dois no mesmo horário, em dia fechado, fora da grade ou no passado.

## Modo demonstração (sem Supabase)

Com `supabaseUrl` e `supabaseAnonKey` vazios em `js/config.js`, tudo funciona com dados de exemplo, mas fica salvo **só no navegador** de quem usa. Serve para apresentar ao cliente.

O painel pede login também no demo. O acesso fica em `js/config.js` (`demoAdmin`):

- e-mail: `admin@arenaesporte.com.br`
- senha: `arena2026`

Troque antes de mostrar ao cliente. No painel, "Restaurar dados de exemplo" apaga o que foi feito e volta ao exemplo.

## Colocar no ar com o Supabase (uns 10 minutos)

1. Crie um projeto em <https://supabase.com> (o plano gratuito serve).
2. **SQL Editor > New query**: cole todo o `supabase/schema.sql` e rode. Pode rodar de novo depois sem perder dados. Ele já cria as 3 quadras e o horário padrão (todo dia, 17h às 23h).
3. **Authentication > Sign In / Providers**: desligue *Allow new users to sign up*.
4. **Authentication > Users > Add user**: crie o login da arena (e-mail e senha, marque *Auto Confirm*).
5. Libere esse login no painel, trocando o e-mail:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'email-da-arena@exemplo.com'
   on conflict do nothing;
   ```
6. **Authentication > URL Configuration**: em *Site URL* coloque o endereço do site e, em *Redirect URLs*, `https://SEU-DOMINIO/admin.html` (é para onde volta o link de "Esqueci minha senha").
7. **Project Settings > API**: copie a *Project URL* e a chave *anon public* para `js/config.js`.
8. Publique na Vercel (seção abaixo). Se o endereço final não for `arena-esporte.vercel.app`, troque também o `siteUrl` em `js/config.js`.

A chave *anon* pode ficar no site: quem protege os dados é o RLS do `schema.sql`. O público lê só quadras, horários, feriados, bloqueios e contatos; a ocupação da agenda sai pela função `ocupacao()`, sem nome nem telefone de ninguém. Reservas, turmas fixas e clientes só o ADM vê. **Nunca** coloque a chave *service_role* no site.

## Publicar na Vercel

1. Em <https://vercel.com/new>, importe o repositório `Vittinofly/arena-sports`.
2. Em **Project Name**, coloque `arena-esporte` (o endereço fica `arena-esporte.vercel.app`; `arena-sports.vercel.app` já é de outro site). Deixe **Framework Preset** em *Other* e não mexa em Build/Output: o `vercel.json` já define tudo.
3. **Deploy**. Depois disso, cada `git push` na `main` publica sozinho.

O `vercel.json` roda `node publicar.mjs`, que copia para `publico/` só as páginas, `js/`, `fonts/`, `img/` (sem `img/originais/`) e os arquivos de SEO. `ficha.md`, `README.md`, `design/`, `supabase/` e `tests/` não vão para o ar. Para conferir antes de enviar: `node publicar.mjs` e abrir a pasta `publico/`.

Domínio próprio: **Settings > Domains** na Vercel, e então trocar `https://arena-esporte.vercel.app/` pelo novo endereço (lista dos arquivos em "Atualizar depois de publicar").

## Como a arena usa o painel (`/admin.html`)

- **Agenda**: grade horas × quadras do dia. Clique no "+ Livre" para lançar uma reserva de balcão; clique numa reserva para confirmar, remarcar, marcar pago, cancelar ou marcar presença.
- **Pedidos**: pendentes do site, próximas, já passaram e canceladas, com busca. Confirmou ou cancelou? Aparece o botão verde com a mensagem pronta no WhatsApp do cliente.
- **Horários fixos**: turmas que jogam toda semana; "Pular uma data" libera um dia; "Pausar" devolve o horário para o site.
- **Feriados e bloqueios**: fechar a arena num dia, abrir em horário especial, importar os feriados nacionais com um clique, bloquear quadras. Se já houver reservas no período, o painel lista e oferece cancelar e avisar cada cliente.
- **Quadras**: em uso, reserva pelo site, nome, descrição e ordem.
- **Horário e regras**: dias e horário de funcionamento, todas as regras da tabela acima, preço da hora e horário nobre, modalidades.
- **Clientes**: histórico de 12 meses por WhatsApp, faltas, suspender e liberar.
- **Contatos e aviso**: WhatsApp, Instagram, endereço, faixa de aviso no topo do site e Pix opcional.
- **Ligar alertas**: o painel apita e mostra notificação quando chega pedido novo (tempo real do Supabase; sem ele, atualiza a cada minuto).

## App no celular (PWA)

Na página de agendamento aparece "Instalar app" (Android/Chrome) ou o passo a passo do iPhone (Compartilhar > Adicionar à Tela de Início). O app abre direto no agendamento e lembra das reservas e do nome/WhatsApp do cliente naquele aparelho.

A cada publicação com mudança de arquivos, troque `VERSAO` em `sw.js` (ex.: `arena-esporte-v2`) para os celulares pegarem a versão nova.

## Testes

```bash
cd tests
npm install
npm test        # 13 testes das regras + 25 do banco (schema.sql num Postgres em memória)
```

## Atualizar depois de publicar

- Trocar `https://arena-esporte.vercel.app/` pelo domínio final em: `index.html`, `agendar.html`, `robots.txt`, `sitemap.xml`, `llms.txt` e `js/config.js`.
- Search Console: verificar o domínio e enviar o `sitemap.xml`.
- GA4: o bloco está comentado no `<head>` do `index.html`; troque `G-XXXXXXXXXX` e tire o comentário.
- Depois de confirmar o horário com a arena, acrescentar `openingHoursSpecification` no JSON-LD do `index.html`.
- Logo: o arquivo atual tem só 150 px. Com a versão grande, gerar de novo `img/logo-arena-esporte.*`, os favicons e os ícones do app.
