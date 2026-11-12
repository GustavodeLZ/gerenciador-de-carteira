function req(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

export const env = {
  supabaseUrl: () => req("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabasePublishableKey: () =>
    req("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  supabaseSecretKey: () => req("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY),
  brapiToken: () => req("BRAPI_TOKEN", process.env.BRAPI_TOKEN),
  /** Opcional: sem ele, ações americanas ficam com o preço manual/médio. */
  finnhubToken: () => process.env.FINNHUB_TOKEN || null,
  cronSecret: () => req("CRON_SECRET", process.env.CRON_SECRET),
};
