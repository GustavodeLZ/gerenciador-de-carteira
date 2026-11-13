# Minha Carteira

Gestão de carteira de investimentos com segmentos: um ativo pertence a uma classe (Ações, FIIs…) e pode estar em vários segmentos ("Dividendos", "Crescimento"…), cada um com seus próprios percentuais e metas.

**Stack:** Next.js 16 · Supabase (Postgres + login) · Vercel · brapi.dev (B3) · Finnhub (EUA) · PTAX do Banco Central (dólar)

---

## ⚠️ Antes de tudo: contas pessoais

Você tem GitHub e Supabase do trabalho. **Em cada passo abaixo, confira no canto superior da tela que está na conta/organização PESSOAL** antes de criar qualquer coisa ou copiar qualquer chave. Na Vercel, confira o "scope" (time) pessoal.

---

## 1. Supabase (banco e login)

1. Em supabase.com, **confira que está na organização pessoal** → *New project*.
   - Região: **South America (São Paulo)**.
   - Gere uma senha forte para o banco e guarde num gerenciador de senhas.
   - Em **Security**:
     - ✅ **Enable Data API** — ligado (o app usa a API).
     - ⬜ **Automatically expose new tables** — **desligado**. O script SQL concede só as permissões necessárias.
     - ✅ **Enable automatic RLS** — ligado (rede de segurança para tabelas futuras).
2. *SQL Editor* → *New query* → cole todo o conteúdo de `supabase/migrations/0001_init.sql` → *Run*.
   Depois, numa nova query, faça o mesmo com `0002_moeda_e_notas.sql` e `0003_importacao_b3.sql`.
   (Ou cole de uma vez o `supabase/setup-completo.sql`, que junta os três.)
3. Na mesma tela, rode (com o **seu e-mail pessoal**):
   ```sql
   insert into public.emails_permitidos values ('seu-email@exemplo.com');
   ```
   Só e-mails desta tabela conseguem criar conta.
4. *Authentication → Sign In / Providers*: deixe **Email** ligado.
5. *Authentication → Multi-Factor*: confirme que **TOTP** está habilitado.
6. *Project Settings → API Keys*: anote **Project URL**, **Publishable key** e **Secret key**.
   A secret key dá acesso total ao banco: só vai para a Vercel, nunca para o código ou para o navegador.

## 2. GitHub (código)

1. **Na conta pessoal**, crie um repositório **privado** vazio (ex.: `minha-carteira`).
2. Envie este projeto para ele (ou peça ao Claude para enviar, conectando a conta pessoal do GitHub).

## 3. Vercel (site)

1. Em vercel.com, **confira o scope pessoal** → *Add New → Project* → importe o repositório.
2. Em *Environment Variables*, cadastre (veja `.env.example`):
   | Variável | Valor |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL do Supabase |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key |
   | `SUPABASE_SECRET_KEY` | Secret key |
   | `BRAPI_TOKEN` | token da brapi.dev |
   | `FINNHUB_TOKEN` | API key gratuita da finnhub.io (ações americanas) |
   | `CRON_SECRET` | texto aleatório longo (ex.: gere em um gerenciador de senhas, 40+ caracteres) |
3. *Deploy*. Anote a URL (ex.: `https://minha-carteira-xyz.vercel.app`).

## 4. Ligar o login ao site

No Supabase, *Authentication → URL Configuration*:
- **Site URL:** a URL da Vercel.
- **Redirect URLs:** `https://SUA-URL.vercel.app/auth/callback` (e `http://localhost:3000/auth/callback` se for rodar localmente).

## 5. Primeiro acesso

1. Abra o site, informe o e-mail e clique no link recebido (no mesmo navegador).
2. Escaneie o QR code com um app autenticador (Google Authenticator, Authy, 1Password) e digite o código.
3. **Depois de entrar**, no Supabase: *Authentication → Sign In / Providers* → desligue **Allow new users to sign up**.
4. Em *Ajustes → Importar*, cole o backup JSON do app antigo, se quiser.

---

## Limites dos planos gratuitos (travas)

O app conta o uso de cada serviço externo no banco (`uso_servicos`) e para de chamar antes do limite:

| Serviço | Plano gratuito | Trava do app |
|---|---|---|
| brapi | 15.000 req/mês | 12.000/mês |
| Finnhub | 60/min | 50/min e 2.000/dia |
| PTAX (Banco Central) | sem limite publicado | 300/dia |
| Botão "Atualizar agora" | — | 6/hora |
| Supabase (banco) | 500 MB | aviso em 70%, importações bloqueadas em 90% |

Painel em *Ajustes → Limites* e aviso no topo do app a partir de 80%.
Vercel Hobby, Supabase Free, brapi e Finnhub gratuitos **não cobram** sem cartão cadastrado: ao estourar, o serviço só para até o próximo período.

## Segurança — o que já está ativo

- **Isolamento no banco (RLS):** cada linha tem dono; o banco só entrega dados do próprio usuário **e só se a sessão passou pelo 2FA** (`aal2`). Sem 2FA, as consultas voltam vazias, mesmo que o site tenha bug.
- **Allowlist de e-mails** no banco, além do cadastro desligado.
- **Segredos só no servidor:** o navegador nunca vê o token da brapi nem a secret key. A secret key é usada só para gravar cotações (dado público).
- **Cotações separadas da carteira:** a tabela de preços não tem nenhum dado pessoal.
- **Cabeçalhos de segurança:** CSP, HSTS, bloqueio de iframe, sem indexação em buscadores.
- **Rotina diária protegida** por `CRON_SECRET`.
- **Testes:** `npm test` (cálculos, leitor de notas e importação da B3) e `npm run test:db` (40 verificações de RLS, permissões e duplicidade).

