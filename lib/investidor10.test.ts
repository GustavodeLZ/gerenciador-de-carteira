import { test } from "node:test";
import assert from "node:assert/strict";
import { lerInvestidor10, ehCsvInvestidor10, numBR } from "./investidor10.ts";

// Formato da exportação de posições do Investidor10 (valores fictícios)
const CAB = "Tipo de ativo;Ativo;Quant.;Preço Médio;Preço Atual;Variação;Rentabilidade;Saldo;Nota;% Carteira;% Ideal;Comprar?;Tipo";
const CSV = "﻿" + [
  CAB,
  "Ações;ABCD3;60;R$ 42,10;R$ 63,30;50,35%;50,46%;R$ 3.798,00;10;2,65%;1,00%;Não;",
  "FIIs;FUND11;24;R$ 158,30;R$ 145,69;-7,97%;5,00%;R$ 3.496,56;10;2,44%;1,00%;Não;",
  "Stocks;BRK-B;0,03483296;US$ 574,16;US$ 592,59;3,21%;3,21%;US$ 20,64;10;0,08%;0,00%;Não;",
  "Reits;SPG;0,39;US$ 179,76;US$ 234,18;30,27%;63,87%;US$ 91,19;10;0,35%;0,00%;Não;",
  "ETFs Intern.;VOO;0,20499654;US$ 491,77;US$ 698,35;42,01%;42,01%;US$ 143,16;10;0,10%;0,00%;Não;",
  "Criptomoedas;BTC;0,00333542;R$ 277.924,84;R$ 403.412,98;45,15%;45,15%;R$ 1.345,55;10;0,94%;0,00%;Não;",
  "Renda Fixa;CDB - Banco X - Pós-Fixado - 103% CDI;;;;4,94%;4,94%;R$ 1.049,45;10;0,73%;0,98%;Sim;",
  "Renda Fixa;CDB - Banco X - Pós-Fixado - 103% CDI;;;;3,65%;3,65%;R$ 1.036,47;10;0,72%;0,98%;Sim;",
  "Tesouro Direto;Tesouro IPCA+ 2040;0,59;;R$ 1.750,57;3,76%;4,08%;R$ 1.032,84;10;0,72%;0,00%;Não;",
  "Outra Coisa;XYZ;1;R$ 1,00;R$ 1,00;0%;0%;R$ 1,00;;;;;",
].join("\r\n");

const perto = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test("números no formato do Investidor10", () => {
  assert.equal(numBR("R$ 1.234,56"), 1234.56);
  assert.equal(numBR("US$ 0,50"), 0.5);
  assert.equal(numBR("4,94%"), 4.94);
  assert.equal(numBR("0,03483296"), 0.03483296);
  assert.equal(numBR(""), null);
});

test("reconhece o arquivo", () => {
  assert.ok(ehCsvInvestidor10(CSV));
  assert.ok(!ehCsvInvestidor10("Data do Negócio;Tipo"));
});

test("lê classes, moedas e preços", () => {
  const { posicoes: p, ignoradas } = lerInvestidor10(CSV);
  const t = (x: string) => p.find((y) => y.ticker === x)!;
  assert.deepEqual([t("ABCD3").classe, t("ABCD3").moeda, t("ABCD3").quantidade, t("ABCD3").precoMedio], ["acao", "BRL", 60, 42.1]);
  assert.equal(t("FUND11").classe, "fii");
  assert.equal(t("BRK.B").moeda, "USD", "BRK-B vira BRK.B");
  assert.equal(t("VOO").classe, "etf_exterior");
  assert.equal(t("BTC").classe, "cripto");
  assert.ok(t("BTC").precoManual);
  assert.ok(ignoradas.some((x) => x.startsWith("Outra Coisa")));
});

test("REIT com quantidade arredondada é recalculada pelo saldo", () => {
  const { posicoes, avisos } = lerInvestidor10(CSV);
  const spg = posicoes.find((x) => x.ticker === "SPG")!;
  assert.equal(spg.classe, "reit");
  perto(spg.quantidade, 91.19 / 234.18, 1e-8);
  assert.ok(avisos.some((a) => a.startsWith("SPG")));
});

test("renda fixa: custo = saldo ÷ (1 + variação), tickers únicos", () => {
  const rf = lerInvestidor10(CSV).posicoes.filter((x) => x.classe === "renda_fixa");
  assert.equal(rf.length, 2);
  perto(rf[0].precoMedio, Math.round((1049.45 / 1.0494) * 100) / 100);
  assert.equal(rf[0].quantidade, 1);
  assert.notEqual(rf[0].ticker, rf[1].ticker);
  assert.notEqual(rf[0].origem, rf[1].origem);
});

test("Tesouro sem preço médio usa a variação; coluna Valor Aplicado tem prioridade", () => {
  const td = lerInvestidor10(CSV).posicoes.find((x) => x.classe === "tesouro")!;
  perto(td.precoMedio * td.quantidade, 1032.84 / 1.0376, 1e-6);
  const comCol = CAB + ";Código B3;Valor Aplicado;Observação\r\n" +
    "Tesouro Direto;Tesouro IPCA+ 2040;0,59;;R$ 1.750,57;3,76%;4,08%;R$ 1.032,84;10;0,72%;0,00%;Não;;TESOURO IPCA+ 2040;R$ 995,37;ok\r\n" +
    "Renda Fixa;CDB - Banco X;;;;4,94%;;R$ 1.049,45;;;;;;CDBX1;R$ 1.000,00;";
  const p = lerInvestidor10(comCol).posicoes;
  perto(p[0].precoMedio * p[0].quantidade, 995.37, 1e-6);
  assert.equal(p[1].ticker, "CDBX1");
  assert.equal(p[1].precoMedio, 1000);
});

test("origem estável entre leituras", () => {
  const a = lerInvestidor10(CSV).posicoes.map((x) => x.origem);
  const b = lerInvestidor10(CSV).posicoes.map((x) => x.origem);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});
