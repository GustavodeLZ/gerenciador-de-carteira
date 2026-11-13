-- =====================================================================
-- 0005 — rotina diária também cota REITs e ETFs internacionais
-- (compara a classe como texto: funciona mesmo rodando junto com o 0004)
-- =====================================================================
create or replace function public.tickers_para_cotar()
returns table (ticker text, moeda text)
language sql
security definer
set search_path = ''
as $$
  select distinct a.ticker, a.moeda from public.ativos a
  where (a.moeda = 'BRL' and a.classe in ('acao','fii','etf','bdr'))
     or (a.moeda = 'USD' and a.classe::text in ('acao','etf','exterior','reit','etf_exterior'));
$$;
revoke all on function public.tickers_para_cotar() from public, anon, authenticated;
grant execute on function public.tickers_para_cotar() to service_role;
