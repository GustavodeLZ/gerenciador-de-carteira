import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calcularPosicoes, resumirSegmentos, chaveCotacao, dolarAtual, CHAVE_DOLAR,
  type Ativo, type Operacao, type Provento, type Segmento, type SegmentoAtivo, type Cotacao,
} from "@/lib/carteira";

/** Lê todas as linhas, contornando o limite de 1000 por requisição. */
async function lerTudo<T>(sb: SupabaseClient, tabela: string, colunas: string, ordem?: string): Promise<T[]> {
  const out: T[] = [];
  const pagina = 1000;
  for (let de = 0; ; de += pagina) {
    let q = sb.from(tabela).select(colunas).range(de, de + pagina - 1);
    if (ordem) q = q.order(ordem);
    const { data, error } = await q;
    if (error) throw new Error(`Erro ao ler ${tabela}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < pagina) break;
  }
  return out;
}

export async function carregarCarteira(sb: SupabaseClient) {
  const [ativos, operacoes, proventos, segmentos, vinculos] = await Promise.all([
    lerTudo<Ativo>(sb, "ativos", "id,ticker,nome,classe,moeda,preco_manual,preco_manual_em", "ticker"),
    lerTudo<Operacao>(sb, "operacoes", "id,ativo_id,tipo,data,quantidade,preco,taxas,cambio,criado_em", "data"),
    lerTudo<Provento>(sb, "proventos", "id,ativo_id,tipo,data_pagamento,valor_total", "data_pagamento"),
    lerTudo<Segmento>(sb, "segmentos", "id,nome,descricao,meta_pct", "nome"),
    lerTudo<SegmentoAtivo>(sb, "segmento_ativos", "segmento_id,ativo_id,meta_pct"),
  ]);

  const tickers = [...new Set([...ativos.map(chaveCotacao), CHAVE_DOLAR])];
  let cotacoes: Cotacao[] = [];
  {
    const { data, error } = await sb.from("cotacoes_atuais").select("ticker,data,fechamento").in("ticker", tickers);
    if (error) throw new Error(`Erro ao ler cotações: ${error.message}`);
    cotacoes = (data ?? []) as Cotacao[];
  }

  const todas = calcularPosicoes(ativos, operacoes, cotacoes, proventos);
  const posicoes = todas.filter((p) => p.quantidade > 1e-9);
  const total = posicoes.reduce((s, p) => s + p.valor, 0);
  const custo = posicoes.reduce((s, p) => s + p.custo, 0);
  const resumoSegmentos = resumirSegmentos(segmentos, vinculos, posicoes, total);
  const ultimaCotacao = cotacoes.filter((c) => c.ticker !== CHAVE_DOLAR).reduce<string | null>((m, c) => (!m || c.data > m ? c.data : m), null);
  const dolar = dolarAtual(cotacoes, operacoes);
  const dolarData = cotacoes.find((c) => c.ticker === CHAVE_DOLAR)?.data ?? null;

  return { dolar, dolarData, ativos, operacoes, proventos, segmentos, vinculos, todas, posicoes, total, custo, resumoSegmentos, ultimaCotacao };
}
export type Carteira = Awaited<ReturnType<typeof carregarCarteira>>;
