// Cálculos puros da carteira — sem acesso a banco, fáceis de testar.

export type Classe =
  | "acao" | "fii" | "etf" | "bdr" | "renda_fixa" | "tesouro" | "cripto" | "exterior" | "reit" | "etf_exterior" | "outros";

export const CLASSES: { id: Classe; nome: string; cor: string; cotacaoAuto: boolean }[] = [
  { id: "acao", nome: "Ações", cor: "var(--c1)", cotacaoAuto: true },
  { id: "fii", nome: "FIIs", cor: "var(--c2)", cotacaoAuto: true },
  { id: "etf", nome: "ETFs", cor: "var(--c3)", cotacaoAuto: true },
  { id: "bdr", nome: "BDRs", cor: "var(--c4)", cotacaoAuto: true },
  { id: "renda_fixa", nome: "Renda Fixa", cor: "var(--c5)", cotacaoAuto: false },
  { id: "tesouro", nome: "Tesouro Direto", cor: "var(--c6)", cotacaoAuto: false },
  { id: "cripto", nome: "Cripto", cor: "var(--c7)", cotacaoAuto: false },
  { id: "exterior", nome: "Stocks (EUA)", cor: "var(--c8)", cotacaoAuto: false },
  { id: "reit", nome: "REITs", cor: "var(--c8)", cotacaoAuto: false },
  { id: "etf_exterior", nome: "ETFs internacionais", cor: "var(--c3)", cotacaoAuto: false },
  { id: "outros", nome: "Outros", cor: "var(--c9)", cotacaoAuto: false },
];
export const classeInfo = (id: string) => CLASSES.find((c) => c.id === id) ?? CLASSES[CLASSES.length - 1];

export type Moeda = "BRL" | "USD";
export type Ativo = {
  id: string; ticker: string; nome: string | null; classe: Classe; moeda: Moeda;
  preco_manual: number | null; preco_manual_em: string | null;
};

/** Ativos com cotação automática: bolsa brasileira (brapi) ou americana (Finnhub). */
export function temCotacaoAuto(a: Pick<Ativo, "classe" | "moeda">) {
  return a.moeda === "USD" ? ["acao", "etf", "exterior", "reit", "etf_exterior"].includes(a.classe) : classeInfo(a.classe).cotacaoAuto;
}
/** Chave do ativo na tabela de cotações. */
export const chaveCotacao = (a: Pick<Ativo, "ticker" | "moeda">) => (a.moeda === "USD" ? `US:${a.ticker}` : a.ticker);
export const CHAVE_DOLAR = "FX:USDBRL";
export type TipoOperacao = "compra" | "venda" | "desdobramento" | "grupamento" | "bonificacao";
export type Operacao = {
  id: string; ativo_id: string; tipo: TipoOperacao; data: string;
  quantidade: number; preco: number; taxas: number; cambio?: number | null; criado_em?: string;
};
export type Provento = { id: string; ativo_id: string; tipo: string; data_pagamento: string; valor_total: number };
export type Segmento = { id: string; nome: string; descricao: string | null; meta_pct: number | null };
export type SegmentoAtivo = { segmento_id: string; ativo_id: string; meta_pct: number | null };
export type Cotacao = { ticker: string; data: string; fechamento: number };

export type Posicao = {
  ativo: Ativo;
  quantidade: number;
  /** na moeda do ativo */
  precoMedio: number;
  /** custo em R$ (convertido pelo câmbio de cada operação) */
  custo: number;
  /** custo na moeda do ativo */
  custoMoeda: number;
  /** preço atual na moeda do ativo */
  preco: number;
  /** câmbio atual usado (1 para R$) */
  fx: number;
  /** valor na moeda do ativo */
  valorMoeda: number;
  /** rentabilidade sem o efeito do câmbio */
  rentabilidadeMoeda: number | null;
  precoFonte: "cotacao" | "manual" | "preco_medio";
  precoData: string | null;
  /** valor em R$ */
  valor: number;
  /** resultado em R$, inclui variação cambial */
  resultado: number;
  rentabilidade: number | null;
  /** lucro realizado em vendas, na moeda do ativo */
  lucroRealizado: number;
  proventos: number;
  proventos12m: number;
};

const EPS = 1e-9;

/**
 * Aplica as operações em ordem e devolve quantidade, custo e lucro realizado.
 * `custo` fica na moeda do ativo; `custoBRL` converte cada compra pelo câmbio
 * da própria operação (ou `fxPadrao` quando a operação não tem câmbio).
 */
