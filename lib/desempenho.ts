/**
 * Rentabilidade da carteira (ou de um segmento) ao longo do tempo, pelo
 * método da cota (retorno ponderado pelo tempo): aportes e resgates não
 * contam como ganho, e proventos recebidos contam como retorno — o mesmo
 * critério dos índices de retorno total (IBOV, IDIV, IFIX).
 *
 * Retorno do dia d = (posição carregada de d−1 avaliada no preço de d + proventos de d)
 *                    ÷ (valor em d−1) − 1
 * Compras e vendas entram pelo preço de fechamento do dia, então não geram
 * ganho nem perda artificial (mesmo quando o preço do dia é estimado).
 */
import { temCotacaoAuto, chaveCotacao, type Ativo, type Operacao, type Provento } from "./carteira.ts";

export type Serie = [string, number][]; // [AAAA-MM-DD, valor], em ordem
export type PontoDesempenho = { data: string; cota: number; valor: number };

const EPS = 1e-9;

/** Dias úteis (seg–sex) de `ini` até `fim`, inclusive. */
export function diasUteis(ini: string, fim: string): string[] {
  const out: string[] = [];
  const d = new Date(ini + "T12:00:00Z");
  const f = new Date(fim + "T12:00:00Z");
  while (d <= f) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Último valor da série com data ≤ d (busca binária); sem nenhum, null. */
export function valorEm(s: Serie | undefined, d: string): number | null {
  if (!s?.length || s[0][0] > d) return null;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m][0] <= d) lo = m; else hi = m - 1; }
  return s[lo][1];
}

