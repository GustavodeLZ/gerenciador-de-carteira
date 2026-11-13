import { createHash } from "node:crypto";

/**
 * Extrato mensal da conta internacional (Inter Co Securities / DriveWealth):
 * posições no fim do mês (quantidade e custo total) e dividendos com o imposto retido.
 */

export type PosicaoExtrato = { ticker: string; quantidade: number; custoTotal: number; precoMercado: number };
export type DividendoExtrato = { origem: string; ticker: string; data: string; bruto: number; imposto: number; liquido: number };
export type ExtratoInter = { inicio: string; fim: string; posicoes: PosicaoExtrato[]; dividendos: DividendoExtrato[] };

const MESES: Record<string, string> = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const val = (s: string) => { const neg = /^\(.*\)$/.test(s.trim()); const n = Number(s.replace(/[(),$]/g, "")); return neg ? -n : n; };
const iso = (mdy: string) => { const [m, d, y] = mdy.split("/"); return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`; };

export function ehExtratoInter(linhas: string[]) {
  const t = linhas.join("\n");
  return /DriveWealth/i.test(t) && /Account Statement/i.test(t) && /HOLDINGS/.test(t);
}

export function lerExtratoInter(linhas: string[]): ExtratoInter {
  let inicio = "", fim = "";
  for (const l of linhas) {
    const m = l.match(/([A-Za-z]+) (\d{1,2}), (\d{4}) - ([A-Za-z]+) (\d{1,2}), (\d{4})/);
    if (m && MESES[m[1].toLowerCase()] && MESES[m[4].toLowerCase()]) {
      inicio = `${m[3]}-${MESES[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}`;
      fim = `${m[6]}-${MESES[m[4].toLowerCase()]}-${m[5].padStart(2, "0")}`;
      break;
    }
  }

  // Posições: "... SYMBOL  qtd  unit  total  preço  valor  ganho  M"
  const posicoes: PosicaoExtrato[] = [];
  let emHoldings = false;
  for (const l of linhas) {
    if (/^HOLDINGS/.test(l)) { emHoldings = true; continue; }
    if (/^ACTIVITY|^SWEEP ACTIVITY/.test(l)) emHoldings = false;
    if (!emHoldings) continue;
    const p = l.split(/\s{2,}/);
    if (p.length < 9 || !/^[A-Z]{1,2}$/.test(p[p.length - 1])) continue;
    const [sym, q, , total, preco] = p.slice(-8, -3);
    if (!/^[A-Z][A-Z.]{0,6}$/.test(sym) || sym === "DWBDS") continue;
    const quantidade = Number(q), custoTotal = val(total), precoMercado = val(preco);
    if (isFinite(quantidade) && quantidade > 0) posicoes.push({ ticker: sym, quantidade, custoTotal: isFinite(custoTotal) ? custoTotal : 0, precoMercado });
  }

  // Dividendos: DIV (bruto) + DIVNRA/DIVFT (imposto retido) no mesmo dia e ativo
  const brutos = new Map<string, { ticker: string; data: string; bruto: number; imposto: number }>();
  for (const l of linhas) {
    const m = l.match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s{2,}\d{1,2}\/\d{1,2}\/\d{4}\s{2,}USD\s{2,}(DIV|DIVNRA|DIVFT|DIVTW)\s{2,}([A-Z][A-Z.]{0,6}) - .*\s{2,}(\(?[\d,.]+\)?)$/);
    if (!m) continue;
    const data = iso(m[1]), k = `${m[3]}|${data}`;
    const r = brutos.get(k) ?? { ticker: m[3], data, bruto: 0, imposto: 0 };
    if (m[2] === "DIV") r.bruto += val(m[4]); else r.imposto += Math.abs(val(m[4]));
    brutos.set(k, r);
  }
  const dividendos = [...brutos.values()].filter((d) => d.bruto > 0).map((d) => ({
    ...d, bruto: Math.round(d.bruto * 100) / 100, imposto: Math.round(d.imposto * 100) / 100,
    liquido: Math.round((d.bruto - d.imposto) * 100) / 100, origem: `ie:${hash([d.ticker, d.data, d.bruto].join("|"))}`,
  }));
  return { inicio, fim, posicoes, dividendos };
}
