import { test } from "node:test";
import assert from "node:assert/strict";
import { montarPlano, tickerBase, classePorTicker } from "./montar.ts";
import type { ArquivosB3, Linha } from "./planilha.ts";

// Dados sintéticos no formato dos relatórios da B3 (sem dados reais)
const INST = "CORRETORA EXEMPLO";
const neg = (data: string, tipo: string, mercado: string, cod: string, q: number, p: number): Linha =>
  ({ "Data do Negócio": data, "Tipo de Movimentação": tipo, Mercado: mercado, "Prazo/Vencimento": "-", Instituição: INST, "Código de Negociação": cod, Quantidade: q, Preço: p, Valor: q * p });
const mov = (es: string, data: string, tipo: string, produto: string, q: number | string, pu: number | string, v: number | string): Linha =>
  ({ "Entrada/Saída": es, Data: data, Movimentação: tipo, Produto: produto, Instituição: INST, Quantidade: q, "Preço unitário": pu, "Valor da Operação": v });
const posRV = (cod: string, q: number, preco: number): Linha =>
  ({ Produto: `${cod} - EMPRESA ${cod}`, Instituição: INST, Conta: "000", "Código de Negociação": cod, Quantidade: q, "Preço de Fechamento": preco, "Valor Atualizado": q * preco });

function dados(over: Partial<ArquivosB3> = {}): ArquivosB3 {
  return {
    negociacao: [
      neg("10/01/2025", "Compra", "Mercado à Vista", "AAAA3", 100, 10),
      neg("10/01/2025", "Compra", "Mercado Fracionário", "AAAA3F", 5, 10),
      neg("10/02/2025", "Venda", "Mercado à Vista", "AAAA3", 50, 12),
      neg("10/02/2025", "Compra", "Mercado à Vista", "FUND11", 10, 100),
      neg("01/03/2025", "Compra", "Mercado à Vista", "OLDX3", 30, 20),     // depois vira NEWX3
      neg("01/03/2025", "Compra", "Renda Fixa", "CDB123", 1, 1000),
    ],
    movimentacao: [
      mov("Credito", "15/03/2025", "Rendimento", "FUND11 - FUNDO EXEMPLO", 10, 1, 10),
      mov("Credito", "16/03/2025", "Juros Sobre Capital Próprio", "AAAA3 - EMPRESA A", 55, 0.1, 5.5),
      mov("Credito", "16/03/2025", "Rendimento", "FUND13 - FUNDO EXEMPLO", 2, 1, 2),       // recibo → FUND11
      mov("Credito", "01/04/2025", "Desdobro", "AAAA3 - EMPRESA A", 55, "-", "-"),
      mov("Credito", "02/04/2025", "Bonificação em Ativos", "AAAA3 - EMPRESA A", 1.5, "-", "-"),
      mov("Debito", "03/04/2025", "Fração em Ativos", "AAAA3 - EMPRESA A", 0.5, "-", "-"),
      mov("Credito", "10/04/2025", "Leilão de Fração", "AAAA3 - EMPRESA A", 0.5, 8, 4),
      mov("Debito", "05/04/2025", "Direitos de Subscrição - Exercido", "FUND12 - FUNDO EXEMPLO", 2, 95, 190),
      mov("Debito", "10/01/2025", "Transferência - Liquidação", "AAAA3 - EMPRESA A", 100, 10, 1000),
      mov("Credito", "05/01/2025", "APLICAÇÃO", "CDB - CDBX1 - BANCO", 1000, 1, 1000),
      mov("Credito", "05/01/2025", "Compra", "Tesouro IPCA+ 2040", 0.5, 2000, 1000),
    ],
    posicao: [
      { nome: "Acoes", linhas: [posRV("AAAA3", 111, 11), posRV("NEWX3", 30, 25), posRV("ZZZZ3", 7, 50)] },
      { nome: "Fundo de Investimento", linhas: [posRV("FUND11", 12, 101), posRV("FUND13", 3, 0)] },
      { nome: "Renda Fixa", linhas: [{ Produto: "CDB - BANCO X", Código: "CDBX1", Indexador: "DI", Vencimento: "01/01/2030", "Data de Emissão": "05/01/2025", Quantidade: 1000, "Valor Atualizado CURVA": 1100, "Valor Atualizado MTM": "-" }] },
      { nome: "Tesouro Direto", linhas: [{ Produto: "Tesouro IPCA+ 2040", Indexador: "IPCA", Vencimento: "15/08/2040", Quantidade: 0.5, "Valor Aplicado": 1000, "Valor Atualizado": 1050 }] },
    ],
    desconhecidos: [],
    ...over,
  };
}
const HOJE = "2026-11-12";
const ativo = (p: ReturnType<typeof montarPlano>, t: string) => p.ativos.find((a) => a.ticker === t)!;

