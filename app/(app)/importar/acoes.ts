"use server";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { userForAction } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { dataSP } from "@/lib/cotacoes";
import { lerArquivosB3, type ArquivosB3 } from "@/lib/b3/planilha";
import { montarPlano, type Escolhas } from "@/lib/b3/montar";
import { lerInvestidor10, ehCsvInvestidor10 } from "@/lib/investidor10";

// A Vercel limita o corpo da requisição a 4,5 MB
const MAX_TOTAL = 4 * 1024 * 1024;
const CLASSES = ["acao", "fii", "etf", "bdr", "renda_fixa", "tesouro", "cripto", "exterior", "reit", "etf_exterior", "outros"] as const;
const hash = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);
const pedacos = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function lerForm(fd: FormData): Promise<{ dados: ArquivosB3 } | { erro: string }> {
  const arquivos = fd.getAll("arquivos").filter((f): f is File => f instanceof File && f.size > 0);
  if (!arquivos.length) return { erro: "Escolha os arquivos .xlsx exportados da B3." };
  if (arquivos.length > 5) return { erro: "Envie no máximo 5 arquivos." };
  if (arquivos.reduce((s, f) => s + f.size, 0) > MAX_TOTAL) return { erro: "Os arquivos somam mais de 4 MB. Envie um período menor ou um arquivo por vez." };
  const lidos: { nome: string; bytes: Uint8Array }[] = [];
  for (const f of arquivos) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return { erro: `${f.name}: não é uma planilha .xlsx.` };
    lidos.push({ nome: f.name.slice(0, 100), bytes });
  }
  const dados = await lerArquivosB3(lidos);
  if (!dados.negociacao.length && !dados.movimentacao.length && !dados.posicao.length) {
    return { erro: "Nenhum relatório da B3 reconhecido. Use Negociação, Movimentação ou Posição exportados em Excel." };
  }
  return { dados };
}

const EscolhasSchema = z.object({
  renomear: z.record(z.string().max(12), z.string().max(12)).default({}),
  precoAjuste: z.record(z.string().max(12), z.number().nonnegative().finite()).default({}),
  excluir: z.array(z.string().max(40)).max(1000).default([]),
  classes: z.record(z.string().max(12), z.enum(CLASSES)).default({}),
  semAjuste: z.array(z.string().max(12)).max(1000).default([]),
  rendaFixa: z.boolean().default(true),
  proventos: z.boolean().default(true),
  resgatar: z.array(z.string().max(40)).max(500).default([]),
});
export type EscolhasB3 = z.input<typeof EscolhasSchema>;

/** Soma dos ajustes de conciliação já gravados (origem b3a:), por ticker. */
async function ajustesGravados(sb: NonNullable<Awaited<ReturnType<typeof userForAction>>>["supabase"]) {
  const { data: ops } = await sb.from("operacoes").select("ativo_id,tipo,quantidade").like("origem", "b3a:%");
  if (!ops?.length) return {};
  const idsA = [...new Set(ops.map((o) => o.ativo_id as string))];
  const tick = new Map<string, string>();
  for (const parte of pedacos(idsA, 200)) {
    const { data } = await sb.from("ativos").select("id,ticker").in("id", parte);
    for (const a of data ?? []) tick.set(a.id as string, a.ticker as string);
  }
  const out: Record<string, number> = {};
  for (const o of ops) {
    const t = tick.get(o.ativo_id as string); if (!t) continue;
    if (o.tipo !== "compra" && o.tipo !== "venda") continue; // fatores não somam quantidade
    out[t] = (out[t] ?? 0) + (o.tipo === "venda" ? -1 : 1) * Number(o.quantidade);
  }
  return out;
}

