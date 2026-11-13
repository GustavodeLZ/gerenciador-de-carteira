import { test } from "node:test";
import assert from "node:assert/strict";
import { lerMyProfit } from "./myprofit.ts";
import { lerExtratoInter, ehExtratoInter } from "./notas/extrato-inter.ts";
import { montarPlanoEUA } from "./eua.ts";

// dados fictícios — nenhum dado pessoal
const CAB = ["Data de negociação", "Moeda", "Total de Taxas", "Ativo", "Grupo", "Quantidade", "Tipo", "Preço sem taxas", "Total com taxas"];
const planilha = [
  ["Relatório Histórico de investimentos"], ["Titular: FULANO DE TAL", "CPF: 000.000.000-00"], [],
  CAB,
  ["10/01/2025", "USD", 0, "AAA", "Ações EUA", 2, "Compra", 10, 20],
  ["10/01/2025", "USD", 0, "AAA", "Ações EUA", 2, "Compra", 10, 20],
  ["15/02/2025", "USD", 0, "BRKB", "Ações EUA", 1, "Compra", 400, 400],
  ["20/03/2025", "USD", 0, "VVV", "ETF USA", 3, "Compra", 50, 150],
  ["05/04/2025", "BRL", 1, "PETR4", "Ações", 100, "Compra", 30, 3001],
  ["06/04/2025", "BRL", 0, "XXXX", "Grupo Estranho", 1, "Compra", 1, 1],
];

test("myProfit: ignora o cabeçalho com dados pessoais, renomeia e distingue linhas iguais", () => {
  const { ops, ignoradas } = lerMyProfit(planilha);
  assert.equal(ops.length, 5);
  assert.ok(!JSON.stringify(ops).includes("FULANO") && !JSON.stringify(ops).includes("000.000"));
  assert.equal(ops[2].ticker, "BRK.B");
  assert.equal(ops[3].classe, "etf_exterior");
  assert.equal(ops[4].moeda, "BRL");
  assert.notEqual(ops[0].origem, ops[1].origem);
  assert.equal(lerMyProfit(planilha).ops[0].origem, ops[0].origem); // estável entre leituras
  assert.equal(ignoradas.length, 1);
});

const extratoLinhas = [
  "DriveWealth LLC", "Account Statement", "October 1, 2025 - October 31, 2025",
  "HOLDINGS",
  "AAA INC  AAA  4  10.00  40.00  12.00  48.00  8.00  C",
  "VVV ETF  VVV  5  40.00  200.00  55.00  275.00  75.00  C",
  "BRK B  BRK.B  1  400.00  400.00  450.00  450.00  50.00  C",
  "ACTIVITY",
  "10/15/2025  10/15/2025  USD  DIV  VVV - VVV ETF CASH DIV  1.00",
  "10/15/2025  10/15/2025  USD  DIVNRA  VVV - VVV ETF NRA WITHHOLD  (0.30)",
];

test("extrato do Inter: posições e dividendos líquidos", () => {
  assert.ok(ehExtratoInter(extratoLinhas));
  const e = lerExtratoInter(extratoLinhas);
  assert.equal(e.fim, "2025-10-31");
  assert.deepEqual(e.posicoes.map((p) => p.ticker), ["AAA", "VVV", "BRK.B"]);
  assert.equal(e.dividendos.length, 1);
  assert.equal(e.dividendos[0].liquido, 0.7);
  assert.ok(e.dividendos[0].origem.startsWith("ie:"));
});

test("plano EUA: confere com o extrato e cria ajuste só onde falta", () => {
  const { ops } = lerMyProfit(planilha);
  const extrato = lerExtratoInter(extratoLinhas);
  const confirmacoes = [
    { origem: "dw:x1", ticker: "AAA", data: "2025-01-10", tipo: "compra" as const, quantidade: 2, preco: 10, taxas: 0 },
    { origem: "dw:x2", ticker: "AAA", data: "2025-11-05", tipo: "compra" as const, quantidade: 1, preco: 12, taxas: 0 },
  ];
  // @ts-expect-error campos extras da nota não importam aqui
  const p = montarPlanoEUA({ myprofit: ops, confirmacoes, extrato });
  assert.equal(p.confirmacoesRepetidas, 1);
  const a = Object.fromEntries(p.ativos.map((x) => [x.ticker, x]));
  assert.equal(a.AAA.ajuste, null);
  assert.equal(a["BRK.B"].ajuste, null);
  assert.ok(!("PETR4" in a));
  // VVV: histórico tem 3, extrato 5 → compra de 2 pelo custo que falta (200 − 150 = 50 → 25/cota)
  assert.equal(a.VVV.ajuste?.tipo, "compra");
  assert.equal(a.VVV.ajuste?.quantidade, 2);
  assert.equal(a.VVV.ajuste?.preco, 25);
  assert.equal(a.VVV.proventos[0].valor, 0.7);
  // a confirmação de novembro (depois do extrato) entra
  assert.ok(a.AAA.ops.some((o) => o.origem === "dw:x2"));
});
