import { test } from "node:test";
import assert from "node:assert/strict";
import { lerLinhas, NotaErro } from "./index.ts";

// Texto sintético no mesmo layout da confirmação DriveWealth/Inter (sem dados reais).
const NOTA = `Inter Co Securities LLC
Transaction  501 Brickell Key Drive
Confirmation
Account Number:  ITER-000-XXXX000000  Account Name:  FULANO DE TAL
Confirmation Date :  3/2/2026
Symbol  Security  A/CType  Action  Execution Time  Quantity  Price  Trade Date  Settle Date  Capacity
BRK.B  BERKSHIRE HATHAWAY INC DEL CL B NEW  M  Buy  1:33:20 PM  0.03483296  574.1688  3/2/2026  3/3/2026  Principal
Principal Amount  $20.00
Interest
Commission  $0.00
Transaction Fee  $0.00
Other Fees / Credits  $0.00
Net Amount  $20.00
GOOG  ALPHABET INC  CAP STK CL C  M  Buy  1:35:17 PM  0.06951231  287.7188  3/2/2026  3/3/2026  Principal
Principal Amount  $20.00
Interest
Commission  $0.00
Transaction Fee  $0.00
Other Fees / Credits  $0.00
Net Amount  $20.00
Clearing and execution services provided by DriveWealth, LLC member FINRA and SIPC.  Page 1 of 2
Symbol  Security  A/CType  Action  Execution Time  Quantity  Price  Trade Date  Settle Date  Capacity
AAPL  APPLE INC  COM  C  Sell  10:01:02 AM  1.5  200.00  3/2/2026  3/3/2026  Riskless Principal
Principal Amount  $300.00
Interest
Commission  $0.00
Transaction Fee  $0.03
Other Fees / Credits  $0.01
Net Amount  $299.96
MSFT  MICROSOFT CORP  M  Buy  11:00:00 AM  1  10.00  3/2/2026  3/3/2026  Principal
Principal Amount  $10.00
Other Fees / Credits  ($0.01)
Net Amount  $9.99
Clearing and execution services provided by DriveWealth, LLC member FINRA and SIPC.  Page 2 of 2`.split("\n");

test("lê as operações da confirmação DriveWealth", () => {
  const n = lerLinhas(NOTA);
  assert.equal(n.formato, "drivewealth");
  assert.equal(n.moeda, "USD");
  assert.equal(n.operacoes.length, 4);
  const [brk, goog, aapl, msft] = n.operacoes;
  assert.deepEqual(
    { t: brk.ticker, tipo: brk.tipo, d: brk.data, q: brk.quantidade, p: brk.preco, tx: brk.taxas },
    { t: "BRK.B", tipo: "compra", d: "2026-03-02", q: 0.03483296, p: 574.1688, tx: 0 },
  );
  assert.equal(goog.nome, "ALPHABET INC CAP STK CL C");
  assert.equal(aapl.tipo, "venda");
  assert.equal(aapl.taxas, 0.04);
  assert.equal(aapl.liquido, 299.96);
  assert.equal(msft.taxas, 0);
  assert.ok(n.avisos.some((a) => a.startsWith("MSFT")), "avisa sobre crédito de arredondamento");
});

test("origem é estável e única por linha", () => {
  const a = lerLinhas(NOTA).operacoes.map((o) => o.origem);
  const b = lerLinhas(NOTA).operacoes.map((o) => o.origem);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
});

test("não guarda nome nem conta do titular", () => {
  const json = JSON.stringify(lerLinhas(NOTA));
  assert.ok(!json.includes("FULANO"));
  assert.ok(!json.includes("XXXX000000"));
});

test("formato desconhecido gera erro claro", () => {
  assert.throws(() => lerLinhas(["NOTA DE CORRETAGEM", "qualquer coisa"]), (e) => e instanceof NotaErro && e.codigo === "formato");
  assert.throws(() => lerLinhas(["", "  "]), (e) => e instanceof NotaErro && e.codigo === "vazio");
});