test("utilitários de código", () => {
  assert.equal(tickerBase("KEPL3F"), "KEPL3");
  assert.equal(tickerBase("BPAC11F"), "BPAC11");
  assert.equal(tickerBase("HGLG11"), "HGLG11");
  assert.equal(classePorTicker("MELI34"), "bdr");
  assert.equal(classePorTicker("HGLG11"), "fii");
  assert.equal(classePorTicker("PETR4"), "acao");
});

test("negociação, fracionário e eventos chegam à quantidade da B3", () => {
  const p = montarPlano(dados(), {}, HOJE);
  const a = ativo(p, "AAAA3");
  // 100 + 5 (fracionário) − 50 + 55 (desdobro) + 1,5 (bonificação) − 0,5 (fração) = 111
  assert.equal(a.qtdCalculada, 111);
  assert.equal(a.qtdB3, 111);
  assert.equal(a.ajuste, null);
  assert.equal(a.classe, "acao");
  const fracao = a.ops.find((o) => o.nota.includes("Fração"))!;
  assert.equal(fracao.preco, 8, "fração usa o preço do leilão");
});

test("subscrição exercida vira compra do ativo base; rendimento de recibo vai para o base", () => {
  const p = montarPlano(dados(), {}, HOJE);
  const f = ativo(p, "FUND11");
  assert.equal(f.qtdCalculada, 12);
  assert.ok(f.ops.some((o) => o.tipo === "compra" && o.preco === 95 && o.quantidade === 2));
  assert.equal(f.proventos.length, 2);
  assert.equal(f.classe, "fii");
  assert.ok(!p.ativos.some((x) => x.ticker === "FUND12" || x.ticker === "FUND13"));
});

test("proventos de ações", () => {
  const p = montarPlano(dados(), {}, HOJE);
  assert.deepEqual(ativo(p, "AAAA3").proventos.map((x) => [x.tipo, x.valor]), [["jcp", 5.5]]);
});

test("troca de código sugerida e aplicada", () => {
  const p = montarPlano(dados(), {}, HOJE);
  assert.deepEqual(p.sugestoesTroca.map((s) => [s.de, s.para]), [["OLDX3", "NEWX3"]]);
  assert.equal(ativo(p, "OLDX3").ajuste?.tipo, "venda");
  const p2 = montarPlano(dados(), { renomear: { OLDX3: "NEWX3" } }, HOJE);
  const n = ativo(p2, "NEWX3");
  assert.equal(n.qtdCalculada, 30);
  assert.equal(n.ajuste, null);
  assert.deepEqual(n.incorporou, ["OLDX3"]);
  assert.ok(!p2.ativos.some((x) => x.ticker === "OLDX3"));
});

test("ajuste de conciliação: entrada pelo fechamento (editável) e saída pelo preço médio", () => {
  const p = montarPlano(dados(), {}, HOJE);
  const z = ativo(p, "ZZZZ3");
  assert.deepEqual([z.ajuste?.tipo, z.ajuste?.quantidade, z.ajuste?.preco], ["compra", 7, 50]);
  const p2 = montarPlano(dados(), { precoAjuste: { ZZZZ3: 42 } }, HOJE);
  assert.equal(ativo(p2, "ZZZZ3").ajuste?.preco, 42);
  const o = ativo(p, "OLDX3");
  assert.deepEqual([o.ajuste?.tipo, o.ajuste?.quantidade, o.ajuste?.preco], ["venda", 30, 20]);
});

test("renda fixa e Tesouro vêm da posição", () => {
  const p = montarPlano(dados(), {}, HOJE);
  const cdb = p.rendaFixa.find((r) => r.ticker === "CDBX1")!;
  assert.equal(cdb.valorAtual, 1100);
  assert.equal(cdb.valorAplicado, null);
  assert.equal(cdb.data, "2025-01-05");
  const td = p.rendaFixa.find((r) => r.classe === "tesouro")!;
  assert.equal(td.ticker, "TESOURO IPCA+ 2040");
  assert.equal(td.valorAplicado, 1000);
  assert.equal(td.data, "2025-01-05", "data da primeira compra na movimentação");
});

