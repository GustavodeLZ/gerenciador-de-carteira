import "server-only";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { reservar } from "@/lib/limites";
import { dataSP, ptaxLista } from "@/lib/cotacoes";
import { CHAVE_DOLAR, temCotacaoAuto, type Ativo } from "@/lib/carteira";

/** Desde quando guardar os índices (início do histórico do myProfit). */
const INICIO_INDICES = "2023-01-01";
const agora = () => new Date().toISOString();
const br = (s: string) => Number(s.replace(/\./g, "").replace(",", "."));
const dmY = (iso: string) => iso.split("-").reverse().join("/");
const isoDe = (dmy: string) => dmy.split("/").reverse().join("-");

type LinhaIndice = { codigo: string; data: string; valor: number; atualizado_em: string };

async function gravarIndices(linhas: LinhaIndice[]) {
  const admin = createAdminClient();
  for (let i = 0; i < linhas.length; i += 1000) {
    const { error } = await admin.from("indices").upsert(linhas.slice(i, i + 1000), { onConflict: "codigo,data" });
    if (error) throw new Error(error.message);
  }
}

async function ultimo(codigo: string): Promise<{ data: string; valor: number } | null> {
  const { data } = await createAdminClient().from("indices").select("data,valor").eq("codigo", codigo).order("data", { ascending: false }).limit(1);
  return data?.[0] ? { data: String(data[0].data), valor: Number(data[0].valor) } : null;
}