/** Posição inicial gravada pela importação do Investidor10 (origem i10:): data de corte e base por ticker. */
async function posicaoInicial(sb: NonNullable<Awaited<ReturnType<typeof userForAction>>>["supabase"]) {
  const { data: ops } = await sb.from("operacoes").select("ativo_id,data,quantidade,preco").like("origem", "i10:%");
  if (!ops?.length) return { corte: undefined, base: undefined };
  const corte = ops.reduce((m, o) => (String(o.data) > m ? String(o.data) : m), "");
  const tick = new Map<string, string>();
  for (const parte of pedacos([...new Set(ops.map((o) => o.ativo_id as string))], 200)) {
    const { data } = await sb.from("ativos").select("id,ticker").in("id", parte);
    for (const a of data ?? []) tick.set(a.id as string, a.ticker as string);
  }
  const base: Record<string, { qtd: number; pm: number }> = {};
  for (const o of ops) {
    const t = tick.get(o.ativo_id as string); if (!t) continue;
    const b = base[t] ?? { qtd: 0, pm: 0 };
    const q = Number(o.quantidade), pr = Number(o.preco);
    base[t] = { qtd: b.qtd + q, pm: b.qtd + q > 0 ? (b.qtd * b.pm + q * pr) / (b.qtd + q) : 0 };
  }
  return { corte, base };
}

function escolhasDe(fd: FormData) {
  try { return EscolhasSchema.parse(JSON.parse(String(fd.get("escolhas") ?? "{}"))); }
  catch { return EscolhasSchema.parse({}); }
}

// ---------------------------------------------------------------------
// Prévia (nada é gravado)
// ---------------------------------------------------------------------
export type PreviaB3 = {
  corte: string | null;
  ativos: {
    ticker: string; nome: string | null; classe: string; classeConfirmada: boolean;
    compras: number; vendas: number; eventos: number; proventos: number; totalProventos: number;
    qtdCalculada: number; qtdB3: number; precoMedio: number; precoFechamento: number | null; incorporou: string[];
    ajuste: { tipo: "compra" | "venda" | "grupamento" | "desdobramento"; quantidade: number; preco: number } | null;
    existe: { classe: string; opsManuais: number } | null;
  }[];
  rendaFixa: { ticker: string; nome: string; classe: string; valorAtual: number; valorAplicado: number | null; existe: boolean }[];
  sairam: { ticker: string; nome: string | null; valor: number }[];
  sugestoesTroca: { de: string; para: string; motivo: string }[];
  ignorados: Record<string, number>;
  avisos: string[];
  temPosicao: boolean;
  contagem: { negociacoes: number; movimentacoes: number };
  desconhecidos: string[];
};

