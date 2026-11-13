-- =====================================================================
-- 0008 — Índices de referência e leitura do histórico de preços
--   * indices: série diária de IBOV, IDIV, IFIX, S&P 500, CDI e IPCA
--     (nível acumulado; CDI e IPCA viram um "índice" a partir das taxas)
--   * historico_precos / historico_indices: devolvem a série em um único
--     JSON (evita o limite de 1000 linhas por requisição da API)
-- =====================================================================
create table if not exists public.indices (
  codigo text not null check (codigo in ('IBOV','IDIV','IFIX','SP500','CDI','IPCA')),
  data date not null,
  valor numeric(24,10) not null check (valor > 0),
  atualizado_em timestamptz not null default now(),
  primary key (codigo, data)
);
alter table public.indices enable row level security;
drop policy if exists "leitura com 2FA" on public.indices;
create policy "leitura com 2FA" on public.indices
  for select to authenticated
  using (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2');

revoke all on public.indices from anon, authenticated;
grant select on public.indices to authenticated;
grant select, insert, update on public.indices to service_role;

-- Preços diários de vários tickers a partir de uma data: {"PETR4": [["2026-08-01", 31.2], ...], ...}
create or replace function public.historico_precos(p_chaves text[], p_desde date)
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(json_object_agg(ticker, serie), '{}'::json) from (
    select c.ticker, json_agg(json_build_array(c.data, c.fechamento) order by c.data) as serie
    from public.cotacoes c
    where c.ticker = any(p_chaves) and c.data >= p_desde
    group by c.ticker
  ) t;
$$;

-- Índices a partir de uma data: {"IBOV": [["2026-08-01", 135000.5], ...], ...}
create or replace function public.historico_indices(p_desde date)
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(json_object_agg(codigo, serie), '{}'::json) from (
    select i.codigo, json_agg(json_build_array(i.data, i.valor) order by i.data) as serie
    from public.indices i
    where i.data >= p_desde
    group by i.codigo
  ) t;
$$;

revoke all on function public.historico_precos(text[], date) from public, anon;
revoke all on function public.historico_indices(date) from public, anon;
grant execute on function public.historico_precos(text[], date) to authenticated, service_role;
grant execute on function public.historico_indices(date) to authenticated, service_role;
