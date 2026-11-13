import { createHash } from "node:crypto";
import type { Classe, Moeda } from "./carteira.ts";

/**
 * Exportação "Posições" da carteira do Investidor10 (CSV com ";").
 * Aceita também as colunas extras do arquivo-base preparado:
 *   "Código B3", "Valor Aplicado", "Observação".
 */

export type PosicaoI10 = {
  origem: string;
  categoria: string;
  ticker: string;
  nome: string | null;
  classe: Classe;
  moeda: Moeda;
  quantidade: number;
  /** preço médio na moeda do ativo (renda fixa: valor aplicado) */
  precoMedio: number;
  /** preço atual por unidade (renda fixa: saldo) */
  precoAtual: number;
  saldo: number;
  observacao: string | null;
  /** classe sem cotação automática: guardar o preço atual como manual */
  precoManual: boolean;
};

export type LeituraI10 = { posicoes: PosicaoI10[]; avisos: string[]; ignoradas: string[] };

const CATEGORIAS: Record<string, { classe: Classe; moeda: Moeda; manual: boolean }> = {
  "acoes": { classe: "acao", moeda: "BRL", manual: false },
  "fiis": { classe: "fii", moeda: "BRL", manual: false },
  "etfs": { classe: "etf", moeda: "BRL", manual: false },
  "bdrs": { classe: "bdr", moeda: "BRL", manual: false },
  "stocks": { classe: "exterior", moeda: "USD", manual: false },
  "reits": { classe: "reit", moeda: "USD", manual: false },
  "etfs intern.": { classe: "etf_exterior", moeda: "USD", manual: false },
  "criptomoedas": { classe: "cripto", moeda: "BRL", manual: true },
  "renda fixa": { classe: "renda_fixa", moeda: "BRL", manual: true },
  "tesouro direto": { classe: "tesouro", moeda: "BRL", manual: true },
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/** "R$ 1.234,56" | "US$ 0,50" | "4,94%" | "0,03483296" → número */
export function numBR(s: string | undefined): number | null {
  const t = (s ?? "").replace(/R\$|US\$|%/g, "").replace(/\s/g, "");
  if (!t || t === "-") return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return isFinite(n) ? n : null;
}

function linhasCsv(texto: string): string[][] {
  const out: string[][] = [];
  for (const linha of texto.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!linha.trim()) continue;
    // campos podem vir entre aspas (contendo ;)
    const campos: string[] = [];
    let atual = "", aspas = false;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (c === '"') { if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas; }
      else if (c === ";" && !aspas) { campos.push(atual); atual = ""; }
      else atual += c;
    }
    campos.push(atual);
    out.push(campos.map((x) => x.trim()));
  }
  return out;
}

export function ehCsvInvestidor10(texto: string) {
  const cab = texto.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  return /Tipo de ativo/i.test(cab) && /Pre[cç]o M[eé]dio/i.test(cab) && /Saldo/i.test(cab);
}

