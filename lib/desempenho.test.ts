import { test } from "node:test";
import assert from "node:assert/strict";
import { calcularDesempenho, diasUteis, nivelEm, valorEm } from "./desempenho.ts";
import type { Ativo, Operacao, Provento } from "./carteira.ts";

const at = (id: string, ticker: string, classe: Ativo["classe"], moeda: "BRL" | "USD" = "BRL", extra: Partial<Ativo> = {}): Ativo =>
  ({ id, ticker, nome: null, classe, moeda, preco_manual: null, preco_manual_em: null, ...extra }) as Ativo;
const op = (ativo_id: string, tipo: Operacao["tipo"], data: string, quantidade: number, preco = 0): Operacao =>
  ({ id: `${ativo_id}${data}${tipo}`, ativo_id, tipo, data, quantidade, preco, taxas: 0, cambio: null }) as Operacao;
const fim = (s: { pontos: { cota: number }[] }) => s.pontos.at(-1)!.cota;
const perto = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test("dias úteis e busca de valor", () => {
  assert.deepEqual(diasUteis("2026-11-06", "2026-11-10"), ["2026-11-06", "2026-11-09", "2026-11-10"]);
  const s: [string, number][] = [["2026-11-02", 10], ["2026-11-04", 12]];
  assert.equal(valorEm(s, "2026-11-01"), null);
  assert.equal(valorEm(s, "2026-11-03"), 10);
  assert.equal(valorEm(s, "2026-11-09"), 12);
  perto(nivelEm([["2026-01-01", 100], ["2026-01-11", 121]], "2026-01-06", true)!, 110);
});

test("aporte não vira rentabilidade; preço sim", () => {
  const precos = { AAA3: [["2026-11-02", 10], ["2026-11-03", 11], ["2026-11-04", 11], ["2026-11-05", 12.1]] as [string, number][] };
  const r = calcularDesempenho({
    ativos: [at("a", "AAA3", "acao")],
    ops: [op("a", "compra", "2026-11-02", 10, 10), op("a", "compra", "2026-11-04", 100, 11)],
    proventos: [], precos, dolar: [], dolarAtual: 5, hoje: "2026-11-05",
  });
  assert.equal(r.pontos[0].data, "2026-11-02");
  perto(fim(r), 1.21); // +10% e +10%, apesar do aporte grande no meio
  assert.equal(r.pontos.at(-1)!.valor, 110 * 12.1);
});

test("proventos contam como retorno e desdobramento não distorce", () => {
  const precos = { BBB3: [["2026-11-02", 20], ["2026-11-03", 20], ["2026-11-04", 10]] as [string, number][] };
  const provs: Provento[] = [{ id: "p", ativo_id: "b", tipo: "dividendo", data_pagamento: "2026-11-03", valor_total: 20 } as Provento];
  const r = calcularDesempenho({
    ativos: [at("b", "BBB3", "acao")],
    ops: [op("b", "compra", "2026-11-02", 10, 20), op("b", "desdobramento", "2026-11-04", 2)],
    proventos: provs, precos, dolar: [], dolarAtual: 5, hoje: "2026-11-04",
  });
  perto(fim(r), 1.1); // 20 de provento sobre 200 = +10%; o desdobramento 1:2 com preço pela metade não muda nada
});

test("ativo em dólar: câmbio entra no retorno em reais", () => {
  const r = calcularDesempenho({
    ativos: [at("u", "SCHD", "etf_exterior", "USD")],
    ops: [op("u", "compra", "2026-11-02", 1, 100)],
    proventos: [], precos: { "US:SCHD": [["2026-11-02", 100], ["2026-11-03", 100]] },
    dolar: [["2026-11-02", 5], ["2026-11-03", 5.5]], dolarAtual: 5.5, hoje: "2026-11-03",
  });
  perto(fim(r), 1.1);
});

test("só começa quando quase toda a carteira tem histórico de preços", () => {
  const r = calcularDesempenho({
    ativos: [at("a", "AAA3", "acao"), at("u", "VVV", "etf_exterior", "USD")],
    ops: [op("a", "compra", "2026-10-01", 10, 10), op("u", "compra", "2026-10-01", 10, 10)],
    proventos: [], precos: { AAA3: [["2026-11-02", 10], ["2026-11-03", 11]] },
    dolar: [], dolarAtual: 1, hoje: "2026-11-03",
  });
  assert.equal(r.pontos.length, 0);
  assert.deepEqual(r.semHistorico, ["VVV"]);
});

test("renda fixa evolui do valor aplicado até o saldo informado", () => {
  const r = calcularDesempenho({
    ativos: [at("r", "CDB1", "renda_fixa", "BRL", { preco_manual: 1100, preco_manual_em: "2026-11-11T12:00:00Z" })],
    ops: [op("r", "compra", "2026-11-02", 1, 1000)],
    proventos: [], precos: {}, dolar: [], dolarAtual: 1, hoje: "2026-11-11",
  });
  perto(fim(r), 1.1);
  assert.ok(r.pontos[3].cota > 1 && r.pontos[3].cota < 1.1);
});
