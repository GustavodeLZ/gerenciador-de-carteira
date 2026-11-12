import { createHash } from "node:crypto";
import type { NotaLida, OperacaoNota } from "./tipos.ts";

/**
 * "Transaction Confirmation" da DriveWealth — usada pela conta internacional
 * do Inter (Inter Co Securities) e por outras corretoras que operam nos EUA.
 */
export function ehDriveWealth(linhas: string[]) {
  const t = linhas.join("\n");
  return /DriveWealth/i.test(t) && /Transaction|Confirmation/i.test(t) && /Symbol\s+Security/i.test(t);
}

const LINHA_NEGOCIO =
  /^(?<symbol>[A-Z][A-Z0-9.\-]{0,9})\s{2,}(?<security>.+?)\s{2,}(?<ac>[A-Z0-9]{1,2})\s{2,}(?<action>Buy|Sell|BUY|SELL|Sell Short|Buy to Cover)\s{2,}(?<time>\d{1,2}:\d{2}:\d{2}\s?[AP]M)\s{2,}(?<qty>[\d,]*\.?\d+)\s{2,}(?<price>[\d,]*\.?\d+)\s{2,}(?<trade>\d{1,2}\/\d{1,2}\/\d{4})\s{2,}(?<settle>\d{1,2}\/\d{1,2}\/\d{4})/;

function dinheiro(s: string): number | null {
  const m = s.match(/(\(|-)?\s*\$?\s*([\d,]+\.\d{2})\)?/);
  if (!m) return null;
  const v = Number(m[2].replace(/,/g, ""));
  return m[1] ? -v : v;
}

const iso = (mdy: string) => {
  const [m, d, y] = mdy.split("/").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

export function lerDriveWealth(linhas: string[]): NotaLida {
  const operacoes: OperacaoNota[] = [];
  const avisos: string[] = [];

  for (let i = 0; i < linhas.length; i++) {
    const m = linhas[i].match(LINHA_NEGOCIO);
    if (!m?.groups) continue;
    const g = m.groups;
    const venda = /sell/i.test(g.action);
    const qtd = Number(g.qty.replace(/,/g, ""));
    const preco = Number(g.price.replace(/,/g, ""));

    // Bloco de valores logo abaixo da linha do negócio
    const valores: Record<string, number> = {};
    for (let j = i + 1; j < Math.min(i + 12, linhas.length); j++) {
      if (LINHA_NEGOCIO.test(linhas[j])) break;
      const l = linhas[j];
      const pega = (rotulo: string, chave: string) => {
        if (new RegExp(`^${rotulo}`, "i").test(l)) { const v = dinheiro(l.slice(rotulo.length)); if (v != null) valores[chave] = v; }
      };
      pega("Principal Amount", "principal");
      pega("Commission", "comissao");
      pega("Transaction Fee", "taxa");
      pega("Other Fees / Credits", "outras");
      pega("Net Amount", "liquido");
      if (/^Net Amount/i.test(l)) break;
    }

    const principal = valores.principal ?? Math.round(qtd * preco * 100) / 100;
    const liquido = valores.liquido ?? principal;
    let taxas = venda ? principal - liquido : liquido - principal;
    if (taxas < 0) {
      avisos.push(`${g.symbol}: a nota tem um crédito de ${Math.abs(taxas).toFixed(2)} (arredondamento); registrado como taxa zero.`);
      taxas = 0;
    }
    if (Math.abs(qtd * preco - principal) > 0.05) {
      avisos.push(`${g.symbol}: quantidade × preço (${(qtd * preco).toFixed(2)}) difere do valor da nota (${principal.toFixed(2)}). Confira.`);
    }

    const chave = ["dw", g.symbol, g.trade, g.time, g.qty, g.price, g.action].join("|");
    operacoes.push({
      origem: "dw:" + createHash("sha256").update(chave).digest("hex").slice(0, 32),
      ticker: g.symbol.toUpperCase(),
      nome: g.security.replace(/\s{2,}/g, " ").trim(),
      tipo: venda ? "venda" : "compra",
      data: iso(g.trade),
      quantidade: qtd,
      preco,
      taxas: Math.round(taxas * 100) / 100,
      liquido,
    });
  }

  return { formato: "drivewealth", corretora: "Inter (EUA) · DriveWealth", moeda: "USD", operacoes, avisos };
}