export function lerInvestidor10(texto: string): LeituraI10 {
  const [cab, ...linhas] = linhasCsv(texto);
  if (!cab) return { posicoes: [], avisos: ["Arquivo vazio."], ignoradas: [] };
  const col = (nome: string) => cab.findIndex((c) => norm(c) === norm(nome));
  const iCat = col("Tipo de ativo"), iAt = col("Ativo"), iQ = col("Quant."), iPM = col("Preço Médio"), iPA = col("Preço Atual"),
    iVar = col("Variação"), iSaldo = col("Saldo"), iCod = col("Código B3"), iApl = col("Valor Aplicado"), iObs = col("Observação");
  if (iCat < 0 || iAt < 0 || iSaldo < 0) return { posicoes: [], avisos: ["Colunas do Investidor10 não encontradas."], ignoradas: [] };

  const posicoes: PosicaoI10[] = [];
  const avisos: string[] = [];
  const ignoradas: string[] = [];
  const contRF = new Map<string, number>();

  for (const l of linhas) {
    const categoria = l[iCat] ?? "";
    const info = CATEGORIAS[norm(categoria)];
    const ativo = l[iAt] ?? "";
    if (!info) { if (categoria) ignoradas.push(`${categoria}: ${ativo}`); continue; }
    const saldo = numBR(l[iSaldo]);
    if (!ativo || saldo == null || saldo <= 0) { ignoradas.push(`${categoria}: ${ativo || "(sem nome)"} sem saldo`); continue; }
    const obs = iObs >= 0 ? l[iObs] || null : null;
    const codigo = iCod >= 0 ? (l[iCod] ?? "").toUpperCase() : "";
    const aplicadoCol = iApl >= 0 ? numBR(l[iApl]) : null;
    const variacao = iVar >= 0 ? numBR(l[iVar]) : null;

    if (info.classe === "renda_fixa") {
      // renda fixa: 1 unidade; custo = valor aplicado (coluna) ou saldo ÷ (1 + variação)
      const aplicado = aplicadoCol ?? (variacao != null ? saldo / (1 + variacao / 100) : saldo);
      let ticker = codigo;
      if (!ticker) {
        const base = ativo.replace(/ - Pós-Fixado| - Pré-Fixado| - Prefixado/gi, "").replace(/Banco /gi, "").toUpperCase()
          .replace(/[^A-Z0-9 %.,+\-]/g, "").replace(/\s+/g, " ").trim().slice(0, 32);
        const n = (contRF.get(base) ?? 0) + 1; contRF.set(base, n);
        ticker = `${base} #${n}`.slice(0, 40);
      }
      if (aplicadoCol == null && variacao == null) avisos.push(`${ativo}: sem variação nem valor aplicado; custo = saldo.`);
      posicoes.push({ origem: `i10:${hash("rf|" + ticker)}`, categoria, ticker, nome: ativo.slice(0, 120), classe: "renda_fixa", moeda: "BRL",
        quantidade: 1, precoMedio: Math.round(aplicado * 100) / 100, precoAtual: saldo, saldo, observacao: obs, precoManual: true });
      continue;
    }

    let ticker = (codigo || ativo).toUpperCase().trim();
    if (info.moeda === "USD") ticker = ticker.replace(/-/g, ".");
    let qtd = numBR(l[iQ]);
    const pa = numBR(l[iPA]);
    let pm = numBR(l[iPM]);
    if (qtd == null || qtd <= 0) { ignoradas.push(`${categoria}: ${ativo} sem quantidade`); continue; }
    // quantidade arredondada pelo site (ex.: REITs com 2 casas): recalcula pelo saldo
    if (info.moeda === "USD" && pa && pa > 0 && Math.abs(qtd * pa - saldo) / saldo > 0.001) {
      const nova = Math.round((saldo / pa) * 1e8) / 1e8;
      avisos.push(`${ticker}: quantidade ${qtd} recalculada pelo saldo para ${nova}.`);
      qtd = nova;
    }
    if (pm == null) {
      // Tesouro sem preço médio: usa o valor aplicado (coluna) ou a variação
      const aplicado = aplicadoCol ?? (variacao != null ? saldo / (1 + variacao / 100) : null);
      if (aplicado == null) { avisos.push(`${ticker}: sem preço médio; custo = valor atual.`); }
      pm = (aplicado ?? saldo) / qtd;
    }
    posicoes.push({
      origem: `i10:${hash(info.classe + "|" + ticker)}`, categoria, ticker: ticker.slice(0, 40), nome: null, classe: info.classe, moeda: info.moeda,
      quantidade: qtd, precoMedio: pm, precoAtual: pa ?? saldo / qtd, saldo, observacao: obs, precoManual: info.manual,
    });
  }
  // tickers repetidos (o mesmo ativo em duas linhas)
  const vistos = new Set<string>();
  for (const p of posicoes) {
    if (vistos.has(p.ticker)) avisos.push(`${p.ticker} aparece mais de uma vez; confira antes de importar.`);
    vistos.add(p.ticker);
  }
  return { posicoes, avisos, ignoradas };
}
