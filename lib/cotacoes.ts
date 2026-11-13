import "server-only";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { CHAVE_DOLAR, type Moeda } from "@/lib/carteira";
import { reservar } from "@/lib/limites";

const TICKER_B3 = /^[A-Z0-9]{4,7}$/;
const TICKER_US = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/** Data (AAAA-MM-DD) no fuso de São Paulo. */
export function dataSP(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

type Linha = { ticker: string; data: string; fechamento: number };

// ---------- brapi (B3) ----------
async function brapi(ticker: string): Promise<Linha | null> {
  const res = await fetch(`https://brapi.dev/api/quote/${encodeURIComponent(ticker)}`, {
    headers: { Authorization: `Bearer ${env.brapiToken()}` },
    cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { results?: { regularMarketPrice?: number; regularMarketTime?: string }[] };
  const q = json.results?.[0];
  const preco = Number(q?.regularMarketPrice);
  if (!q || !isFinite(preco) || preco <= 0) return null;
  const quando = q.regularMarketTime ? new Date(q.regularMarketTime) : new Date();
  return { ticker, data: dataSP(isNaN(quando.getTime()) ? new Date() : quando), fechamento: preco };
}

// ---------- Finnhub (EUA) ----------
async function finnhub(ticker: string): Promise<Linha | null> {
  const token = env.finnhubToken();
  if (!token) return null;
  const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}`, {
    headers: { "X-Finnhub-Token": token },
    cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const q = (await res.json()) as { c?: number; t?: number };
  const preco = Number(q.c);
  if (!isFinite(preco) || preco <= 0) return null; // Finnhub devolve c=0 para símbolo desconhecido
  const quando = q.t ? new Date(q.t * 1000) : new Date();
  return { ticker: `US:${ticker}`, data: dataSP(quando), fechamento: preco };
}

// ---------- PTAX (Banco Central) ----------
const mdY = (iso: string) => { const [y, m, d] = iso.split("-"); return `${m}-${d}-${y}`; };

/**
 * PTAX de venda (R$ por US$) do dia `iso` ou, se não houver boletim nesse dia
 * (fim de semana/feriado), do último dia útil anterior.
 */
export async function ptax(iso = dataSP()): Promise<{ data: string; valor: number } | null> {
  if ((await reservar("ptax", 1)) < 1) return null; // trava diária
  const fim = new Date(iso + "T12:00:00Z");
  const ini = new Date(fim); ini.setUTCDate(ini.getUTCDate() - 10);
  const url = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    "CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
    `?@dataInicial='${mdY(ini.toISOString().slice(0, 10))}'&@dataFinalCotacao='${mdY(iso)}'&$format=json&$select=cotacaoVenda,dataHoraCotacao`;
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { value?: { cotacaoVenda: number; dataHoraCotacao: string }[] };
    const ultimo = json.value?.at(-1);
    if (!ultimo || !(ultimo.cotacaoVenda > 0)) return null;
    return { data: ultimo.dataHoraCotacao.slice(0, 10), valor: ultimo.cotacaoVenda };
  } catch {
    return null;
  }
}

/** PTAX para várias datas, com cache por chamada. */
export async function ptaxDatas(datas: string[]) {
  const out = new Map<string, number>();
  for (const d of [...new Set(datas)]) {
    const r = await ptax(d);
    if (r) out.set(d, r.valor);
  }
  return out;
}

/**
 * Busca cotações (servidor, com tokens secretos) e grava na tabela pública.
 * Sem lista, cota todos os tickers da base (rotina diária).
 */
export async function atualizarCotacoes(lista?: { ticker: string; moeda: Moeda }[]) {
  const admin = createAdminClient();
  let itens = lista;
  if (!itens) {
    const { data, error } = await admin.rpc("tickers_para_cotar");
    if (error) throw new Error(error.message);
    itens = (data ?? []) as { ticker: string; moeda: Moeda }[];
  }
  const br = [...new Set(itens.filter((i) => i.moeda === "BRL").map((i) => i.ticker.toUpperCase()).filter((t) => TICKER_B3.test(t)))];
  const us = [...new Set(itens.filter((i) => i.moeda === "USD").map((i) => i.ticker.toUpperCase()).filter((t) => TICKER_US.test(t)))];

  const ok: string[] = [], falha: string[] = [];
  const linhas: (Linha & { atualizado_em: string })[] = [];
  const lote = async (tickers: string[], fn: (t: string) => Promise<Linha | null>, paralelo: number) => {
    for (let i = 0; i < tickers.length; i += paralelo) {
      const parte = tickers.slice(i, i + paralelo);
      const res = await Promise.allSettled(parte.map(fn));
      res.forEach((r, j) => {
        if (r.status === "fulfilled" && r.value) { linhas.push({ ...r.value, atualizado_em: new Date().toISOString() }); ok.push(parte[j]); }
        else falha.push(parte[j]);
      });
    }
  };
  // Travas: só chama o serviço externo para a quantidade liberada pela cota
  const travados: string[] = [];
  const okBr = await reservar("brapi", br.length);
  travados.push(...br.slice(okBr));
  await lote(br.slice(0, okBr), brapi, 3);
  if (us.length && env.finnhubToken()) {
    const okDia = await reservar("finnhubDia", us.length);
    const okMin = okDia ? await reservar("finnhubMin", okDia) : 0;
    travados.push(...us.slice(okMin));
    await lote(us.slice(0, okMin), finnhub, 5);
  } else falha.push(...us);

  if (us.length || itens.length === 0 || !lista) {
    const fx = await ptax();
    if (fx) linhas.push({ ticker: CHAVE_DOLAR, data: fx.data, fechamento: fx.valor, atualizado_em: new Date().toISOString() });
  }
  if (linhas.length) {
    const { error } = await admin.from("cotacoes").upsert(linhas, { onConflict: "ticker,data" });
    if (error) throw new Error(error.message);
  }
  return { ok, falha, travados };
}
