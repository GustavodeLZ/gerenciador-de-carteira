import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Exige usuário logado E com segundo fator verificado (aal2).
 * Use no topo de toda página e server action com dados da carteira.
 */
export async function requireUser() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims) redirect("/login");

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") redirect("/mfa");

  return { supabase, userId: claims.claims.sub as string };
}

/** Versão para server actions: devolve erro em vez de redirecionar. */
export async function userForAction() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!claims?.claims || aal?.currentLevel !== "aal2") return null;
  return { supabase, userId: claims.claims.sub as string };
}
