-- =====================================================================
-- 0006 — controle de uso dos serviços gratuitos (travas de segurança)
-- =====================================================================

-- Contador por serviço e período ('2026-11' mês, '2026-11-12' dia, '2026-11-12T14:05' minuto)
create table public.uso_servicos (
  servico text not null check (length(servico) <= 40),
  periodo text not null check (length(periodo) <= 20),
  contagem integer not null default 0 check (contagem >= 0),
  bloqueado integer not null default 0 check (bloqueado >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (servico, periodo)
);
alter table public.uso_servicos enable row level security;
alter table public.uso_servicos force row level security;
create policy "leitura com 2FA" on public.uso_servicos
  for select to authenticated
  using (coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2');
revoke all on public.uso_servicos from anon, authenticated;
grant select on public.uso_servicos to authenticated;
grant select, insert, update on public.uso_servicos to service_role;

-- Reserva até p_qtd unidades sem passar de p_limite no período.
-- Devolve quantas foram concedidas (0 = trava atingida). Atômico.
create or replace function public.consumir_cota(p_servico text, p_periodo text, p_qtd integer, p_limite integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  atual integer;
  concedido integer;
begin
  if p_qtd <= 0 then return 0; end if;
  insert into public.uso_servicos (servico, periodo) values (p_servico, p_periodo)
    on conflict (servico, periodo) do nothing;
  select contagem into atual from public.uso_servicos
    where servico = p_servico and periodo = p_periodo for update;
  concedido := least(p_qtd, greatest(p_limite - atual, 0));
  update public.uso_servicos
     set contagem = atual + concedido,
         bloqueado = bloqueado + (p_qtd - concedido),
         atualizado_em = now()
   where servico = p_servico and periodo = p_periodo;
  return concedido;
end;
$$;
revoke all on function public.consumir_cota(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.consumir_cota(text, text, integer, integer) to service_role;

-- Tamanho do banco (para o limite de 500 MB do plano gratuito)
create or replace function public.tamanho_banco()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$ select pg_database_size(current_database()); $$;
revoke all on function public.tamanho_banco() from public, anon, authenticated;
grant execute on function public.tamanho_banco() to service_role;
