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
