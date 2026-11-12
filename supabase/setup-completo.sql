-- =====================================================================
-- Minha Carteira — instalação completa (0001 + 0002 + 0003)
-- Cole TODO este conteúdo no SQL Editor do projeto Supabase PESSOAL e clique em Run.
-- =====================================================================

-- =====================================================================
-- Minha Carteira — esquema inicial
-- Rode este arquivo inteiro no SQL Editor do projeto Supabase PESSOAL.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Quem pode criar conta (allowlist)
--    Mesmo que o cadastro público seja ligado por engano, só e-mails
--    desta tabela conseguem criar usuário.
-- ---------------------------------------------------------------------
create table public.emails_permitidos (
  email text primary key check (email = lower(email))
);
alter table public.emails_permitidos enable row level security;
-- sem policies: ninguém lê ou escreve pela API; só pelo painel/SQL.

create or replace function public.bloquear_cadastro_nao_permitido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.emails_permitidos where email = lower(new.email)
  ) then
    raise exception 'Cadastro não permitido para este e-mail';
  end if;
  return new;
end;
$$;

create trigger antes_de_criar_usuario
  before insert on auth.users
  for each row execute function public.bloquear_cadastro_nao_permitido();

-- ---------------------------------------------------------------------
-- 2. Regra de acesso: dono do dado E sessão com 2FA (aal2)
--    Sem o segundo fator, o banco devolve zero linhas — mesmo que o
--    site tenha algum bug.
-- ---------------------------------------------------------------------
create or replace function public.eh_dono(dono uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select dono = (select auth.uid())
     and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2';
$$;

-- ---------------------------------------------------------------------
-- 3. Tabelas do usuário
-- ---------------------------------------------------------------------
create type public.classe_ativo as enum
  ('acao','fii','etf','bdr','renda_fixa','tesouro','cripto','exterior','outros');

create type public.tipo_operacao as enum
  ('compra','venda','desdobramento','grupamento','bonificacao');

create type public.tipo_provento as enum
  ('dividendo','jcp','rendimento','juros','outro');

create table public.ativos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  ticker text not null check (length(ticker) between 1 and 40),
  nome text check (length(nome) <= 120),
  classe public.classe_ativo not null,
  -- usado quando o ativo não tem cotação automática (renda fixa, cripto…)
  preco_manual numeric(20,8),
  preco_manual_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (user_id, ticker)
);

create table public.operacoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  ativo_id uuid not null references public.ativos on delete cascade,
  tipo public.tipo_operacao not null,
  data date not null,
  -- compra/venda/bonificação: quantidade de cotas
  -- desdobramento/grupamento: fator (ex.: 2 = cada 1 vira 2; grupamento 10 = cada 10 viram 1)
  quantidade numeric(24,8) not null check (quantidade > 0),
  preco numeric(20,8) not null default 0 check (preco >= 0),
  taxas numeric(20,2) not null default 0 check (taxas >= 0),
  nota text check (length(nota) <= 300),
  criado_em timestamptz not null default now()
);
create index on public.operacoes (user_id, ativo_id, data);

create table public.proventos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  ativo_id uuid not null references public.ativos on delete cascade,
  tipo public.tipo_provento not null default 'dividendo',
  data_pagamento date not null,
  valor_total numeric(20,2) not null check (valor_total > 0),
  criado_em timestamptz not null default now()
);
create index on public.proventos (user_id, data_pagamento);

create table public.segmentos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  nome text not null check (length(nome) between 1 and 60),
  descricao text check (length(descricao) <= 200),
  meta_pct numeric(6,2) check (meta_pct between 0 and 100),
  criado_em timestamptz not null default now(),
  unique (user_id, nome)
);

create table public.segmento_ativos (
  segmento_id uuid not null references public.segmentos on delete cascade,
  ativo_id uuid not null references public.ativos on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  meta_pct numeric(6,2) check (meta_pct between 0 and 100),
  primary key (segmento_id, ativo_id)
);

-- Garante que operações/proventos/segmentos só apontem para ativos do
-- próprio usuário (evita "pendurar" dado em ativo alheio).
create or replace function public.checar_mesmo_dono()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.ativos a
                 where a.id = new.ativo_id and a.user_id = new.user_id) then
    raise exception 'Ativo inválido';
  end if;
  if tg_table_name = 'segmento_ativos' then
    if not exists (select 1 from public.segmentos s
                   where s.id = new.segmento_id and s.user_id = new.user_id) then
      raise exception 'Segmento inválido';
    end if;
  end if;
  return new;
end;
$$;

create trigger dono_operacoes before insert or update on public.operacoes
  for each row execute function public.checar_mesmo_dono();
create trigger dono_proventos before insert or update on public.proventos
  for each row execute function public.checar_mesmo_dono();
create trigger dono_segmento_ativos before insert or update on public.segmento_ativos
  for each row execute function public.checar_mesmo_dono();