export async function previaB3(fd: FormData): Promise<PreviaB3 | { erro: string }> {
  const u = await userForAction(); if (!u) return { erro: "Sessão expirada. Entre de novo." };
  const lido = await lerForm(fd); if ("erro" in lido) return lido;
  const esc = escolhasDe(fd);
  const ajustesExistentes = await ajustesGravados(u.supabase);
  const inicial = await posicaoInicial(u.supabase);
  const plano = montarPlano(lido.dados, { renomear: esc.renomear, precoAjuste: esc.precoAjuste, ajustesExistentes, ...inicial } satisfies Escolhas, dataSP());

  const tickers = [...plano.ativos.map((a) => a.ticker), ...plano.rendaFixa.map((r) => r.ticker)];
  const existentes = new Map<string, { id: string; classe: string }>();
  for (const parte of pedacos(tickers, 200)) {
    const { data } = await u.supabase.from("ativos").select("id,ticker,classe").in("ticker", parte);
    for (const a of data ?? []) existentes.set(a.ticker as string, { id: a.id as string, classe: a.classe as string });
  }
  // operações lançadas fora da importação da B3 (podem duplicar)
  const manuais = new Map<string, number>();
  const ids = [...existentes.values()].map((e) => e.id);
  for (const parte of pedacos(ids, 200)) {
    const { data } = await u.supabase.from("operacoes").select("ativo_id").in("ativo_id", parte).or("origem.is.null,origem.not.like.b3*");
    for (const o of data ?? []) manuais.set(o.ativo_id as string, (manuais.get(o.ativo_id as string) ?? 0) + 1);
  }
  // renda fixa importada antes que não aparece mais na posição (vencida/resgatada)
  const sairam: PreviaB3["sairam"] = [];
  if (plano.temPosicao) {
    const { data: rfOps } = await u.supabase.from("operacoes").select("ativo_id").like("origem", "b3p:%");
    const rfIds = [...new Set((rfOps ?? []).map((o) => o.ativo_id as string))];
    const { data: resg } = await u.supabase.from("operacoes").select("ativo_id").like("origem", "b3r:%");
    const jaResgatados = new Set((resg ?? []).map((o) => o.ativo_id as string));
    const atuais = new Set(plano.rendaFixa.map((r) => r.ticker));
    for (const parte of pedacos(rfIds.filter((id) => !jaResgatados.has(id)), 200)) {
      const { data } = await u.supabase.from("ativos").select("ticker,nome,preco_manual").in("id", parte);
      for (const a of data ?? []) if (!atuais.has(a.ticker as string)) sairam.push({ ticker: a.ticker as string, nome: a.nome as string | null, valor: Number(a.preco_manual ?? 0) });
    }
  }

  return {
    corte: plano.corte,
    ativos: plano.ativos.map((a) => {
      const e = existentes.get(a.ticker);
      return {
        ticker: a.ticker, nome: a.nome, classe: a.classe, classeConfirmada: a.classeConfirmada,
        compras: a.ops.filter((o) => o.tipo === "compra").length, vendas: a.ops.filter((o) => o.tipo === "venda").length,
        eventos: a.ops.filter((o) => o.tipo === "bonificacao").length,
        proventos: a.proventos.length, totalProventos: a.proventos.reduce((s, p) => s + p.valor, 0),
        qtdCalculada: a.qtdCalculada, qtdB3: a.qtdB3, precoMedio: a.precoMedio, precoFechamento: a.precoFechamento, incorporou: a.incorporou,
        ajuste: a.ajuste ? { tipo: a.ajuste.tipo as "compra" | "venda" | "grupamento" | "desdobramento", quantidade: a.ajuste.quantidade, preco: a.ajuste.preco } : null,
        existe: e ? { classe: e.classe, opsManuais: manuais.get(e.id) ?? 0 } : null,
      };
    }),
    rendaFixa: plano.rendaFixa.map((r) => ({ ticker: r.ticker, nome: r.nome, classe: r.classe, valorAtual: r.valorAtual, valorAplicado: r.valorAplicado, existe: existentes.has(r.ticker) })),
    sairam,
    sugestoesTroca: plano.sugestoesTroca,
    ignorados: plano.ignorados,
    avisos: plano.avisos,
    temPosicao: plano.temPosicao,
    contagem: plano.contagem,
    desconhecidos: lido.dados.desconhecidos,
  };
}

