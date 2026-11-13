-- =====================================================================
-- 0004 — novas classes para o exterior (REITs e ETFs internacionais)
-- Rode no SQL Editor do projeto Supabase PESSOAL.
-- =====================================================================
alter type public.classe_ativo add value if not exists 'reit';
alter type public.classe_ativo add value if not exists 'etf_exterior';
