-- =====================================================================
-- 0003 — importação dos relatórios da B3
-- Rode no SQL Editor do projeto Supabase PESSOAL (depois do 0001 e 0002).
-- =====================================================================

-- Identificador da linha do relatório: impede importar o mesmo provento duas vezes.
alter table public.proventos
  add column origem text check (length(origem) <= 80);
alter table public.proventos
  add constraint proventos_origem_unica unique (user_id, origem);