export function aplicarOperacoes(ops: Operacao[], fxPadrao = 1) {
  // No mesmo dia, entradas (compra, bonificação, desdobramento) antes das saídas,
  // para uma venda não ser descartada por vir antes da compra do mesmo pregão.
  const ordem: Record<TipoOperacao, number> = { compra: 0, bonificacao: 1, desdobramento: 2, grupamento: 3, venda: 4 };
  const ordenadas = [...ops].sort(
    (a, b) => a.data.localeCompare(b.data) || ordem[a.tipo] - ordem[b.tipo] || (a.criado_em ?? "").localeCompare(b.criado_em ?? ""),
  );
  let qtd = 0, custo = 0, custoBRL = 0, realizado = 0;
  for (const op of ordenadas) {
    const q = Number(op.quantidade), p = Number(op.preco), t = Number(op.taxas || 0);
    const fx = op.cambio != null && Number(op.cambio) > 0 ? Number(op.cambio) : fxPadrao;
    switch (op.tipo) {
      case "compra":
        qtd += q; custo += q * p + t; custoBRL += (q * p + t) * fx; break;
      case "venda": {
        if (qtd <= EPS) break;
        const vendida = Math.min(q, qtd);
        const pm = custo / qtd, pmBRL = custoBRL / qtd;
        realizado += vendida * p - t - vendida * pm;
        custo -= vendida * pm; custoBRL -= vendida * pmBRL; qtd -= vendida;
        if (qtd <= EPS) { qtd = 0; custo = 0; custoBRL = 0; }
        break;
      }
      case "desdobramento": qtd *= q; break;
      case "grupamento": qtd /= q; break;
      case "bonificacao": qtd += q; custo += q * p; custoBRL += q * p * fx; break;
    }
  }
  return { quantidade: qtd, custo, custoBRL, precoMedio: qtd > EPS ? custo / qtd : 0, lucroRealizado: realizado };
}

/** Dólar atual: PTAX das cotações; sem ela, o câmbio da operação mais recente. */
export function dolarAtual(cotacoes: Cotacao[], ops: Operacao[]): number | null {
  const ptax = cotacoes.find((c) => c.ticker === CHAVE_DOLAR);
  if (ptax) return Number(ptax.fechamento);
  const comCambio = ops.filter((o) => o.cambio != null).sort((a, b) => b.data.localeCompare(a.data));
  return comCambio.length ? Number(comCambio[0].cambio) : null;
}

export function calcularPosicoes(
  ativos: Ativo[], ops: Operacao[], cotacoes: Cotacao[], proventos: Provento[], hoje = new Date(),
): Posicao[] {
  const cot = new Map(cotacoes.map((c) => [c.ticker, c]));
  const usd = dolarAtual(cotacoes, ops) ?? 1;
  const limite12m = new Date(hoje); limite12m.setFullYear(limite12m.getFullYear() - 1);
  const lim = limite12m.toISOString().slice(0, 10);

  return ativos.map((ativo) => {
    const fx = ativo.moeda === "USD" ? usd : 1;
    const r = aplicarOperacoes(ops.filter((o) => o.ativo_id === ativo.id), fx);
    const c = temCotacaoAuto(ativo) ? cot.get(chaveCotacao(ativo)) : undefined;
    let preco = r.precoMedio, precoFonte: Posicao["precoFonte"] = "preco_medio", precoData: string | null = null;
    if (c) { preco = Number(c.fechamento); precoFonte = "cotacao"; precoData = c.data; }
    else if (ativo.preco_manual != null) { preco = Number(ativo.preco_manual); precoFonte = "manual"; precoData = ativo.preco_manual_em; }
    const valorMoeda = r.quantidade * preco;
    const valor = valorMoeda * fx;
    const provs = proventos.filter((p) => p.ativo_id === ativo.id);
    return {
      ativo, quantidade: r.quantidade, precoMedio: r.precoMedio, custo: r.custoBRL, custoMoeda: r.custo,
      lucroRealizado: r.lucroRealizado, preco, fx, precoFonte, precoData, valorMoeda, valor,
      resultado: valor - r.custoBRL,
      rentabilidade: r.custoBRL > EPS ? valor / r.custoBRL - 1 : null,
      rentabilidadeMoeda: r.custo > EPS ? valorMoeda / r.custo - 1 : null,
      proventos: provs.reduce((s, p) => s + Number(p.valor_total), 0) * fx,
      proventos12m: provs.filter((p) => p.data_pagamento >= lim).reduce((s, p) => s + Number(p.valor_total), 0) * fx,
    };
  });
}

export type ResumoSegmento = {
  segmento: Segmento;
  itens: { posicao: Posicao; pctSegmento: number; pctCarteira: number; meta: number | null; aportar: number | null }[];
  valor: number;
  pctCarteira: number;
  proventos12m: number;
  somaMetas: number;
};

