import { createHash } from "node:crypto";
import type { Classe, Moeda } from "./carteira.ts";

/**
 * "Relatório Histórico de investimentos" do myProfit (xlsx).
 * As primeiras linhas trazem nome e CPF do titular: são ignoradas — a leitura
 * começa no cabeçalho "Data de negociação".
 */

export type OpMyProfit = {
  origem: string; data: string; ticker: string; grupo: string; classe: Classe; moeda: Moeda;
  tipo: "compra" | "venda"; quantidade: number; preco: number; taxas: number; total: number;
};

const GRUPOS: Record<string, Classe> = {
  "acoes": "acao", "fundo imobiliario": "fii", "fi agro": "fii", "fi infra": "fii", "etf": "etf", "etf renda fixa": "etf",
  "bdr": "bdr", "acoes eua": "exterior", "etf usa": "etf_exterior", "reit": "reit", "criptomoeda": "cripto", "tesouro direto": "tesouro",
};
const RENOMEIA: Record<string, string> = { "BRKB": "BRK.B", "BFB": "BF.B", "SOL.COIN": "SOL", "XRP COIN": "XRP" };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".")));

function dataIso(v: unknown): string | null {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const m = String(v ?? "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}
export const tickerMyProfit = (t: string) => {
  const u = t.toUpperCase().trim();
  return RENOMEIA[u] ?? u.replace(/^([A-Z0-9]{4}\d{1,2})F$/, "$1");
};

/** Recebe as linhas da planilha (cada linha = array de células). */
export function lerMyProfit(linhas: unknown[][]): { ops: OpMyProfit[]; ignoradas: string[] } {
  const iCab = linhas.findIndex((l) => l.some((c) => norm(String(c ?? "")) === "data de negociacao") && l.some((c) => norm(String(c ?? "")) === "ativo"));
  if (iCab < 0) return { ops: [], ignoradas: ["Cabeçalho do myProfit não encontrado."] };
  const cab = linhas[iCab].map((c) => norm(String(c ?? "")));
  const col = (n: string) => cab.indexOf(norm(n));
  const c = {
    data: col("Data de negociação"), moeda: col("Moeda"), taxas: col("Total de Taxas"), ativo: col("Ativo"), grupo: col("Grupo"),
    qtd: col("Quantidade"), tipo: col("Tipo"), preco: col("Preço sem taxas"), total: col("Total com taxas"),
  };
  const ops: OpMyProfit[] = [];
  const ignoradas: string[] = [];
  const vistos = new Map<string, number>();
  for (const l of linhas.slice(iCab + 1)) {
    const tipo = norm(String(l[c.tipo] ?? ""));
    const data = dataIso(l[c.data]);
    const ticker = tickerMyProfit(String(l[c.ativo] ?? ""));
    const grupo = String(l[c.grupo] ?? "");
    const classe = GRUPOS[norm(grupo)];
    const q = Math.abs(num(l[c.qtd]));
    if (!data || !ticker || !(q > 0) || (tipo !== "compra" && tipo !== "venda")) { if (l.some((x) => x != null && x !== "")) ignoradas.push(`Linha sem dados válidos: ${ticker || "?"}`); continue; }
    if (!classe) { ignoradas.push(`${ticker}: grupo "${grupo}" não reconhecido`); continue; }
    const moeda: Moeda = String(l[c.moeda] ?? "BRL").toUpperCase() === "USD" ? "USD" : "BRL";
    const chave = JSON.stringify([data, ticker, tipo, q, num(l[c.preco]), num(l[c.total])]);
    const n = (vistos.get(chave) ?? 0) + 1; vistos.set(chave, n);
    ops.push({
      origem: `mp:${hash(chave + "#" + n)}`, data, ticker, grupo, classe, moeda, tipo: tipo as "compra" | "venda",
      quantidade: q, preco: Math.abs(num(l[c.preco])) || 0, taxas: Math.abs(num(l[c.taxas])) || 0, total: Math.abs(num(l[c.total])) || 0,
    });
  }
  return { ops, ignoradas };
}