const diasEntre = (a: string, b: string) => (Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5;

type Entrada = {
  ativos: Ativo[];
  ops: Operacao[];
  proventos: Provento[];
  /** Fechamentos por chave de cotação (PETR4, US:SCHD). */
  precos: Record<string, Serie>;
  /** Dólar (PTAX) por dia. */
  dolar: Serie;
  /** Câmbio de reserva quando não há PTAX no período. */
  dolarAtual: number;
  hoje: string;
  /** Fração mínima do valor com preço real para a série começar. */
  coberturaMinima?: number;
};

export type Desempenho = {
  pontos: PontoDesempenho[];
  /** Ativos com cotação automática ainda sem histórico de preços. */
  semHistorico: string[];
};

export function calcularDesempenho(e: Entrada): Desempenho {
  const minCob = e.coberturaMinima ?? 0.95;
  const ids = new Set(e.ativos.map((a) => a.id));
  const ordem = { compra: 0, bonificacao: 1, desdobramento: 2, grupamento: 3, venda: 4 } as const;
  const ops = e.ops.filter((o) => ids.has(o.ativo_id) && o.data <= e.hoje)
    .sort((a, b) => a.data.localeCompare(b.data) || ordem[a.tipo] - ordem[b.tipo] || (a.criado_em ?? "").localeCompare(b.criado_em ?? ""));
  if (!ops.length) return { pontos: [], semHistorico: [] };

  // ---- preço unitário (na moeda do ativo) de cada ativo em cada dia ----
  type Info = { a: Ativo; auto: boolean; serie?: Serie; primeiro?: string; p0: number; d0: string; p1: number | null; d1: string | null };
  const info = new Map<string, Info>();
  for (const a of e.ativos) {
    const proprias = ops.filter((o) => o.ativo_id === a.id);
    if (!proprias.length) continue;
    const auto = temCotacaoAuto(a);
    const serie = auto ? e.precos[chaveCotacao(a)] : undefined;
    const primCompra = proprias.find((o) => o.tipo === "compra" && Number(o.preco) > 0);
    const p0 = primCompra ? Number(primCompra.preco) : 0;
    const d0 = primCompra?.data ?? proprias[0].data;
    const p1 = a.preco_manual != null ? Number(a.preco_manual) : null;
    const d1 = a.preco_manual_em ? a.preco_manual_em.slice(0, 10) : null;
    info.set(a.id, { a, auto, serie: serie?.length ? serie : undefined, primeiro: serie?.[0]?.[0], p0, d0, p1, d1 });
  }
  const ultimoNegocio = new Map<string, number>();
  const preco = (i: Info, d: string): { p: number; real: boolean } => {
    if (i.auto) {
      const v = valorEm(i.serie, d);
      if (v != null) return { p: v, real: true };
      if (i.serie) return { p: i.serie[0][1], real: false }; // antes do histórico: preço constante
      return { p: ultimoNegocio.get(i.a.id) ?? i.p0, real: false };
    }
    // sem cotação automática (renda fixa, Tesouro, cripto, outros): evolução
    // geométrica entre o preço da aplicação e o último preço informado
    if (i.p1 == null || !i.d1 || i.p0 <= 0) return { p: i.p1 ?? (ultimoNegocio.get(i.a.id) ?? i.p0), real: true };
    if (i.d1 <= i.d0 || d >= i.d1) return { p: i.p1, real: true };
    if (d <= i.d0) return { p: i.p0, real: true };
    return { p: i.p0 * Math.pow(i.p1 / i.p0, diasEntre(i.d0, d) / diasEntre(i.d0, i.d1)), real: true };
  };
  const fxEm = (d: string) => valorEm(e.dolar, d) ?? e.dolar[0]?.[1] ?? e.dolarAtual;
  const fxDe = (a: Ativo, d: string) => (a.moeda === "USD" ? fxEm(d) : 1);

  // ---- início: primeiro dia com histórico de preço para quase toda a carteira ----
  const inicios = [...info.values()].filter((i) => i.auto && i.primeiro).map((i) => i.primeiro!);
  const lower = inicios.length ? inicios.sort()[0] : ops[0].data;
  const dias = diasUteis(lower < ops[0].data ? ops[0].data : lower, e.hoje);

  const provPorDia = new Map<string, { id: string; v: number }[]>();
  for (const p of e.proventos) {
    if (!ids.has(p.ativo_id)) continue;
    const l = provPorDia.get(p.data_pagamento) ?? []; l.push({ id: p.ativo_id, v: Number(p.valor_total) }); provPorDia.set(p.data_pagamento, l);
  }

  const qtd = new Map<string, number>();
  let k = 0;
  const aplicar = (o: Operacao) => {
    const q = Number(o.quantidade), atual = qtd.get(o.ativo_id) ?? 0;
    switch (o.tipo) {
      case "compra": qtd.set(o.ativo_id, atual + q); if (Number(o.preco) > 0) ultimoNegocio.set(o.ativo_id, Number(o.preco)); break;
      case "venda": qtd.set(o.ativo_id, Math.max(0, atual - q)); if (Number(o.preco) > 0) ultimoNegocio.set(o.ativo_id, Number(o.preco)); break;
      case "desdobramento": qtd.set(o.ativo_id, atual * q); break;
      case "grupamento": qtd.set(o.ativo_id, q ? atual / q : atual); break;
      case "bonificacao": qtd.set(o.ativo_id, atual + q); break;
    }
  };
  // operações anteriores ao primeiro dia do calendário
  while (k < ops.length && ops[k].data < (dias[0] ?? e.hoje)) aplicar(ops[k++]);

  const avaliar = (d: string) => {
    let total = 0, comReal = 0;
    for (const [id, q] of qtd) {
      if (q <= EPS) continue;
      const i = info.get(id); if (!i) continue;
      const { p, real } = preco(i, d);
      const v = q * p * fxDe(i.a, d);
      total += v; if (real) comReal += v;
    }
    return { total, cobertura: total > 0 ? comReal / total : 1 };
  };

  const pontos: PontoDesempenho[] = [];
  let cota = 1, anterior = 0, comecou = false;
  for (const d of dias) {
    // 1) eventos sem dinheiro (desdobramento, grupamento, bonificação) mudam a posição carregada
    const doDia: Operacao[] = [];
    while (k < ops.length && ops[k].data === d) doDia.push(ops[k++]);
    for (const o of doDia) if (o.tipo !== "compra" && o.tipo !== "venda") aplicar(o);
    // 2) retorno da posição carregada
    if (comecou && anterior > EPS) {
      let num = avaliar(d).total;
      for (const p of provPorDia.get(d) ?? []) { const i = info.get(p.id); if (i) num += p.v * fxDe(i.a, d); }
      cota *= num / anterior;
    }
    // 3) compras e vendas do dia, avaliadas no fechamento
    for (const o of doDia) if (o.tipo === "compra" || o.tipo === "venda") aplicar(o);
    const { total, cobertura } = avaliar(d);
    if (!comecou && total > EPS && cobertura >= minCob) comecou = true;
    if (comecou) pontos.push({ data: d, cota, valor: total });
    anterior = total;
  }

  const semHistorico = [...info.values()]
    .filter((i) => i.auto && !i.serie && (qtd.get(i.a.id) ?? 0) > EPS)
    .map((i) => i.a.ticker);
  return { pontos, semHistorico };
}

/** Variação acumulada de uma série de índice entre duas datas (com interpolação mensal opcional). */
export function nivelEm(s: Serie | undefined, d: string, interpolar = false): number | null {
  if (!s?.length) return null;
  if (!interpolar) return valorEm(s, d);
  if (d <= s[0][0]) return s[0][1];
  if (d >= s[s.length - 1][0]) return s[s.length - 1][1];
  let lo = 0, hi = s.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m][0] <= d) lo = m; else hi = m; }
  const [da, va] = s[lo], [db, vb] = s[hi];
  return va * Math.pow(vb / va, diasEntre(da, d) / diasEntre(da, db));
}
