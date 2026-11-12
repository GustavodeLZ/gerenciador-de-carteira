import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Cliente com a chave secreta: IGNORA RLS.
 * Use apenas para gravar cotações (dado público de mercado).
 * Nunca para ler ou gravar dados de carteira.
 */
export function createAdminClient() {
  return createClient(env.supabaseUrl(), env.supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
