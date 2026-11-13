import { createHash } from "node:crypto";
import { aplicarOperacoes, type Classe, type Operacao, type TipoOperacao } from "../carteira.ts";
import type { ArquivosB3, Linha } from "./planilha.ts";

// =====================================================================
// Tipos
// =====================================================================

export type OpPlano = {
  origem: string; data: string; tipo: TipoOperacao;
  quantidade: number; preco: number; nota: string;
};
export type ProvPlano = {
  origem: string; data: string; tipo: "dividendo" | "jcp" | "rendimento" | "juros" | "outro"; valor: number;
};
export type AtivoPlano = {
  ticker: string;
  nome: string | null;
  classe: Classe;
  /** veio da aba da posição (true) ou foi deduzido pelo código (false) */
  classeConfirmada: boolean;
  ops: OpPlano[];
  proventos: ProvPlano[];
  qtdCalculada: number;
  qtdB3: number;
  precoFechamento: number | null;
  precoMedio: number;
  /** Códigos antigos que foram juntados a este */
  incorporou: string[];
  ajuste: (OpPlano & { sugerido: true }) | null;
};
export type RendaFixaPlano = {
  ticker: string; nome: string; classe: "renda_fixa" | "tesouro";
  valorAtual: number; valorAplicado: number | null; data: string; origem: string;
};
export type SugestaoTroca = { de: string; para: string; motivo: string };

export type PlanoB3 = {
  /** data da posição inicial usada como corte, se houver */
  corte: string | null;
  ativos: AtivoPlano[];
  rendaFixa: RendaFixaPlano[];
  sugestoesTroca: SugestaoTroca[];
  ignorados: Record<string, number>;
  avisos: string[];
  temPosicao: boolean;
  contagem: { negociacoes: number; movimentacoes: number };
};

export type Escolhas = {
  /** código antigo → código novo (mudança de ticker, incorporação) */
  renomear?: Record<string, string>;
  /** preço do ajuste de conciliação por ticker (só para ajustes de entrada) */
  precoAjuste?: Record<string, number>;
  /** quantidade líquida de ajustes já gravados em importações anteriores, por ticker */
  ajustesExistentes?: Record<string, number>;
  /**
   * Posição inicial já gravada (ex.: importada do Investidor10) e sua data.
   * Operações até essa data são ignoradas; proventos entram todos.
   */
  corte?: string;
  base?: Record<string, { qtd: number; pm: number }>;
};

// =====================================================================
// Utilitários
// =====================================================================

const PREFIXOS_RF = new Set(["CDB", "LCI", "LCA", "LIG", "CRI", "CRA", "DEB", "LF", "RDB", "LC", "LFT", "NTN", "LTN", "CDCA", "CCB", "COE"]);
const TICKER_RV = /^[A-Z0-9]{4}\d{1,2}$/;