-- RLS em tudo, com a mesma regra
do $$
declare t text;
begin
  foreach t in array array['ativos','operacoes','proventos','segmentos','segmento_ativos']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format($p$create policy "dono com 2FA" on public.%I
                      for all to authenticated
                      using (public.eh_dono(user_id))
                      with check (public.eh_dono(user_id))$p$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Cotações (dado de mercado, igual para todos)
--    Usuários logados com 2FA só leem. Só o servidor (service role,
--    usado pela rotina diária) escreve.
-- ---------------------------------------------------------------------
create table public.cotacoes (
  ticker text not null,
  data date not null,
  fechamento numeric(20,8) not null,
  atualizado_em timestamptz not null default now(),
  primary key (ticker, data)
);
alter table public.cotacoes enable row level security;
create policy "leitura com 2FA" on public.cotacoes
  for select to authenticated
  using (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2');

-- Última cotação de cada ticker
create view public.cotacoes_atuais
with (security_invoker = true) as
  select distinct on (ticker) ticker, data, fechamento, atualizado_em
  from public.cotacoes
  order by ticker, data desc;

-- Tickers que a rotina diária deve buscar (só para o service role)
create or replace function public.tickers_para_cotar()
returns table (ticker text)
language sql
security definer
set search_path = ''
as $$
  select distinct a.ticker from public.ativos a
  where a.classe in ('acao','fii','etf','bdr');
$$;
revoke all on function public.tickers_para_cotar() from public, anon, authenticated;
grant execute on function public.tickers_para_cotar() to service_role;

-- ---------------------------------------------------------------------
-- 5. Permissões explícitas (mínimo necessário)
--    Pensado para o projeto criado com "Automatically expose new tables"
--    DESLIGADO: nada fica acessível pela API sem estar listado aqui.
--    As regras de RLS acima continuam valendo por cima destas permissões.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;

-- usuário logado: dados da própria carteira (filtrados pelo RLS)
grant select, insert, update, delete on
  public.ativos, public.operacoes, public.proventos,
  public.segmentos, public.segmento_ativos
to authenticated;

-- usuário logado: só lê cotações
grant select on public.cotacoes, public.cotacoes_atuais to authenticated;

-- servidor (rotina diária): grava cotações
grant select, insert, update on public.cotacoes to service_role;

-- emails_permitidos: nenhuma permissão pela API (só painel/SQL)

-- =====================================================================
-- 0002 — ativos em dólar, câmbio por operação e importação de notas
-- Rode depois do 0001, no SQL Editor do projeto Supabase PESSOAL.
-- =====================================================================

-- Moeda de negociação do ativo (o preço e as operações ficam nessa moeda)
alter table public.ativos
  add column moeda text not null default 'BRL' check (moeda in ('BRL','USD'));

-- Câmbio (R$ por 1 unidade da moeda) usado para converter o custo da operação.
-- Nulo para ativos em reais.
alter table public.operacoes
  add column cambio numeric(14,6) check (cambio > 0);

-- Identificador da linha na nota importada: impede importar a mesma nota duas vezes.
alter table public.operacoes
  add column origem text check (length(origem) <= 80);
-- (NULLs não conflitam entre si, então operações manuais não são afetadas)
alter table public.operacoes
  add constraint operacoes_origem_unica unique (user_id, origem);

-- Proventos ficam na moeda do ativo (dividendos americanos em US$)
-- (sem mudança de coluna: a moeda é a do ativo)

-- A rotina diária agora precisa saber a moeda de cada ticker
drop function if exists public.tickers_para_cotar();
create or replace function public.tickers_para_cotar()
returns table (ticker text, moeda text)
language sql
security definer
set search_path = ''
as $$
  select distinct a.ticker, a.moeda from public.ativos a
  where (a.moeda = 'BRL' and a.classe in ('acao','fii','etf','bdr'))
     or (a.moeda = 'USD' and a.classe in ('acao','etf','exterior'));
$$;
revoke all on function public.tickers_para_cotar() from public, anon, authenticated;
grant execute on function public.tickers_para_cotar() to service_role;

-- Convenção da tabela cotacoes:
--   ticker 'PETR4'      → ação brasileira, em R$
--   ticker 'US:BRK.B'   → ação americana, em US$
--   ticker 'FX:USDBRL'  → PTAX de venda do dólar (Banco Central)

-- =====================================================================
-- 0003 — importação dos relatórios da B3
-- Rode no SQL Editor do projeto Supabase PESSOAL (depois do 0001 e 0002).
-- =====================================================================

-- Identificador da linha do relatório: impede importar o mesmo provento duas vezes.
alter table public.proventos
  add column origem text check (length(origem) <= 80);
alter table public.proventos
  add constraint proventos_origem_unica unique (user_id, origem);

-- =====================================================================
-- ÚLTIMO PASSO: troque pelo SEU e-mail pessoal antes de rodar.
-- Só este e-mail conseguirá criar conta no app.
-- =====================================================================
insert into public.emails_permitidos values (lower('SEU-EMAIL-PESSOAL@exemplo.com'));