// ---------- B3: IBOV, IDIV, IFIX (estatísticas históricas oficiais, um ano por consulta) ----------
async function b3Ano(indice: string, ano: number): Promise<LinhaIndice[] | null> {
  const param = Buffer.from(JSON.stringify({ language: "pt-br", index: indice, year: ano })).toString("base64");
  const res = await fetch(`https://sistemaswebb3-listados.b3.com.br/indexStatisticsProxy/IndexCall/GetPortfolioDay/${param}`, {
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { results?: Record<string, string | number | null>[] };
  const out: LinhaIndice[] = [];
  for (const r of json.results ?? []) {
    const dia = Number(r.day);
    for (let m = 1; m <= 12; m++) {
      const v = r[`rateValue${m}`];
      if (v == null || v === "") continue;
      const n = typeof v === "number" ? v : br(String(v));
      if (!(n > 0)) continue;
      const data = `${ano}-${String(m).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
      if (!isNaN(Date.parse(data))) out.push({ codigo: indice, data, valor: n, atualizado_em: agora() });
    }
  }
  return out;
}

async function atualizarB3(indice: "IBOV" | "IDIV" | "IFIX") {
  const u = await ultimo(indice);
  const anoAtual = Number(dataSP().slice(0, 4));
  const de = u ? Number(u.data.slice(0, 4)) : Number(INICIO_INDICES.slice(0, 4));
  let n = 0;
  for (let ano = de; ano <= anoAtual; ano++) {
    if ((await reservar("b3Indices", 1)) < 1) break;
    const linhas = await b3Ano(indice, ano).catch(() => null);
    if (linhas?.length) { await gravarIndices(linhas); n += linhas.length; }
  }
  return n;
}

// ---------- FRED: S&P 500 (pontos, em dólar) ----------
async function atualizarSP500() {
  const u = await ultimo("SP500");
  const ini = u ? u.data : INICIO_INDICES;
  if ((await reservar("fred", 1)) < 1) return 0;
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=SP500&cosd=${ini}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return 0;
  const linhas: LinhaIndice[] = [];
  for (const l of (await res.text()).split(/\r?\n/).slice(1)) {
    const [data, v] = l.split(",");
    const n = Number(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(data ?? "") && n > 0) linhas.push({ codigo: "SP500", data, valor: n, atualizado_em: agora() });
  }
  await gravarIndices(linhas);
  return linhas.length;
}

// ---------- Banco Central (SGS): CDI diário (série 12) e IPCA mensal (série 433) ----------
async function sgs(serie: number, ini: string, fim: string): Promise<{ data: string; valor: number }[] | null> {
  if ((await reservar("sgs", 1)) < 1) return null;
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${serie}/dados?formato=json&dataInicial=${dmY(ini)}&dataFinal=${dmY(fim)}`;
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const json = (await res.json()) as { data: string; valor: string }[];
  return Array.isArray(json) ? json.map((x) => ({ data: isoDe(x.data), valor: Number(x.valor) })).filter((x) => isFinite(x.valor)) : null;
}

const somaDias = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const fimDoMes = (iso: string) => { const d = new Date(iso.slice(0, 7) + "-01T12:00:00Z"); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); };

async function atualizarCDI() {
  const u = await ultimo("CDI");
  const ini = u ? somaDias(u.data, 1) : INICIO_INDICES;
  const hoje = dataSP();
  if (ini > hoje) return 0;
  const taxas = await sgs(12, ini, hoje);
  if (!taxas?.length) return 0;
  let nivel = u?.valor ?? 1;
  const linhas: LinhaIndice[] = [];
  if (!u) linhas.push({ codigo: "CDI", data: somaDias(taxas[0].data, -1), valor: 1, atualizado_em: agora() });
  for (const t of taxas) { nivel *= 1 + t.valor / 100; linhas.push({ codigo: "CDI", data: t.data, valor: nivel, atualizado_em: agora() }); }
  await gravarIndices(linhas);
  return linhas.length;
}

async function atualizarIPCA() {
  const u = await ultimo("IPCA");
  // o IPCA de um mês sai no mês seguinte; guarda o nível acumulado no último dia do mês
  const ini = u ? somaDias(u.data, 1) : INICIO_INDICES;
  const hoje = dataSP();
  if (ini > hoje) return 0;
  const taxas = await sgs(433, ini, hoje);
  if (!taxas?.length) return 0;
  let nivel = u?.valor ?? 1;
  const linhas: LinhaIndice[] = [];
  if (!u) linhas.push({ codigo: "IPCA", data: somaDias(taxas[0].data, -1), valor: 1, atualizado_em: agora() });
  for (const t of taxas) { nivel *= 1 + t.valor / 100; linhas.push({ codigo: "IPCA", data: fimDoMes(t.data), valor: nivel, atualizado_em: agora() }); }
  await gravarIndices(linhas);
  return linhas.length;
}

/** Atualiza os seis índices; cada fonte falha sozinha sem derrubar as outras. */
export async function atualizarIndices() {
  const tarefas = {
    IBOV: () => atualizarB3("IBOV"), IDIV: () => atualizarB3("IDIV"), IFIX: () => atualizarB3("IFIX"),
    SP500: atualizarSP500, CDI: atualizarCDI, IPCA: atualizarIPCA,
  };
  const res: Record<string, number | string> = {};
  await Promise.all(Object.entries(tarefas).map(async ([k, f]) => {
    try { res[k] = await f(); } catch (e) { res[k] = e instanceof Error ? e.message.slice(0, 80) : "erro"; }
  }));
  return res;
}

// ---------------------------------------------------------------------
// Histórico de preços dos ativos (para a rentabilidade da carteira)
// ---------------------------------------------------------------------
type Linha = { ticker: string; data: string; fechamento: number; atualizado_em: string };

async function gravarPrecos(linhas: Linha[]) {
  const admin = createAdminClient();
  for (let i = 0; i < linhas.length; i += 1000) {
    await admin.from("cotacoes").upsert(linhas.slice(i, i + 1000), { onConflict: "ticker,data", ignoreDuplicates: true });
  }
}

/** brapi (plano gratuito: até 3 meses de histórico diário). */
async function brapiHistorico(ticker: string): Promise<Linha[]> {
  const res = await fetch(`https://brapi.dev/api/quote/${encodeURIComponent(ticker)}?range=3mo&interval=1d`, {
    headers: { Authorization: `Bearer ${env.brapiToken()}` }, cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { results?: { historicalDataPrice?: { date: number; close: number | null }[] }[] };
  return (json.results?.[0]?.historicalDataPrice ?? [])
    .filter((h) => h.close != null && h.close > 0)
    .map((h) => ({ ticker, data: dataSP(new Date(h.date * 1000)), fechamento: Number(h.close), atualizado_em: agora() }));
}

/** Tiingo (opcional): fechamento diário sem ajuste, desde a data pedida. */
async function tiingoHistorico(ticker: string, desde: string): Promise<Linha[]> {
  const token = env.tiingoToken();
  if (!token) return [];
  const sym = ticker.replace(".", "-").toLowerCase();
  const res = await fetch(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(sym)}/prices?startDate=${desde}`, {
    headers: { Authorization: `Token ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { date: string; close: number }[];
  return Array.isArray(json)
    ? json.filter((h) => h.close > 0).map((h) => ({ ticker: `US:${ticker}`, data: h.date.slice(0, 10), fechamento: Number(h.close), atualizado_em: agora() }))
    : [];
}

/**
 * Busca, uma única vez por ativo, o histórico de preços que falta
 * (B3 pela brapi; EUA pela Tiingo, se configurada) e o dólar do período.
 * `userId` limita aos ativos de um usuário (botão Atualizar).
 */
export async function completarHistorico(userId?: string) {
  const admin = createAdminClient();
  let q = admin.from("ativos").select("id,ticker,classe,moeda");
  if (userId) q = q.eq("user_id", userId);
  const { data: ativos } = await q;
  if (!ativos?.length) return { b3: 0, eua: 0, dolar: 0 };
  const lista = (ativos as Pick<Ativo, "id" | "ticker" | "classe" | "moeda">[]).filter((a) => temCotacaoAuto(a));

  // primeira operação de cada ativo
  const primeira = new Map<string, string>();
  for (let de = 0; ; de += 1000) {
    let qo = admin.from("operacoes").select("ativo_id,data").order("data").range(de, de + 999);
    if (userId) qo = qo.eq("user_id", userId);
    const { data } = await qo;
    for (const o of data ?? []) if (!primeira.has(o.ativo_id as string)) primeira.set(o.ativo_id as string, String(o.data));
    if (!data || data.length < 1000) break;
  }

  // quantos preços já existem por ticker (e desde quando)
  const chaves = [...new Set(lista.map((a) => (a.moeda === "USD" ? `US:${a.ticker}` : a.ticker)))];
  const { data: resumo } = await admin.rpc("historico_precos", { p_chaves: chaves, p_desde: "1900-01-01" });
  const existentes = (resumo ?? {}) as Record<string, [string, number][]>;

  // B3: ativos com menos de 20 pregões guardados
  const brPend = [...new Set(lista.filter((a) => a.moeda === "BRL" && (existentes[a.ticker]?.length ?? 0) < 20).map((a) => a.ticker))];
  const okBr = await reservar("brapi", brPend.length);
  let nb = 0;
  for (let i = 0; i < okBr; i += 4) {
    const res = await Promise.allSettled(brPend.slice(i, Math.min(i + 4, okBr)).map(brapiHistorico));
    const linhas = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    await gravarPrecos(linhas); nb += linhas.length;
  }

  // EUA: só com a Tiingo; busca desde a primeira operação quando o histórico começa depois dela
  let nu = 0;
  if (env.tiingoToken()) {
    const usPend = lista.filter((a) => a.moeda === "USD").map((a) => {
      const desde = primeira.get(a.id);
      const ini = existentes[`US:${a.ticker}`]?.[0]?.[0];
      return desde && (!ini || ini > somaDias(desde, 7)) ? { t: a.ticker, desde } : null;
    }).filter((x): x is { t: string; desde: string } => !!x);
    const unicos = [...new Map(usPend.map((x) => [x.t, x])).values()];
    const okH = await reservar("tiingoHora", unicos.length);
    const okD = okH ? await reservar("tiingoDia", okH) : 0;
    for (let i = 0; i < okD; i += 4) {
      const res = await Promise.allSettled(unicos.slice(i, Math.min(i + 4, okD)).map((x) => tiingoHistorico(x.t, x.desde)));
      const linhas = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
      await gravarPrecos(linhas); nu += linhas.length;
    }
  }

  // Dólar: PTAX diária desde a primeira operação em dólar (ou 3 meses atrás)
  let nd = 0;
  const datasUS = lista.filter((a) => a.moeda === "USD").map((a) => primeira.get(a.id)).filter((d): d is string => !!d).sort();
  if (datasUS.length) {
    const tresMeses = somaDias(dataSP(), -100);
    const desde = env.tiingoToken() ? datasUS[0] : (datasUS[0] > tresMeses ? datasUS[0] : tresMeses);
    const { data: fx } = await admin.from("cotacoes").select("data").eq("ticker", CHAVE_DOLAR).order("data").limit(1);
    const temDesde = fx?.[0]?.data ? String(fx[0].data) : null;
    const { count } = await admin.from("cotacoes").select("data", { count: "exact", head: true }).eq("ticker", CHAVE_DOLAR).gte("data", desde);
    if (!temDesde || temDesde > somaDias(desde, 7) || (count ?? 0) < 40) {
      const lista = await ptaxLista(desde, dataSP());
      if (lista?.length) {
        await gravarPrecos(lista.map(([data, v]) => ({ ticker: CHAVE_DOLAR, data, fechamento: v, atualizado_em: agora() })));
        nd = lista.length;
      }
    }
  }
  return { b3: nb, eua: nu, dolar: nd };
}
