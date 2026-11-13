import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Limites dos planos gratuitos e as travas do app (sempre abaixo do limite).
 * Nenhum desses serviços cobra no plano gratuito sem cartão cadastrado: as
 * travas existem para o app nunca chegar ao ponto de parar.
 */
export const LIMITES = {
  brapi: { nome: "brapi (cotações B3)", plano: "15.000 requisições/mês", trava: 12_000, periodo: "mes" as const },
  finnhubMin: { nome: "Finnhub (EUA) — por minuto", plano: "60 chamadas/minuto", trava: 50, periodo: "minuto" as const },
  finnhubDia: { nome: "Finnhub (EUA) — por dia", plano: "sem limite diário publicado", trava: 2_000, periodo: "dia" as const },
  ptax: { nome: "PTAX Banco Central", plano: "sem limite publicado", trava: 300, periodo: "dia" as const },
  atualizarManual: { nome: "Botão Atualizar agora", plano: "proteção contra cliques repetidos", trava: 6, periodo: "hora" as const },
};
export type ServicoLimitado = keyof typeof LIMITES;

/** Banco do Supabase: plano gratuito = 500 MB. */
export const BANCO = { planoBytes: 500 * 1024 * 1024, avisoPct: 0.7, travaPct: 0.9 };

export function periodoAtual(p: "mes" | "dia" | "hora" | "minuto", d = new Date()) {
  const sp = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(d).replace(" ", "T"); // 2026-11-12T23:59
  return p === "mes" ? sp.slice(0, 7) : p === "dia" ? sp.slice(0, 10) : p === "hora" ? sp.slice(0, 13) : sp.slice(0, 16);
}

/** Reserva até `qtd` usos do serviço. Devolve quantos foram liberados (0 = trava). */
export async function reservar(servico: ServicoLimitado, qtd: number): Promise<number> {
  if (qtd <= 0) return 0;
  const l = LIMITES[servico];
  const { data, error } = await createAdminClient().rpc("consumir_cota", {
    p_servico: servico, p_periodo: periodoAtual(l.periodo), p_qtd: qtd, p_limite: l.trava,
  });
  if (error) return 0; // na dúvida, não chama o serviço externo
  return Number(data ?? 0);
}

export type Uso = {
  servico: string; nome: string; plano: string; trava: number; usado: number; bloqueado: number; pct: number; periodo: string;
};
export type ResumoUso = { servicos: Uso[]; banco: { bytes: number; pct: number } | null; alertas: string[] };

/** Uso atual de cada serviço e do banco, para o painel e o aviso no topo. */
export async function resumoUso(): Promise<ResumoUso> {
  const admin = createAdminClient();
  const chaves = (Object.keys(LIMITES) as ServicoLimitado[]).map((s) => ({ s, p: periodoAtual(LIMITES[s].periodo) }));
  const { data } = await admin.from("uso_servicos").select("servico,periodo,contagem,bloqueado")
    .in("servico", chaves.map((c) => c.s)).in("periodo", [...new Set(chaves.map((c) => c.p))]);
  const servicos = chaves.map(({ s, p }) => {
    const row = (data ?? []).find((r) => r.servico === s && r.periodo === p);
    const usado = Number(row?.contagem ?? 0);
    return { servico: s, nome: LIMITES[s].nome, plano: LIMITES[s].plano, trava: LIMITES[s].trava, usado, bloqueado: Number(row?.bloqueado ?? 0), pct: usado / LIMITES[s].trava, periodo: p };
  });
  let banco: ResumoUso["banco"] = null;
  const { data: bytes } = await admin.rpc("tamanho_banco");
  if (bytes != null) banco = { bytes: Number(bytes), pct: Number(bytes) / BANCO.planoBytes };

  const alertas: string[] = [];
  for (const u of servicos) {
    if (u.servico === "atualizarManual" || u.servico === "finnhubMin") continue; // janelas curtas, não vale alerta
    if (u.pct >= 1) alertas.push(`${u.nome}: trava atingida (${u.usado}/${u.trava}). Chamadas suspensas até o próximo período.`);
    else if (u.pct >= 0.8) alertas.push(`${u.nome}: ${Math.round(u.pct * 100)}% da trava usada.`);
  }
  if (banco && banco.pct >= BANCO.travaPct) alertas.push(`Banco de dados em ${Math.round(banco.pct * 100)}% do limite gratuito: importações bloqueadas.`);
  else if (banco && banco.pct >= BANCO.avisoPct) alertas.push(`Banco de dados em ${Math.round(banco.pct * 100)}% do limite gratuito (500 MB).`);
  return { servicos, banco, alertas };
}

/** Importações recusadas quando o banco passa de 90% do plano gratuito. */
export async function bancoCheio(): Promise<boolean> {
  const { data } = await createAdminClient().rpc("tamanho_banco");
  return data != null && Number(data) >= BANCO.planoBytes * BANCO.travaPct;
}