### Recomendações
- Use um gerenciador de senhas e ative 2FA também no GitHub, Supabase e Vercel pessoais.
- Guarde os códigos de recuperação do app autenticador. Se perder o celular, o fator pode ser removido em *Authentication → Users → (seu usuário) → MFA* no Supabase.
- Backup: no plano gratuito o Supabase guarda pouco histórico. De tempos em tempos, exporte as tabelas (*Table Editor → Export CSV*). Uma rotina automática pode ser adicionada depois.
- Projetos gratuitos do Supabase pausam após 7 dias sem uso. A rotina diária de cotações (seg–sex) mantém o projeto ativo.

## Cotações

Automáticas, seg–sex às 18h30 (horário de Brasília). Também há o botão *Ajustes → Atualizar agora*.
- **B3** (ações, FIIs, ETFs, BDRs): brapi. Plano gratuito: 15 mil requisições/mês, 1 ativo por requisição, atraso ~30 min.
- **EUA** (ativos com moeda Dólar): Finnhub. Plano gratuito: ~60 requisições/minuto.
- **Dólar**: PTAX de venda do Banco Central (gratuita, sem cadastro).
- Renda fixa, Tesouro e cripto: informe o preço atual na página do ativo.

## Ativos em dólar

- Preço médio, cotação e proventos ficam em **US$**; saldo e totais da carteira em **R$**.
- O **custo em R$** de cada compra usa o câmbio da própria operação (PTAX de venda do dia, preenchida automaticamente; pode ser informada à mão).
- O **valor atual em R$** usa a PTAX mais recente. A rentabilidade em R$ inclui a variação do dólar; a página do ativo mostra também a rentabilidade só em US$.
- Para declaração de IR há regras específicas de conversão (ex.: origem dos recursos). O app é uma ferramenta de acompanhamento, não substitui a orientação de um contador.

## Importar relatórios da B3 (Excel)

Em *Importar → Relatórios da B3*. Na Área do Investidor da B3, baixe em Excel:
- **Extratos → Negociação** (maior período possível): compras e vendas.
- **Extratos → Movimentação** (maior período possível): proventos e eventos (desdobro, bonificação, subscrição, frações).
- **Posição de Carteira**: confere as quantidades e traz renda fixa e Tesouro.

O app mostra a conferência ativo por ativo antes de gravar:
- **Mudanças de código** (ex.: TRPL4 → ISAE4) são detectadas e aplicadas — o histórico é juntado ao código novo.
- Para **incorporações** que o app não detecta, escolha "ou virou →" na linha do código antigo.
- Diferenças que sobrarem viram um **ajuste de conciliação**: entrada pelo preço de fechamento (editável) ou saída pelo preço médio (sem lucro/prejuízo). Em incorporações, o ajuste é por fator e mantém o custo total.
- **Renda fixa e Tesouro** vêm da posição. A B3 não informa o valor aplicado de CDB/LCI: o custo entra igual ao valor atual.
- Títulos que **saíram da posição** em uma importação futura podem ser registrados como resgatados.

Reimportar é seguro: cada linha tem um identificador e nada é duplicado (inclusive os ajustes).
Não importe a B3 e lance as mesmas operações à mão — o app avisa quando um ativo já tem operações manuais.

## Importar nota de corretagem (PDF)

Em *Importar → Nota de corretagem*:
1. Envie o PDF (até 5 MB). Se tiver senha, o app pede.
2. Confira a tabela: escolha a classe dos ativos novos e, se quiser, os segmentos.
3. *Importar*. Linhas já importadas aparecem desmarcadas — não há risco de duplicar.

**Formatos suportados hoje:** confirmação de operação da conta internacional do Inter (Inter Co Securities / DriveWealth).
Para incluir outra corretora (ex.: nota da B3 no padrão SINACOR), adicione um leitor em `lib/notas/` e registre em `lib/notas/index.ts`.

**Privacidade:** o PDF é lido em memória no servidor e descartado. Nome, número da conta e senha do PDF não são salvos — só as operações que você confirmar.

## Como registrar

| Situação | Como lançar |
|---|---|
| Compra/venda | quantidade e preço unitário (+ taxas) |
| Desdobramento 1→2 | tipo *Desdobramento*, fator 2 |
| Grupamento 10→1 | tipo *Grupamento*, fator 10 |
| Bonificação | quantidade recebida e custo unitário atribuído |
| CDB / renda fixa | compra com quantidade 1 e preço = valor aplicado; atualize o *preço atual* na página do ativo |

## Rodar localmente

```bash
cp .env.example .env.local   # preencha com os valores do Supabase PESSOAL
npm install
npm run dev                  # http://localhost:3000
npm test && npm run test:db
```

## Próximos passos sugeridos

- Histórico diário do patrimônio e gráfico de evolução.
- Comparação com CDI e Ibovespa (rentabilidade ponderada pelo tempo).
- Leitor da nota da B3 (SINACOR), para quem não usa os relatórios da Área do Investidor.
- Proventos dos EUA a partir do extrato mensal (dividendos e imposto retido de 30%).
- Cálculo de IR (isenção de R$ 20 mil em ações, DARF).
- Para abrir a outros usuários: SMTP próprio para e-mails, termos de uso e política de privacidade (LGPD), cadastro com convite.