// ---------------------------------------------------------------------
// Importação (relê os arquivos no servidor e aplica as escolhas)
// ---------------------------------------------------------------------
export async function importarB3(fd: FormData): Promise<{ ok?: string; erro?: string }> {
  const u = await userForAction(); if (!u) return { erro: "Sessão expirada. Entre de novo." };
  const lido = await lerForm(fd); if ("erro" in lido) return lido;
  const esc = escolhasDe(fd);
  const hoje = dataSP();
  const ajustesExistentes = await ajustesGravados(u.supabase);
  const inicial = await posicaoInicial(u.supabase);
  const plano = montarPlano(lido.dados, { renomear: esc.renomear, precoAjuste: esc.precoAjuste, ajustesExistentes, ...inicial }, hoje);
  const sb = u.supabase;
  const excluir = new Set(esc.excluir);
  const semAjuste = new Set(esc.semAjuste);
  const ativosRV = plano.ativos.filter((a) => !excluir.has(a.ticker));
  const rf = esc.rendaFixa ? plano.rendaFixa.filter((r) => !excluir.has(r.ticker)) : [];

  // 1. ativos: cria os que faltam (classe escolhida); renda fixa atualiza o preço
  const ids = new Map<string, string>();
  const todos = [...ativosRV.map((a) => a.ticker), ...rf.map((r) => r.ticker)];
  for (const parte of pedacos(todos, 200)) {
    const { data } = await sb.from("ativos").select("id,ticker").in("ticker", parte);
    for (const a of data ?? []) ids.set(a.ticker as string, a.id as string);
  }
  const agora = new Date().toISOString();
  const novos = [
    ...ativosRV.filter((a) => !ids.has(a.ticker)).map((a) => ({ ticker: a.ticker, nome: a.nome?.slice(0, 120) ?? null, classe: esc.classes[a.ticker] ?? a.classe, moeda: "BRL" })),
    ...rf.filter((r) => !ids.has(r.ticker)).map((r) => ({ ticker: r.ticker, nome: r.nome, classe: r.classe, moeda: "BRL", preco_manual: r.valorAtual, preco_manual_em: agora })),
  ];
  for (const parte of pedacos(novos, 200)) {
    const { data, error } = await sb.from("ativos").insert(parte).select("id,ticker");
    if (error) return { erro: "Não foi possível criar os ativos: " + (error.message.includes("duplicate") ? "ticker repetido." : "tente de novo.") };
    for (const a of data ?? []) ids.set(a.ticker as string, a.id as string);
  }
  for (const r of rf.filter((r) => novos.every((n) => n.ticker !== r.ticker))) {
    await sb.from("ativos").update({ preco_manual: r.valorAtual, preco_manual_em: agora }).eq("id", ids.get(r.ticker)!);
  }

  // 2. operações
  type LinhaOp = { ativo_id: string; tipo: string; data: string; quantidade: number; preco: number; taxas: number; origem: string; nota: string };
  const ops: LinhaOp[] = [];
  for (const a of ativosRV) {
    const id = ids.get(a.ticker)!;
    for (const o of a.ops) ops.push({ ativo_id: id, tipo: o.tipo, data: o.data, quantidade: o.quantidade, preco: o.preco, taxas: 0, origem: o.origem, nota: o.nota });
    if (a.ajuste && !semAjuste.has(a.ticker)) {
      const o = a.ajuste;
      ops.push({ ativo_id: id, tipo: o.tipo, data: o.data, quantidade: o.quantidade, preco: o.preco, taxas: 0, origem: o.origem, nota: o.nota });
    }
  }
  const rfNovos = new Set(novos.map((n) => n.ticker));
  for (const r of rf) {
    if (!rfNovos.has(r.ticker)) continue; // já existe: só atualiza o preço (feito acima)
    ops.push({ ativo_id: ids.get(r.ticker)!, tipo: "compra", data: r.data, quantidade: 1, preco: r.valorAplicado ?? r.valorAtual, taxas: 0, origem: r.origem,
      nota: r.valorAplicado == null ? "B3 · Posição (a B3 não informa o valor aplicado: custo = valor atual; edite se souber)" : "B3 · Posição" });
  }
  // renda fixa que saiu da posição → resgate pelo último valor
  if (esc.resgatar.length) {
    const { data } = await sb.from("ativos").select("id,ticker,preco_manual").in("ticker", esc.resgatar.slice(0, 500));
    for (const a of data ?? []) {
      ops.push({ ativo_id: a.id as string, tipo: "venda", data: hoje, quantidade: 1, preco: Number(a.preco_manual ?? 0), taxas: 0,
        origem: `b3r:${hash(String(a.ticker))}`, nota: "B3 · Saiu da posição (vencimento/resgate)" });
    }
  }
  let novasOps = 0;
  for (const parte of pedacos(ops, 500)) {
    const { data, error } = await sb.from("operacoes").upsert(parte, { onConflict: "user_id,origem", ignoreDuplicates: true }).select("id");
    if (error) return { erro: `Erro ao gravar operações (${novasOps} gravadas até aqui). Tente de novo: as já gravadas não duplicam.` };
    novasOps += data?.length ?? 0;
  }

  // 3. proventos
  let novosProv = 0;
  if (esc.proventos) {
    const provs = ativosRV.flatMap((a) => a.proventos.map((p) => ({ ativo_id: ids.get(a.ticker)!, tipo: p.tipo, data_pagamento: p.data, valor_total: Math.round(p.valor * 100) / 100, origem: p.origem })))
      .filter((p) => p.valor_total > 0);
    for (const parte of pedacos(provs, 500)) {
      const { data, error } = await sb.from("proventos").upsert(parte, { onConflict: "user_id,origem", ignoreDuplicates: true }).select("id");
      if (error) return { erro: `Erro ao gravar proventos (${novosProv} gravados até aqui). Tente de novo: os já gravados não duplicam.` };
      novosProv += data?.length ?? 0;
    }
  }

  // 4. preço de fechamento da posição como cotação inicial (dado público de mercado)
  const cot = ativosRV.filter((a) => a.precoFechamento && a.precoFechamento > 0).map((a) => ({ ticker: a.ticker, data: hoje, fechamento: a.precoFechamento!, atualizado_em: agora }));
  if (cot.length) {
    try {
      const admin = createAdminClient();
      // não sobrescreve cotação já existente do dia (vinda da brapi)
      await admin.from("cotacoes").upsert(cot, { onConflict: "ticker,data", ignoreDuplicates: true });
    } catch { /* a rotina diária completa */ }
  }

  revalidatePath("/", "layout");
  const ja = ops.length - novasOps;
  return {
    ok: `Importado: ${novasOps} operação(ões), ${novosProv} provento(s), ${novos.length} ativo(s) novo(s).` +
      (ja > 0 ? ` ${ja} operação(ões) já existiam e foram ignoradas.` : ""),
  };
}