const txt = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown): number | null => {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const t = v.trim();
    if (!t || t === "-") return null;
    const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
    return isFinite(n) ? n : null;
  }
  return null;
};
/** "30/10/2026" → "2026-10-30" */
const iso = (v: unknown): string | null => {
  const m = txt(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** KEPL3F (fracionário) → KEPL3 */
export const tickerBase = (t: string) => t.toUpperCase().trim().replace(/^([A-Z0-9]{4}\d{1,2})F$/, "$1");
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/** Origem estável por linha; linhas idênticas recebem #1, #2… */
function gerador(prefixo: string) {
  const vistos = new Map<string, number>();
  return (partes: unknown[]) => {
    const k = JSON.stringify(partes);
    const n = (vistos.get(k) ?? 0) + 1;
    vistos.set(k, n);
    return `${prefixo}:${hash(k + "#" + n)}`;
  };
}

/** Classe pelo código, quando o ativo não está na posição atual. */
export function classePorTicker(t: string): Classe {
  if (/3[2-9]$/.test(t)) return "bdr";
  if (/11$/.test(t)) return "fii";
  return "acao";
}
const CLASSE_ABA: Record<string, Classe> = { acoes: "acao", bdr: "bdr", etf: "etf", "fundo de investimento": "fii" };

const ehDireito = (t: string) => /^[A-Z]{4}(1|2|12|13|14|15)$/.test(t);

// =====================================================================
// Montagem
// =====================================================================

export function montarPlano(dados: ArquivosB3, escolhas: Escolhas = {}, hoje: string): PlanoB3 {
  const ignorados: Record<string, number> = {};
  const ignora = (motivo: string) => { ignorados[motivo] = (ignorados[motivo] ?? 0) + 1; };
  const avisos: string[] = [];

  // ---------- posição atual ----------
  type Pos = { qtd: number; preco: number | null; classe: Classe; nome: string | null };
  const pos = new Map<string, Pos>();
  const rendaFixa: RendaFixaPlano[] = [];
  for (const aba of dados.posicao) {
    const nomeAba = norm(aba.nome);
    if (nomeAba === "renda fixa") {
      for (const l of aba.linhas) {
        const codigo = txt(l["Código"]).toUpperCase();
        const valor = num(l["Valor Atualizado CURVA"]) ?? num(l["Valor Atualizado MTM"]) ?? num(l["Valor Atualizado FECHAMENTO"]);
        if (!codigo || codigo === "-" || valor == null || valor <= 0) continue;
        const venc = txt(l["Vencimento"]);
        const nome = [txt(l["Produto"]), txt(l["Indexador"]), venc && venc !== "-" ? `venc. ${venc}` : ""].filter(Boolean).join(" · ");
        rendaFixa.push({ ticker: codigo, nome: nome.slice(0, 120), classe: "renda_fixa", valorAtual: valor, valorAplicado: null,
          data: iso(l["Data de Emissão"]) ?? hoje, origem: `b3p:${hash("rf|" + codigo)}` });
      }
    } else if (nomeAba === "tesouro direto") {
      for (const l of aba.linhas) {
        const produto = txt(l["Produto"]);
        const valor = num(l["Valor Atualizado"]) ?? num(l["Valor bruto"]);
        if (!/^tesouro/i.test(produto) || valor == null || valor <= 0) continue;
        const ticker = produto.toUpperCase().replace(/[^A-Z0-9 +.\-]/g, "").slice(0, 40);
        rendaFixa.push({ ticker, nome: `${produto} · ${txt(l["Indexador"])} · venc. ${txt(l["Vencimento"])}`.slice(0, 120), classe: "tesouro",
          valorAtual: valor, valorAplicado: num(l["Valor Aplicado"]), data: hoje, origem: `b3p:${hash("td|" + ticker)}` });
      }
    } else if (CLASSE_ABA[nomeAba] || "Código de Negociação" in (aba.linhas[0] ?? {})) {
      const classe = CLASSE_ABA[nomeAba] ?? "outros";
      for (const l of aba.linhas) {
        const t = tickerBase(txt(l["Código de Negociação"]));
        const q = num(l["Quantidade"]);
        if (!t || t === "-" || q == null) continue;
        if (ehDireito(t)) { ignora("Direito/recibo de subscrição na posição (entra quando virar cota)"); continue; }
        const atual = pos.get(t);
        const produto = txt(l["Produto"]);
        pos.set(t, {
          qtd: (atual?.qtd ?? 0) + q,
          preco: num(l["Preço de Fechamento"]) ?? atual?.preco ?? null,
          classe,
          nome: produto.includes(" - ") ? produto.split(" - ").slice(1).join(" - ").trim() : produto || null,
        });
      }
    }
  }
  // Data do Tesouro: primeira compra na movimentação
  for (const rf of rendaFixa.filter((r) => r.classe === "tesouro")) {
    const datas = dados.movimentacao
      .filter((l) => txt(l["Produto"]).toUpperCase() === rf.ticker && norm(txt(l["Movimentação"])) === "compra")
      .map((l) => iso(l["Data"])).filter((d): d is string => !!d).sort();
    if (datas[0]) rf.data = datas[0];
  }

  // ---------- operações por ticker (antes das trocas de código) ----------
  type Bruto = { ticker: string; op?: OpPlano; prov?: ProvPlano };
  const brutos: Bruto[] = [];
  const nomes = new Map<string, string>();

  const origemN = gerador("b3n");
  for (const l of dados.negociacao) {
    const mercado = norm(txt(l["Mercado"]));
    const tipo = norm(txt(l["Tipo de Movimentação"]));
    const t = tickerBase(txt(l["Código de Negociação"]));
    const data = iso(l["Data do Negócio"]);
    const q = num(l["Quantidade"]), p = num(l["Preço"]);
    if (mercado === "renda fixa") { ignora("Negociação de renda fixa (vem da posição)"); continue; }
    if (!mercado.startsWith("mercado a vista") && !mercado.startsWith("mercado fracionario")) { ignora(`Mercado não suportado: ${txt(l["Mercado"])}`); continue; }
    if (!t || !data || q == null || p == null || (tipo !== "compra" && tipo !== "venda")) { ignora("Linha de negociação incompleta"); continue; }
    brutos.push({ ticker: t, op: {
      origem: origemN([data, tipo, t, q, p, txt(l["Mercado"])]), data, tipo: tipo as "compra" | "venda", quantidade: q, preco: p, nota: "B3 · Negociação",
    } });
  }

  const conhecidos = new Set<string>([...pos.keys(), ...brutos.map((b) => b.ticker)]);
  const origemM = gerador("b3m");
  /** Ativo "normal" com a mesma raiz de um direito/recibo (BTLG12 → BTLG11). */
  const baseDe = (t: string) => {
    const cands = [...conhecidos].filter((c) => c.startsWith(t.slice(0, 4)) && c !== t && !ehDireito(c));
    return cands.find((c) => pos.has(c)) ?? cands[0] ?? null;
  };
  const leiloes = dados.movimentacao.filter((l) => norm(txt(l["Movimentação"])) === "leilao de fracao");

  for (const l of dados.movimentacao) {
    const mov = norm(txt(l["Movimentação"]));
    const credito = norm(txt(l["Entrada/Saída"])) === "credito";
    const produto = txt(l["Produto"]);
    const prefixo = produto.split(" - ")[0].trim().toUpperCase();
    const data = iso(l["Data"]);
    const q = num(l["Quantidade"]), pu = num(l["Preço unitário"]), valor = num(l["Valor da Operação"]);
    const rotulo = txt(l["Movimentação"]) || "(vazio)";

    if (/^tesouro/i.test(produto) || PREFIXOS_RF.has(prefixo)) { ignora(`Renda fixa/Tesouro: ${rotulo} (vem da posição)`); continue; }
    const t = tickerBase(prefixo);
    if (!TICKER_RV.test(t) || !data) { ignora(`Sem código de negociação: ${rotulo}`); continue; }
    if (produto.includes(" - ")) nomes.set(t, produto.split(" - ").slice(1).join(" - ").trim());
    const origem = origemM([data, mov, credito, produto, q, pu, valor]);

    const provento = { "rendimento": "rendimento", "dividendo": "dividendo", "juros sobre capital proprio": "jcp", "restituicao de capital": "outro" }[mov] as ProvPlano["tipo"] | undefined;
    if (provento && credito) {
      if (valor == null || valor <= 0) { ignora(`${rotulo} sem valor`); continue; }
      // Rendimento pago a recibo de subscrição (ex.: BTLG13) vai para o ativo base (BTLG11)
      const alvo = ehDireito(t) ? baseDe(t) : t;
      if (!alvo) { ignora(`${rotulo} de direito sem ativo correspondente`); continue; }
      brutos.push({ ticker: alvo, prov: { origem, data, tipo: provento, valor } });
    } else if ((mov === "desdobro" || mov === "bonificacao em ativos" || mov === "cisao") && credito && q && q > 0) {
      brutos.push({ ticker: t, op: { origem, data, tipo: "bonificacao", quantidade: q, preco: 0, nota: `B3 · ${rotulo}` } });
      if (mov !== "desdobro") avisos.push(`${t}: ${rotulo.toLowerCase()} de ${q} em ${data.split("-").reverse().join("/")} entrou com custo zero. Se a empresa informou um custo para o IR, edite a operação.`);
    } else if (mov === "fracao em ativos" && !credito && q && q > 0) {
      const leilao = leiloes.find((x) => tickerBase(txt(x["Produto"]).split(" - ")[0]) === t && num(x["Preço unitário"]));
      brutos.push({ ticker: t, op: { origem, data, tipo: "venda", quantidade: q, preco: leilao ? num(leilao["Preço unitário"])! : 0, nota: "B3 · Fração vendida em leilão" } });
    } else if (mov === "direitos de subscricao - exercido" && !credito && q && q > 0) {
      const base = baseDe(t);
      if (!base) { ignora("Subscrição exercida sem ativo correspondente"); avisos.push(`${t}: subscrição exercida em ${data} não foi associada a nenhum ativo.`); continue; }
      brutos.push({ ticker: base, op: { origem, data, tipo: "compra", quantidade: q, preco: pu ?? 0, nota: `B3 · Subscrição exercida (${t})` } });
    } else if (mov === "leilao de fracao") {
      ignora("Leilão de fração (usado como preço da fração vendida)");
    } else if (mov === "transferencia - liquidacao") {
      ignora("Liquidação de negócio (já está na Negociação)");
    } else {
      ignora(rotulo);
    }
  }

  // ---------- data de corte (posição inicial já gravada) ----------
  if (escolhas.corte) {
    const antes = brutos.filter((b) => b.op && b.op.data <= escolhas.corte!).length;
    if (antes) ignorados[`Operações até ${escolhas.corte.split("-").reverse().join("/")} (já na posição inicial)`] = antes;
    for (let i = brutos.length - 1; i >= 0; i--) if (brutos[i].op && brutos[i].op!.data <= escolhas.corte) brutos.splice(i, 1);
  }

  // ---------- trocas de código ----------
  const ren = escolhas.renomear ?? {};
  const destino = (t: string) => { let x = t; const vis = new Set<string>(); while (ren[x] && !vis.has(x)) { vis.add(x); x = ren[x]; } return x; };

  // ---------- agrupa ----------
  const ativos = new Map<string, AtivoPlano>();
  const pegar = (t: string) => {
    let a = ativos.get(t);
    if (!a) {
      const p = pos.get(t);
      a = { ticker: t, nome: p?.nome ?? nomes.get(t) ?? null, classe: p?.classe ?? classePorTicker(t), classeConfirmada: !!p,
        ops: [], proventos: [], qtdCalculada: 0, qtdB3: p?.qtd ?? 0, precoFechamento: p?.preco ?? null, precoMedio: 0, incorporou: [], ajuste: null };
      ativos.set(t, a);
    }
    return a;
  };
  for (const t of pos.keys()) pegar(t);
  for (const t of Object.keys(escolhas.base ?? {})) if (pos.has(t) || !dados.posicao.length) pegar(t);
  for (const b of brutos) {
    const final = destino(b.ticker);
    const a = pegar(final);
    if (final !== b.ticker && !a.incorporou.includes(b.ticker)) a.incorporou.push(b.ticker);
    if (b.op) a.ops.push(b.op);
    if (b.prov) a.proventos.push(b.prov);
  }

  // ---------- quantidades e ajustes ----------
  for (const a of ativos.values()) {
    const b = escolhas.base?.[a.ticker];
    const baseOp = b && b.qtd > 0 && escolhas.corte
      ? [{ id: "base", ativo_id: a.ticker, tipo: "compra", data: escolhas.corte, quantidade: b.qtd, preco: b.pm, taxas: 0, criado_em: "000000" } as Operacao]
      : [];
    const r = aplicarOperacoes([...baseOp, ...a.ops.map((o, i) => ({ ...o, id: String(i), ativo_id: a.ticker, taxas: 0, criado_em: String(i + 1).padStart(6, "0") }) as Operacao)]);
    a.qtdCalculada = Math.round(r.quantidade * 1e8) / 1e8;
    a.precoMedio = r.precoMedio;
    const ja = escolhas.ajustesExistentes?.[a.ticker] ?? 0;
    const dif = Math.round((a.qtdB3 - a.qtdCalculada - ja) * 1e8) / 1e8;
    if (!dados.posicao.length || Math.abs(dif) < 1e-6) continue;
    if (a.incorporou.length && a.qtdCalculada > 0 && a.qtdB3 > 0 && ja === 0) {
      // Incorporação com proporção diferente de 1:1: troca a quantidade mantendo o custo total
      const fator = dif < 0 ? a.qtdCalculada / a.qtdB3 : a.qtdB3 / a.qtdCalculada;
      const tipo = dif < 0 ? "grupamento" : "desdobramento";
      a.ajuste = { sugerido: true, origem: `b3a:${hash([a.ticker, tipo, fator.toFixed(10)].join("|"))}`, data: hoje, tipo, quantidade: fator, preco: 0,
        nota: `Ajuste de incorporação (${a.incorporou.join(", ")} → ${a.ticker}), mantém o custo total` };
    } else if (dif > 0) {
      const preco = escolhas.precoAjuste?.[a.ticker] ?? a.precoFechamento ?? a.precoMedio ?? 0;
      a.ajuste = { sugerido: true, origem: `b3a:${hash([a.ticker, "compra", dif, ja].join("|"))}`, data: hoje, tipo: "compra", quantidade: dif, preco,
        nota: "Ajuste de conciliação com a posição da B3" };
    } else {
      a.ajuste = { sugerido: true, origem: `b3a:${hash([a.ticker, "venda", -dif, ja].join("|"))}`, data: hoje, tipo: "venda", quantidade: -dif, preco: r.precoMedio,
        nota: "Ajuste de conciliação com a posição da B3 (pelo preço médio, sem lucro nem prejuízo)" };
    }
  }

  // ---------- sugestões de troca de código ----------
  // Ativo que "sobrou" (calculado > 0, B3 = 0) e outro que "falta" a mesma quantidade.
  const sugestoesTroca: SugestaoTroca[] = [];
  if (dados.posicao.length) {
    const sobra = [...ativos.values()].filter((a) => a.qtdB3 === 0 && a.qtdCalculada > 0);
    const falta = [...ativos.values()].filter((a) => a.qtdB3 > a.qtdCalculada);
    const usados = new Set<string>();
    for (const s of sobra) {
      const alvo = falta.find((f) => !usados.has(f.ticker) && Math.abs(f.qtdB3 - f.qtdCalculada - s.qtdCalculada) < 1e-6);
      if (alvo) { usados.add(alvo.ticker); sugestoesTroca.push({ de: s.ticker, para: alvo.ticker, motivo: `${s.qtdCalculada} cotas sem posição em ${s.ticker} e faltando exatamente ${s.qtdCalculada} em ${alvo.ticker}` }); }
    }
    // Código que vendeu mais do que recebeu (ex.: RRRP3 virou BRAV3 e as vendas saíram como BRAV3)
    for (const a of ativos.values()) {
      if (a.qtdB3 !== 0 || sugestoesTroca.some((s) => s.para === a.ticker)) continue;
      const entradas = a.ops.filter((o) => o.tipo === "compra" || o.tipo === "bonificacao").reduce((s, o) => s + o.quantidade, 0);
      const saidas = a.ops.filter((o) => o.tipo === "venda").reduce((s, o) => s + o.quantidade, 0);
      const excesso = Math.round((saidas - entradas) * 1e8) / 1e8;
      if (excesso <= 1e-6 || a.ops.some((o) => o.tipo === "desdobramento" || o.tipo === "grupamento")) continue;
      const origemT = [...ativos.values()].find((x) => x !== a && x.qtdB3 === 0 && Math.abs(x.qtdCalculada - excesso) < 1e-6 && !sugestoesTroca.some((s) => s.de === x.ticker));
      if (origemT) sugestoesTroca.push({ de: origemT.ticker, para: a.ticker, motivo: `${a.ticker} vendeu ${excesso} cotas a mais do que comprou; ${origemT.ticker} tem exatamente essa quantidade` });
    }
  }

  if (!dados.posicao.length) avisos.push("Sem o relatório de Posição, não dá para conferir as quantidades nem importar renda fixa e Tesouro.");

  return {
    corte: escolhas.corte ?? null,
    ativos: [...ativos.values()].filter((a) => a.ops.length || a.proventos.length || a.qtdB3 > 0 || a.ajuste).sort((x, y) => x.ticker.localeCompare(y.ticker)),
    rendaFixa,
    sugestoesTroca,
    ignorados,
    avisos,
    temPosicao: dados.posicao.length > 0,
    contagem: { negociacoes: dados.negociacao.length, movimentacoes: dados.movimentacao.length },
  };
}