test("liquidações e renda fixa da negociação são ignoradas (sem duplicar)", () => {
  const p = montarPlano(dados(), {}, HOJE);
  assert.equal(p.ignorados["Liquidação de negócio (já está na Negociação)"], 1);
  assert.equal(p.ignorados["Negociação de renda fixa (vem da posição)"], 1);
});

test("origens estáveis e únicas; linhas idênticas não colidem", () => {
  const d = dados();
  d.negociacao.push(neg("10/01/2025", "Compra", "Mercado à Vista", "AAAA3", 100, 10)); // execução repetida igual
  const a = montarPlano(d, {}, HOJE), b = montarPlano(d, {}, HOJE);
  const oa = a.ativos.flatMap((x) => [...x.ops, ...x.proventos].map((o) => o.origem));
  const ob = b.ativos.flatMap((x) => [...x.ops, ...x.proventos].map((o) => o.origem));
  assert.deepEqual(oa, ob);
  assert.equal(new Set(oa).size, oa.length);
});

test("sem posição: importa operações, não sugere ajustes e avisa", () => {
  const p = montarPlano(dados({ posicao: [] }), {}, HOJE);
  assert.ok(p.ativos.every((a) => a.ajuste === null));
  assert.equal(p.rendaFixa.length, 0);
  assert.ok(p.avisos.some((x) => x.includes("Posição")));
});

test("reimportação não repete ajustes já gravados", () => {
  const p1 = montarPlano(dados(), {}, "2026-11-12");
  const z1 = ativo(p1, "ZZZZ3").ajuste!;
  // mês seguinte: mesmos arquivos, ajuste de +7 já gravado no banco
  const p2 = montarPlano(dados(), { ajustesExistentes: { ZZZZ3: 7 } }, "2026-12-12");
  assert.equal(ativo(p2, "ZZZZ3").ajuste, null);
  // origem do ajuste não depende da data
  const p3 = montarPlano(dados(), {}, "2026-12-12");
  assert.equal(ativo(p3, "ZZZZ3").ajuste!.origem, z1.origem);
});

test("incorporação com proporção ≠ 1:1 ajusta por fator e mantém o custo total", () => {
  const d = dados();
  d.posicao[0].linhas = d.posicao[0].linhas.map((l) => (l["Código de Negociação"] === "NEWX3" ? posRV("NEWX3", 24, 25) : l)); // 30 → 24 (0,8:1)
  const p = montarPlano(d, { renomear: { OLDX3: "NEWX3" } }, HOJE);
  const n = ativo(p, "NEWX3");
  assert.equal(n.ajuste?.tipo, "grupamento");
  assert.ok(Math.abs(n.ajuste!.quantidade - 30 / 24) < 1e-9);
});

test("com posição inicial: só operações depois do corte, proventos todos, conferência soma a base", () => {
  const d = dados();
  d.negociacao.push(neg("05/01/2026", "Compra", "Mercado à Vista", "AAAA3", 4, 20)); // depois do corte
  d.posicao[0].linhas = d.posicao[0].linhas.map((l) => (l["Código de Negociação"] === "AAAA3" ? posRV("AAAA3", 115, 11) : l));
  const p = montarPlano(d, { corte: "2025-12-31", base: { AAAA3: { qtd: 111, pm: 9 }, FUND11: { qtd: 12, pm: 99 }, NEWX3: { qtd: 30, pm: 20 }, ZZZZ3: { qtd: 7, pm: 40 } } }, HOJE);
  const a = ativo(p, "AAAA3");
  assert.equal(a.ops.length, 1, "só a compra de 2026");
  assert.equal(a.qtdCalculada, 115);
  assert.equal(a.ajuste, null);
  assert.equal(a.proventos.length, 1, "proventos anteriores ao corte continuam");
  assert.equal(ativo(p, "ZZZZ3").ajuste, null, "base cobre o que antes precisava de ajuste");
  assert.ok(Object.keys(p.ignorados).some((k) => k.startsWith("Operações até 31/12/2025")));
  assert.equal(p.corte, "2025-12-31");
});
