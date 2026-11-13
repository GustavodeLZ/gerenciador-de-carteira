-- =====================================================================
-- 0007 — tira da API funções que só o banco/servidor usam
-- (apontado pelo verificador de segurança do Supabase)
-- =====================================================================
revoke all on function public.tamanho_banco() from public, anon, authenticated;
grant execute on function public.tamanho_banco() to service_role;
revoke all on function public.bloquear_cadastro_nao_permitido() from public, anon, authenticated;
-- criada pelo Supabase com a opção "Enable automatic RLS"
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