// ---------------------------------------------------------------------
// Posição inicial do Investidor10 (CSV)
// ---------------------------------------------------------------------
export type PreviaI10 = {
  posicoes: { ticker: string; categoria: string; classe: string; moeda: string; quantidade: number; precoMedio: number; saldo: number;
    observacao: string | null; existe: boolean; jaImportado: boolean }[];
  avisos: string[];
  ignoradas: string[];
  corteExistente: string | null;
};

async function lerCsvI10(fd: FormData): Promise<{ texto: string } | { erro: string }> {
  const f = fd.get("arquivo");
  if (!(f instanceof File) || f.size === 0) return { erro: "Escolha o arquivo .csv exportado do Investidor10." };
  if (f.size > 2 * 1024 * 1024) return { erro: "Arquivo maior que 2 MB." };
  const texto = await f.text();
  if (!ehCsvInvestidor10(texto)) return { erro: "Não parece a exportação de posições do Investidor10 (faltam as colunas Tipo de ativo, Preço Médio e Saldo)." };
  return { texto };
}

export async function previaI10(fd: FormData): Promise<PreviaI10 | { erro: string }> {
  const u = await userForAction(); if (!u) return { erro: "Sessão expirada. Entre de novo." };
  const lido = await lerCsvI10(fd); if ("erro" in lido) return lido;
  const r = lerInvestidor10(lido.texto);
  if (!r.posicoes.length) return { erro: "Nenhuma posição encontrada no arquivo." };
  const existentes = new Set<string>();
  for (const parte of pedacos(r.posicoes.map((p) => p.ticker), 200)) {
    const { data } = await u.supabase.from("ativos").select("ticker").in("ticker", parte);
    for (const a of data ?? []) existentes.add(a.ticker as string);
  }
  const ja = new Set<string>();
  for (const parte of pedacos(r.posicoes.map((p) => p.origem), 200)) {
    const { data } = await u.supabase.from("operacoes").select("origem").in("origem", parte);
    for (const o of data ?? []) ja.add(o.origem as string);
  }
  const { corte } = await posicaoInicial(u.supabase);
  return {
    posicoes: r.posicoes.map((p) => ({ ticker: p.ticker, categoria: p.categoria, classe: p.classe, moeda: p.moeda, quantidade: p.quantidade,
      precoMedio: p.precoMedio, saldo: p.saldo, observacao: p.observacao, existe: existentes.has(p.ticker), jaImportado: ja.has(p.origem) })),
    avisos: r.avisos, ignoradas: r.ignoradas, corteExistente: corte ?? null,
  };
}

