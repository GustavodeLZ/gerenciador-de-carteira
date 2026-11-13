import { createHash } from "node:crypto";
import { aplicarOperacoes, type Classe, type Operacao } from "./carteira.ts";
import type { OpMyProfit } from "./myprofit.ts";
import type { OperacaoNota } from "./notas/tipos.ts";
import type { ExtratoInter } from "./notas/extrato-inter.ts";

/**
 * Carteira dos EUA: histórico do myProfit + confirmações da DriveWealth,
 * conferido contra o extrato mensal do Inter (quantidade e custo total por ativo).
 */

export type OpEUA = { origem: string; data: string; tipo: "compra" | "venda"; quantidade: number; preco: number; taxas: number; nota: string };
export type AtivoEUA = {
  ticker: string; nome: string | null; classe: Classe;
  ops: OpEUA[];
  proventos: { origem: string; data: string; valor: number; bruto: number; imposto: number }[];
  qtdCalculada: number; qtdExtrato: number | null; custoCalculado: number; custoExtrato: number | null; precoMercado: number | null;
  ajuste: (OpEUA & { motivo: string }) | null;
  precisaPm: boolean;
};
export type PlanoEUA = { dataExtrato: string | null; ativos: AtivoEUA[]; avisos: string[]; confirmacoesRepetidas: number };

const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const r8 = (n: number) => Math.round(n * 1e8) / 1e8;

export function montarPlanoEUA(entrada: {
  myprofit: OpMyProfit[];
  confirmacoes: OperacaoNota[];
  extrato: ExtratoInter | null;
  /** preço médio informado pelo app do Inter, para ativos transferidos (custo 0 no extrato) */
  pmInter?: Record<string, number>;
  nomes?: Record<string, string>;
}): PlanoEUA {
  const avisos: string[] = [];
  const mp = entrada.myprofit.filter((o) => o.moeda === "USD");
  const ops = new Map<string, OpEUA[]>();
  const classe = new Map<string, Classe>();
  const add = (t: string, o: OpEUA) => { if (!ops.has(t)) ops.set(t, []); ops.get(t)!.push(o); };

  for (const o of mp) {
    add(o.ticker, { origem: o.origem, data: o.data, tipo: o.tipo, quantidade: o.quantidade, preco: o.preco, taxas: o.taxas, nota: "myProfit" });
    classe.set(o.ticker, o.classe);
  }
  // Confirmações: só entram se o myProfit ainda não tiver a mesma operação
  let repetidas = 0;
  for (const c of entrada.confirmacoes) {
    const ja = (ops.get(c.ticker) ?? []).some((o) => o.data === c.data && o.tipo === c.tipo && Math.abs(o.quantidade - c.quantidade) < 1e-7);
    if (ja) { repetidas++; continue; }
    add(c.ticker, { origem: c.origem, data: c.data, tipo: c.tipo, quantidade: c.quantidade, preco: c.preco, taxas: c.taxas, nota: "Confirmação Inter" });
  }

  const ext = entrada.extrato;
  const posExt = new Map((ext?.posicoes ?? []).map((p) => [p.ticker, p]));
  const tickers = [...new Set([...ops.keys(), ...posExt.keys()])].sort();
  const ativos: AtivoEUA[] = [];

  for (const t of tickers) {
    const lista = (ops.get(t) ?? []).sort((a, b) => a.data.localeCompare(b.data));
    const comoOp = (o: OpEUA, i: number) => ({ ...o, id: String(i), ativo_id: t, criado_em: String(i).padStart(6, "0") }) as Operacao;
    const ate = ext ? lista.filter((o) => o.data <= ext.fim) : lista;
    const r = aplicarOperacoes(ate.map(comoOp));
    const p = posExt.get(t);
    let ajuste: AtivoEUA["ajuste"] = null;
    let precisaPm = false;

    if (ext) {
      const alvoQ = p?.quantidade ?? 0;
      const dif = r8(alvoQ - r.quantidade);
      if (dif > 1e-8) {
        // custo que falta para igualar o custo total do extrato (ou o preço médio do Inter)
        const pmI = entrada.pmInter?.[t];
        const alvoCusto = p && p.custoTotal > 0 ? p.custoTotal : pmI ? pmI * alvoQ : null;
        let preco = p?.precoMercado ?? 0, motivo = "preço de mercado do extrato (custo desconhecido)";
        if (alvoCusto != null) {
          const falta = alvoCusto - r.custo;
          if (falta > 0.005) { preco = falta / dif; motivo = p && p.custoTotal > 0 ? "compra que faltava no histórico (custo pelo extrato)" : "custo pelo preço médio do Inter"; }
          else { preco = 0; motivo = "entrada sem custo: desdobramento, bonificação ou reinvestimento"; }
        } else precisaPm = true;
        ajuste = { origem: `eua:${hash([t, ext.fim, dif].join("|"))}`, data: ext.fim, tipo: "compra", quantidade: dif, preco, taxas: 0,
          nota: "Ajuste de conciliação com o extrato do Inter", motivo };
      } else if (dif < -1e-8) {
        ajuste = { origem: `eua:${hash([t, ext.fim, dif].join("|"))}`, data: ext.fim, tipo: "venda", quantidade: -dif, preco: r.precoMedio, taxas: 0,
          nota: "Ajuste de conciliação com o extrato do Inter (pelo preço médio)", motivo: "o histórico tem mais do que o extrato" };
      }
    }

    const proventos = (ext?.dividendos ?? []).filter((d) => d.ticker === t)
      .map((d) => ({ origem: d.origem, data: d.data, valor: d.liquido, bruto: d.bruto, imposto: d.imposto }));
    const todas = [...lista, ...(ajuste ? [ajuste] : [])];
    const fin = aplicarOperacoes(todas.map(comoOp));
    if (fin.quantidade <= 1e-9 && !proventos.length && !lista.length) continue;
    ativos.push({
      ticker: t, nome: entrada.nomes?.[t] ?? null, classe: classe.get(t) ?? "exterior",
      ops: lista, proventos, qtdCalculada: r8(r.quantidade), qtdExtrato: ext ? (p?.quantidade ?? 0) : null,
      custoCalculado: Math.round(r.custo * 100) / 100, custoExtrato: p ? p.custoTotal : null, precoMercado: p?.precoMercado ?? null,
      ajuste, precisaPm,
    });
  }
  if (!ext) avisos.push("Sem extrato do Inter: as quantidades não foram conferidas.");
  const semPm = ativos.filter((a) => a.precisaPm).map((a) => a.ticker);
  if (semPm.length) avisos.push(`Ativos transferidos sem custo no extrato: ${semPm.join(", ")}. Informe o preço médio do app do Inter para o custo ficar certo.`);
  return { dataExtrato: ext?.fim ?? null, ativos, avisos, confirmacoesRepetidas: repetidas };
}
