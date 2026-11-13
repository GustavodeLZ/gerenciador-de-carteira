import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { chaveCotacao, temCotacaoAuto, CHAVE_DOLAR } from "@/lib/carteira";
import { calcularDesempenho, type Serie } from "@/lib/desempenho";
import { dataSP } from "@/lib/cotacoes";
import { env } from "@/lib/env";
import type { Carteira } from "@/lib/dados";

export type DadosComparacao = {
  serie: Serie;
  indices: Record<string, Serie>;
  hoje: string;
  semHistorico: string[];
  temTiingo: boolean;
};

const somaDias = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** Rentabilidade (cota) da carteira ou de um conjunto de ativos, mais os índices do mesmo período. */
export async function carregarComparacao(sb: SupabaseClient, c: Carteira, ativoIds?: Set<string>): Promise<DadosComparacao> {
  const hoje = dataSP();
  const ativos = ativoIds ? c.ativos.filter((a) => ativoIds.has(a.id)) : c.ativos;
  const ids = new Set(ativos.map((a) => a.id));
  const ops = c.operacoes.filter((o) => ids.has(o.ativo_id));
  const chaves = [...new Set(ativos.filter(temCotacaoAuto).map(chaveCotacao)), CHAVE_DOLAR];
  const desde = ops.length ? ops.reduce((m, o) => (o.data < m ? o.data : m), hoje) : hoje;

  let serie: Serie = [];
  let semHistorico: string[] = [];
  if (ops.length) {
    const { data } = await sb.rpc("historico_precos", { p_chaves: chaves, p_desde: somaDias(desde, -10) });
    const precos = (data ?? {}) as Record<string, Serie>;
    const r = calcularDesempenho({
      ativos, ops, proventos: c.proventos, precos, dolar: precos[CHAVE_DOLAR] ?? [], dolarAtual: c.dolar ?? 5, hoje,
    });
    serie = r.pontos.map((p) => [p.data, p.cota]);
    semHistorico = r.semHistorico;
  }
  // índices desde um pouco antes do início (o IPCA é mensal)
  const inicio = serie[0]?.[0] ?? somaDias(hoje, -400);
  const { data: idx } = await sb.rpc("historico_indices", { p_desde: somaDias(inicio, -45) });
  return { serie, indices: (idx ?? {}) as Record<string, Serie>, hoje, semHistorico, temTiingo: !!env.tiingoToken() };
}