const I10Schema = z.object({
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  excluir: z.array(z.string().max(40)).max(2000).default([]),
});

export async function importarI10(fd: FormData): Promise<{ ok?: string; erro?: string }> {
  const u = await userForAction(); if (!u) return { erro: "Sessão expirada. Entre de novo." };
  const lido = await lerCsvI10(fd); if ("erro" in lido) return lido;
  let esc: z.infer<typeof I10Schema>;
  try { esc = I10Schema.parse(JSON.parse(String(fd.get("escolhas") ?? "{}"))); } catch { return { erro: "Informe a data da posição." }; }
  // o Investidor10 nomeia o arquivo pela data UTC: aceita até amanhã
  if (esc.data > dataSP(new Date(Date.now() + 86_400_000))) return { erro: "A data da posição não pode ser no futuro." };
  const sb = u.supabase;
  const excluir = new Set(esc.excluir);
  const pos = lerInvestidor10(lido.texto).posicoes.filter((p) => !excluir.has(p.ticker));
  const agora = new Date().toISOString();

  // ativos
  const ids = new Map<string, string>();
  for (const parte of pedacos(pos.map((p) => p.ticker), 200)) {
    const { data } = await sb.from("ativos").select("id,ticker").in("ticker", parte);
    for (const a of data ?? []) ids.set(a.ticker as string, a.id as string);
  }
  const novos = pos.filter((p) => !ids.has(p.ticker)).map((p) => ({
    ticker: p.ticker, nome: p.nome, classe: p.classe, moeda: p.moeda,
    preco_manual: p.precoManual ? p.precoAtual : null, preco_manual_em: p.precoManual ? agora : null,
  }));
  for (const parte of pedacos(novos, 200)) {
    const { data, error } = await sb.from("ativos").insert(parte).select("id,ticker");
    if (error) return { erro: "Não foi possível criar os ativos. Tente de novo." };
    for (const a of data ?? []) ids.set(a.ticker as string, a.id as string);
  }
  for (const p of pos.filter((p) => p.precoManual && novos.every((n) => n.ticker !== p.ticker))) {
    await sb.from("ativos").update({ preco_manual: p.precoAtual, preco_manual_em: agora }).eq("id", ids.get(p.ticker)!);
  }

  // posição inicial = uma compra na data da posição, pelo preço médio
  const ops = pos.map((p) => ({
    ativo_id: ids.get(p.ticker)!, tipo: "compra", data: esc.data, quantidade: p.quantidade, preco: p.precoMedio, taxas: 0,
    origem: p.origem, nota: "Posição inicial · Investidor10" + (p.observacao ? ` (${p.observacao})` : ""),
  }));
  let n = 0;
  for (const parte of pedacos(ops, 500)) {
    const { data, error } = await sb.from("operacoes").upsert(parte, { onConflict: "user_id,origem", ignoreDuplicates: true }).select("id");
    if (error) return { erro: `Erro ao gravar (${n} gravadas até aqui). Tente de novo: as já gravadas não duplicam.` };
    n += data?.length ?? 0;
  }

  // preço atual do arquivo como cotação inicial (dado de mercado)
  const cot = pos.filter((p) => !p.precoManual && p.precoAtual > 0)
    .map((p) => ({ ticker: p.moeda === "USD" ? `US:${p.ticker}` : p.ticker, data: esc.data, fechamento: p.precoAtual, atualizado_em: agora }));
  if (cot.length) {
    try { await createAdminClient().from("cotacoes").upsert(cot, { onConflict: "ticker,data", ignoreDuplicates: true }); } catch { /* rotina diária */ }
  }

  revalidatePath("/", "layout");
  return { ok: `Posição inicial importada: ${n} ativo(s) em ${esc.data.split("-").reverse().join("/")}` + (ops.length - n ? ` · ${ops.length - n} já existiam` : "") + "." };
}
