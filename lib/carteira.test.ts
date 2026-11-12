import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarOperacoes, calcularPosicoes, resumirSegmentos, parseNum, type Operacao, type Ativo } from "./carteira.ts";

const op = (tipo: Operacao["tipo"], data: string, quantidade: number, preco = 0, taxas = 0): Operacao =>
  ({ id: Math.random().toString(), ativo_id: "a", tipo, data, quantidade, preco, taxas });

const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test("preço médio com duas compras e taxas", () => {
  const r = aplicarOperacoes([op("compra", "2024-01-01", 100, 10, 5), op("compra", "2024-02-01", 100, 20, 5)]);
  perto(r.quantidade, 200); perto(r.custo, 3010); perto(r.precoMedio, 15.05);
});

test("venda mantém o preço médio e apura lucro", () => {
  const r = aplicarOperacoes([op("compra", "2024-01-01", 100, 10), op("venda", "2024-03-01", 40, 15, 2)]);
  perto(r.quantidade, 60); perto(r.precoMedio, 10); perto(r.lucroRealizado, 40 * 15 - 2 - 400);
});

test("ordena por data mesmo fora de ordem", () => {
  const r = aplicarOperacoes([op("venda", "2024-03-01", 50, 12), op("compra", "2024-01-01", 100, 10)]);
  perto(r.quantidade, 50); perto(r.lucroRealizado, 100);
});

test("desdobramento e grupamento", () => {
  const r = aplicarOperacoes([op("compra", "2024-01-01", 100, 30), op("desdobramento", "2024-02-01", 3)]);
  perto(r.quantidade, 300); perto(r.precoMedio, 10);
  const g = aplicarOperacoes([op("compra", "2024-01-01", 1000, 1), op("grupamento", "2024-02-01", 10)]);
  perto(g.quantidade, 100); perto(g.precoMedio, 10);
});

test("bonificação entra com custo atribuído", () => {
  const r = aplicarOperacoes([op("compra", "2024-01-01", 100, 10), op("bonificacao", "2024-02-01", 10, 5)]);
  perto(r.quantidade, 110); perto(r.custo, 1050);
});

test("venda total zera a posição", () => {
  const r = aplicarOperacoes([op("compra", "2024-01-01", 10, 10), op("venda", "2024-02-01", 10, 11)]);
  perto(r.quantidade, 0); perto(r.custo, 0); perto(r.lucroRealizado, 10);
});

test("posições, preço manual e segmentos", () => {
  const ativos: Ativo[] = [
    { id: "a", ticker: "ITUB4", nome: null, classe: "acao", moeda: "BRL", preco_manual: null, preco_manual_em: null },
    { id: "b", ticker: "CDB", nome: null, classe: "renda_fixa", moeda: "BRL", preco_manual: 1100, preco_manual_em: null },
  ];
  const ops: Operacao[] = [op("compra", "2024-01-01", 100, 30), { ...op("compra", "2024-01-01", 1, 1000), ativo_id: "b" }];
  const pos = calcularPosicoes(ativos, ops, [{ ticker: "ITUB4", data: "2026-11-10", fechamento: 35 }], [
    { id: "p", ativo_id: "a", tipo: "dividendo", data_pagamento: "2026-06-01", valor_total: 50 },
  ], new Date("2026-11-11"));
  perto(pos[0].valor, 3500); assert.equal(pos[0].precoFonte, "cotacao"); perto(pos[0].proventos12m, 50);
  perto(pos[1].valor, 1100); assert.equal(pos[1].precoFonte, "manual");
  const total = 4600;
  const [seg] = resumirSegmentos([{ id: "s", nome: "Div", descricao: null, meta_pct: null }],
    [{ segmento_id: "s", ativo_id: "a", meta_pct: 100 }], pos, total);
  perto(seg.valor, 3500); perto(seg.itens[0].pctSegmento, 1); perto(seg.pctCarteira, 3500 / 4600);
});

test("parseNum aceita formato brasileiro", () => {
  assert.equal(parseNum("1.234,56"), 1234.56);
  assert.equal(parseNum("R$ 10"), 10);
  assert.equal(parseNum("12.5"), 12.5);
  assert.ok(Number.isNaN(parseNum("")));
});

test("ativo em dólar: custo pelo câmbio da operação, valor pelo dólar atual", () => {
  const ativos: Ativo[] = [{ id: "u", ticker: "GOOG", nome: null, classe: "exterior", moeda: "USD", preco_manual: null, preco_manual_em: null }];
  const ops: Operacao[] = [
    { ...op("compra", "2026-01-10", 1, 100), ativo_id: "u", cambio: 5 },
    { ...op("compra", "2026-06-10", 1, 200), ativo_id: "u", cambio: 6 },
  ];
  const [p] = calcularPosicoes(ativos, ops, [
    { ticker: "US:GOOG", data: "2026-11-10", fechamento: 180 },
    { ticker: "FX:USDBRL", data: "2026-11-10", fechamento: 5.5 },
  ], [{ id: "d", ativo_id: "u", tipo: "dividendo", data_pagamento: "2026-10-01", valor_total: 2 }], new Date("2026-11-11"));
  perto(p.precoMedio, 150);          // US$
  perto(p.custoMoeda, 300);          // US$
  perto(p.custo, 100 * 5 + 200 * 6); // R$ 1700
  perto(p.valorMoeda, 360);          // US$
  perto(p.valor, 360 * 5.5);         // R$ 1980
  perto(p.rentabilidadeMoeda!, 0.2);
  perto(p.proventos12m, 11);         // 2 US$ × 5,5
});

test("venda em dólar baixa o custo em reais proporcionalmente", () => {
  const r = aplicarOperacoes([
    { ...op("compra", "2026-01-10", 2, 100), cambio: 5 },
    { ...op("venda", "2026-02-10", 1, 120), cambio: 5.2 },
  ]);
  perto(r.quantidade, 1); perto(r.custo, 100); perto(r.custoBRL, 500); perto(r.lucroRealizado, 20);
});

test("compra e venda no mesmo dia: a venda não é perdida", () => {
  const r = aplicarOperacoes([op("venda", "2026-01-10", 5, 12), op("compra", "2026-01-10", 10, 10)]);
  perto(r.quantidade, 5); perto(r.lucroRealizado, 10);
});