export function resumirSegmentos(
  segmentos: Segmento[], vinculos: SegmentoAtivo[], posicoes: Posicao[], total: number,
): ResumoSegmento[] {
  const porAtivo = new Map(posicoes.map((p) => [p.ativo.id, p]));
  return segmentos.map((segmento) => {
    const vs = vinculos.filter((v) => v.segmento_id === segmento.id);
    const pos = vs.map((v) => ({ v, p: porAtivo.get(v.ativo_id) })).filter((x): x is { v: SegmentoAtivo; p: Posicao } => !!x.p);
    const valor = pos.reduce((s, x) => s + x.p.valor, 0);
    const itens = pos
      .map(({ v, p }) => {
        const meta = v.meta_pct == null ? null : Number(v.meta_pct);
        return {
          posicao: p,
          pctSegmento: valor ? p.valor / valor : 0,
          pctCarteira: total ? p.valor / total : 0,
          meta,
          aportar: meta == null ? null : Math.max(0, (meta / 100) * valor - p.valor),
        };
      })
      .sort((a, b) => b.posicao.valor - a.posicao.valor);
    return {
      segmento, itens, valor,
      pctCarteira: total ? valor / total : 0,
      proventos12m: pos.reduce((s, x) => s + x.p.proventos12m, 0),
      somaMetas: itens.reduce((s, i) => s + (i.meta ?? 0), 0),
    };
  });
}

// ---------- formatação ----------
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const qtdF = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 });
const usdF = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
const usdP = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const R = (v: number) => brl.format(v || 0);
/** Valor na moeda indicada (R$ ou US$). */
export const M = (v: number, moeda: Moeda | string = "BRL") => (moeda === "USD" ? usdF.format(v || 0) : brl.format(v || 0));
/** Preço unitário (até 4 casas em dólar). */
export const MP = (v: number, moeda: Moeda | string = "BRL") => (moeda === "USD" ? usdP.format(v || 0) : brl.format(v || 0));
export const P = (v: number | null | undefined) => (v == null || !isFinite(v) ? "–" : pct.format(v));
export const Q = (v: number) => qtdF.format(v);
export const dataBR = (iso: string | null) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("pt-BR") : "–");

/** Aceita "1.234,56", "1234.56", "R$ 10". */
export function parseNum(s: unknown): number {
  if (typeof s === "number") return s;
  let t = String(s ?? "").trim().replace(/[R$\s]/g, "");
  if (!t) return NaN;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  return Number(t);
}

// ---------- nomes para exibir ----------
const TITULOS = new Set(["renda_fixa", "tesouro"]);
const tituloCaso = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)\S/g, (m) => m.toUpperCase()) : s);
const taxaCurta = (t: string) => t.replace(/(\d+)\.(\d+)\s*%/, (_, a: string, b: string) => (/^0+$/.test(b) ? a : `${a},${b.replace(/0+$/, "")}`) + "%");

/** "CDB - Banco Daycoval - Pós-Fixado - 110.00% CDI" → "CDB Daycoval 110% CDI". */
export function nomeCurto(nome: string) {
  const [cab, ...resto] = nome.split(" · ").map((s) => s.trim());
  if (/^tesouro/i.test(cab)) return tituloCaso(cab).replace(/^Tesouro Ipca\+/, "Tesouro IPCA+").replace(/^Tesouro Selic/, "Tesouro Selic");
  const p = cab.split(/\s+-\s+/);
  if (p.length < 2) return nome;
  const tipo = p[0].toUpperCase();
  const emissor = tituloCaso(p[1].replace(/\b(banco|bco)\b/gi, "").replace(/\bs\.?\/?a\.?$/i, "").replace(/\s+/g, " ").trim());
  const taxa = p.slice(2).find((x) => /%|ipca|pré|pre/i.test(x));
  const indexador = !taxa ? resto.find((r) => !/venc/i.test(r)) : undefined;
  const venc = resto.find((r) => /venc/i.test(r))?.replace(/venc\.?\s*\d{2}\/(\d{2}\/\d{4})/i, "venc. $1");
  return [tipo, emissor, taxa ? taxaCurta(taxa) : indexador === "DI" ? "CDI" : indexador, venc ? `· ${venc}` : ""].filter(Boolean).join(" ");
}

/** Nome principal: títulos de renda fixa e Tesouro pelo nome; o resto pelo ticker. */
export function rotulo(a: { ticker: string; nome?: string | null; classe: string }) {
  return TITULOS.has(a.classe) && a.nome ? nomeCurto(a.nome) : a.ticker;
}
/** Linha secundária: para títulos, o código da B3 (ou o nº do título sem código); para o resto, o nome. */
export function subRotulo(a: { ticker: string; nome?: string | null; classe: string }) {
  if (!TITULOS.has(a.classe) || !a.nome) return a.nome ?? "";
  if (!/\s/.test(a.ticker)) return a.ticker;
  return a.ticker.match(/#\d+$/)?.[0] ?? "";
}
