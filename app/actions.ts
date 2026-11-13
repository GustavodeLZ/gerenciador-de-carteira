"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { userForAction } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { atualizarIndices, completarHistorico } from "@/lib/historico";
import { atualizarCotacoes, preencherCambios, ptax, ptaxDatas } from "@/lib/cotacoes";
import { reservar, LIMITES } from "@/lib/limites";
import { parseNum, temCotacaoAuto, type Moeda } from "@/lib/carteira";
import { lerNotaPdf, NotaErro, type NotaLida } from "@/lib/notas";

export type Resultado = { ok?: string; erro?: string } | null;

const MOEDAS = ["BRL", "USD"] as const;
const CLASSES = ["acao", "fii", "etf", "bdr", "renda_fixa", "tesouro", "cripto", "exterior", "reit", "etf_exterior", "outros"] as const;
const TIPOS_OP = ["compra", "venda", "desdobramento", "grupamento", "bonificacao"] as const;
const TIPOS_PROV = ["dividendo", "jcp", "rendimento", "juros", "outro"] as const;

const uuid = z.string().uuid();
const num = (opts: { min?: number; opcional?: boolean } = {}) =>
  z.preprocess(
    (v) => (v === "" || v == null ? undefined : parseNum(v)),
    opts.opcional
      ? z.number().finite().min(opts.min ?? 0).optional()
      : z.number({ message: "Número inválido" }).finite().min(opts.min ?? 0),
  );
const texto = (max: number) => z.preprocess((v) => (typeof v === "string" ? v.trim() || undefined : undefined), z.string().max(max).optional());
const ticker = z.string().trim().toUpperCase().min(1, "Informe o ticker").max(40).regex(/^[A-Z0-9 .\-_/+&]+$/, "Ticker com caracteres inválidos");
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida");

function obj(fd: FormData) {
  return Object.fromEntries([...fd.keys()].map((k) => [k, fd.getAll(k).length > 1 ? fd.getAll(k) : fd.get(k)]));
}
function primeiroErro(e: z.ZodError) {
  return e.issues[0]?.message ?? "Dados inválidos";
}
function erroBanco(msg: string) {
  if (msg.includes("duplicate key")) return "Já existe um registro com esse nome/ticker.";
  if (msg.includes("inválido")) return msg;
  return "Não foi possível salvar. Tente de novo.";
}
function pronto(msg: string): Resultado {
  revalidatePath("/", "layout");
  return { ok: msg };
}

// ---------- ativos ----------
const AtivoSchema = z.object({
  id: uuid.optional().or(z.literal("").transform(() => undefined)),
  ticker,
  nome: texto(120),
  classe: z.enum(CLASSES),
  moeda: z.enum(MOEDAS).default("BRL"),
  preco_manual: num({ opcional: true }),
});

export async function salvarAtivo(_: Resultado, fd: FormData): Promise<Resultado> {
  const u = await userForAction(); if (!u) return { erro: "Sessão expirada. Entre de novo." };
  const p = AtivoSchema.safeParse(obj(fd)); if (!p.success) return { erro: primeiroErro(p.error) };
  const { id, preco_manual, ...rest } = p.data;
  const linha = {
    ...rest, nome: rest.nome ?? null,
    preco_manual: preco_manual ?? null,
    preco_manual_em: preco_manual != null ? new Date().toISOString() : null,
  };
  const q = id ? u.supabase.from("ativos").update(linha).eq("id", id) : u.supabase.from("ativos").insert(linha);
  const { error } = await q;
  if (error) return { erro: erroBanco(error.message) };
  return pronto("Ativo salvo");
}

export async function excluirAtivo(id: string): Promise<Resultado> {
  const u = await userForAction(); if (!u || !uuid.safeParse(id).success) return { erro: "Não autorizado" };
  const { error } = await u.supabase.from("ativos").delete().eq("id", id);
  if (error) return { erro: erroBanco(error.message) };
  revalidatePath("/", "layout");
  redirect("/ativos");
}

// ---------- operações ----------
const OperacaoSchema = z.object({
  ativo_id: z.string().optional(),
  novo_ticker: z.string().optional(),
  nova_classe: z.enum(CLASSES).optional(),
  nova_moeda: z.enum(MOEDAS).optional(),
  tipo: z.enum(TIPOS_OP),
  data,
  quantidade: num({ min: 0.00000001 }),
  preco: num({ opcional: true }),
  taxas: num({ opcional: true }),
  cambio: num({ opcional: true }),
  nota: texto(300),
  segmentos: z.union([z.string(), z.array(z.string())]).optional(),
});

export async function adicionarOperacao(_: Resultado, fd: FormData): Promise<Resultado> {
  const u = await userForAction(); if (!u) return { erro: "Sessão expirada. Entre de novo." };
  const p = OperacaoSchema.safeParse(obj(fd)); if (!p.success) return { erro: primeiroErro(p.error) };
  const d = p.data;
  if ((d.tipo === "compra" || d.tipo === "venda") && !(d.preco! > 0)) return { erro: "Informe o preço unitário" };

  let ativoId = d.ativo_id && d.ativo_id !== "__novo" ? d.ativo_id : undefined;
  if (ativoId && !uuid.safeParse(ativoId).success) return { erro: "Ativo inválido" };
  if (!ativoId) {
    const t = ticker.safeParse(d.novo_ticker ?? ""); if (!t.success) return { erro: primeiroErro(t.error) };
    if (!d.nova_classe) return { erro: "Escolha a classe do novo ativo" };
    const { data: existente } = await u.supabase.from("ativos").select("id").eq("ticker", t.data).maybeSingle();
    if (existente) ativoId = existente.id;
    else {
      const { data: novo, error } = await u.supabase.from("ativos")
        .insert({ ticker: t.data, classe: d.nova_classe, moeda: d.nova_moeda ?? "BRL" }).select("id").single();
      if (error || !novo) return { erro: erroBanco(error?.message ?? "") };
      ativoId = novo.id;
    }
  }
  // Ativo em dólar: guarda o câmbio do dia (PTAX) se não foi informado
  const { data: info } = await u.supabase.from("ativos").select("moeda").eq("id", ativoId).single();
  let cambio: number | null = null;
  if (info?.moeda === "USD") cambio = d.cambio && d.cambio > 0 ? d.cambio : (await ptax(d.data))?.valor ?? null;

  const { error } = await u.supabase.from("operacoes").insert({
    ativo_id: ativoId, tipo: d.tipo, data: d.data, quantidade: d.quantidade,
    preco: d.preco ?? 0, taxas: d.taxas ?? 0, nota: d.nota ?? null, cambio,
  });
  if (error) return { erro: erroBanco(error.message) };

  const segs = [d.segmentos ?? []].flat().filter((s) => uuid.safeParse(s).success);
  if (segs.length) {
    await u.supabase.from("segmento_ativos").upsert(
      segs.map((segmento_id) => ({ segmento_id, ativo_id: ativoId })), { onConflict: "segmento_id,ativo_id", ignoreDuplicates: true });
  }
  return pronto(info?.moeda === "USD" && !cambio ? "Operação registrada (sem PTAX do dia: usando o dólar atual)" : "Operação registrada");
}

export async function excluirOperacao(id: string): Promise<Resultado> {
  const u = await userForAction(); if (!u || !uuid.safeParse(id).success) return { erro: "Não autorizado" };
  const { error } = await u.supabase.from("operacoes").delete().eq("id", id);
  if (error) return { erro: erroBanco(error.message) };
  return pronto("Operação excluída");
}

// ---------- proventos ----------
const ProventoSchema = z.object({ ativo_id: uuid, tipo: z.enum(TIPOS_PROV), data_pagamento: data, valor_total: num({ min: 0.01 }) });

export async function adicionarProvento(_: Resultado, fd: FormData): Promise<Resultado> {
  const u = await userForAction(); if (!u) return { erro: "Sessão expirada. Entre de novo." };
  const p = ProventoSchema.safeParse(obj(fd)); if (!p.success) return { erro: primeiroErro(p.error) };
  const { error } = await u.supabase.from("proventos").insert(p.data);
  if (error) return { erro: erroBanco(error.message) };
  return pronto("Provento registrado");
}

export async function excluirProvento(id: string): Promise<Resultado> {
  const u = await userForAction(); if (!u || !uuid.safeParse(id).success) return { erro: "Não autorizado" };
  const { error } = await u.supabase.from("proventos").delete().eq("id", id);
  if (error) return { erro: erroBanco(error.message) };
  return pronto("Provento excluído");
}

// ---------- segmentos ----------
const SegmentoSchema = z.object({
  id: uuid.optional().or(z.literal("").transform(() => undefined)),
  nome: z.string().trim().min(1, "Dê um nome ao segmento").max(60),
  descricao: texto(200),
  meta_pct: num({ opcional: true }).refine((v) => v == null || v <= 100, "Meta deve ser até 100%"),
});

export async function salvarSegmento(_: Resultado, fd: FormData): Promise<Resultado> {
  const u = await userForAction(); if (!u) return { erro: "Sessão expirada. Entre de novo." };
  const p = SegmentoSchema.safeParse(obj(fd)); if (!p.success) return { erro: primeiroErro(p.error) };
  const { id, ...rest } = p.data;
  const linha = { nome: rest.nome, descricao: rest.descricao ?? null, meta_pct: rest.meta_pct ?? null };
  if (id) {
    const { error } = await u.supabase.from("segmentos").update(linha).eq("id", id);
    if (error) return { erro: erroBanco(error.message) };
    return pronto("Segmento salvo");
  }
  const { data: novo, error } = await u.supabase.from("segmentos").insert(linha).select("id").single();
  if (error || !novo) return { erro: erroBanco(error?.message ?? "") };
  revalidatePath("/", "layout");
  redirect(`/segmentos?s=${novo.id}`);
}

export async function excluirSegmento(id: string): Promise<Resultado> {
  const u = await userForAction(); if (!u || !uuid.safeParse(id).success) return { erro: "Não autorizado" };
  const { error } = await u.supabase.from("segmentos").delete().eq("id", id);
  if (error) return { erro: erroBanco(error.message) };
  revalidatePath("/", "layout");
  redirect("/segmentos");
}

export async function vincularAtivo(segmentoId: string, ativoId: string): Promise<Resultado> {
  const u = await userForAction(); if (!u || !uuid.safeParse(segmentoId).success || !uuid.safeParse(ativoId).success) return { erro: "Não autorizado" };
  const { error } = await u.supabase.from("segmento_ativos").upsert({ segmento_id: segmentoId, ativo_id: ativoId }, { onConflict: "segmento_id,ativo_id", ignoreDuplicates: true });
  if (error) return { erro: erroBanco(error.message) };
  return pronto("Ativo adicionado ao segmento");
}

export async function vincularAtivos(segmentoId: string, ativoIds: string[]): Promise<Resultado> {
  const u = await userForAction();
  const ids = Array.isArray(ativoIds) ? [...new Set(ativoIds)].filter((i) => uuid.safeParse(i).success).slice(0, 1000) : [];
  if (!u || !uuid.safeParse(segmentoId).success) return { erro: "Não autorizado" };
  if (!ids.length) return { erro: "Nenhum ativo selecionado" };
  const { error } = await u.supabase.from("segmento_ativos")
    .upsert(ids.map((ativo_id) => ({ segmento_id: segmentoId, ativo_id })), { onConflict: "segmento_id,ativo_id", ignoreDuplicates: true });
  if (error) return { erro: erroBanco(error.message) };
  return pronto(ids.length === 1 ? "Ativo adicionado ao segmento" : `${ids.length} ativos adicionados ao segmento`);
}

export async function desvincularAtivo(segmentoId: string, ativoId: string): Promise<Resultado> {
  const u = await userForAction(); if (!u || !uuid.safeParse(segmentoId).success || !uuid.safeParse(ativoId).success) return { erro: "Não autorizado" };
  const { error } = await u.supabase.from("segmento_ativos").delete().eq("segmento_id", segmentoId).eq("ativo_id", ativoId);
  if (error) return { erro: erroBanco(error.message) };
  return pronto("Removido do segmento");
}

export async function definirSegmentosDoAtivo(ativoId: string, _: Resultado, fd: FormData): Promise<Resultado> {
  const u = await userForAction(); if (!u || !uuid.safeParse(ativoId).success) return { erro: "Não autorizado" };
  const marcados = fd.getAll("segmentos").map(String).filter((s) => uuid.safeParse(s).success);
  const { data: atuais } = await u.supabase.from("segmento_ativos").select("segmento_id").eq("ativo_id", ativoId);
  const ja = new Set((atuais ?? []).map((r) => r.segmento_id as string));
  const remover = [...ja].filter((s) => !marcados.includes(s));
  const adicionar = marcados.filter((s) => !ja.has(s));
  if (remover.length) await u.supabase.from("segmento_ativos").delete().eq("ativo_id", ativoId).in("segmento_id", remover);
  if (adicionar.length) {
    const { error } = await u.supabase.from("segmento_ativos").insert(adicionar.map((segmento_id) => ({ segmento_id, ativo_id: ativoId })));
    if (error) return { erro: erroBanco(error.message) };
  }
  return pronto("Segmentos atualizados");
}

export async function definirMetaAtivo(segmentoId: string, ativoId: string, valor: string): Promise<Resultado> {
  const u = await userForAction(); if (!u || !uuid.safeParse(segmentoId).success || !uuid.safeParse(ativoId).success) return { erro: "Não autorizado" };
  const n = valor.trim() === "" ? null : parseNum(valor);
  if (n != null && (!isFinite(n) || n < 0 || n > 100)) return { erro: "Meta entre 0 e 100" };
  const { error } = await u.supabase.from("segmento_ativos").update({ meta_pct: n }).eq("segmento_id", segmentoId).eq("ativo_id", ativoId);
  if (error) return { erro: erroBanco(error.message) };
  return pronto("Meta salva");
}

// ---------- cotações ----------
export async function atualizarCotacoesAgora(): Promise<Resultado> {
  const u = await userForAction(); if (!u) return { erro: "Sessão expirada. Entre de novo." };
  const { data } = await u.supabase.from("ativos").select("ticker,classe,moeda");
  const tickers = (data ?? []).filter((a) => temCotacaoAuto(a)).map((a) => ({ ticker: a.ticker as string, moeda: a.moeda as Moeda }));
  if (!tickers.length) return { ok: "Nenhum ativo com cotação automática" };
  if ((await reservar("atualizarManual", 1)) < 1) {
    return { erro: `Limite de ${LIMITES.atualizarManual.trava} atualizações manuais por hora atingido (protege a cota gratuita da brapi). A rotina diária continua normal.` };
  }
  try {
    const r = await atualizarCotacoes(tickers);
    let cambios = 0;
    try { cambios = await preencherCambios(u.userId); } catch { /* fica para a rotina diária */ }
    let hist = { b3: 0, eua: 0, dolar: 0 };
    try { await atualizarIndices(); hist = await completarHistorico(u.userId); } catch { /* fica para a rotina diária */ }
    revalidatePath("/", "layout");
    return { ok: `${r.ok.length} cotação(ões) atualizada(s)` + (cambios ? ` · câmbio preenchido em ${cambios} operação(ões) em dólar` : "") +
      (hist.b3 + hist.eua ? ` · ${hist.b3 + hist.eua} preços históricos baixados` : "") + (r.falha.length ? ` · sem retorno: ${r.falha.join(", ")}` : "") +
      (r.travados.length ? ` · ${r.travados.length} não consultada(s): trava do plano gratuito atingida` : "") };
  } catch {
    return { erro: "Não foi possível buscar as cotações agora." };
  }
}

// ---------- importação do app antigo (JSON de backup) ----------
const ClsAntiga: Record<string, (typeof CLASSES)[number]> = {
  acao: "acao", fii: "fii", etf: "etf", bdr: "bdr", rf: "renda_fixa", tesouro: "tesouro", cripto: "cripto", exterior: "exterior", outros: "outros",
};
const BackupSchema = z.object({
  assets: z.array(z.object({
    id: z.string(), ticker: z.string().max(40), name: z.string().max(120).optional().default(""),
    cls: z.string(), qty: z.number().nonnegative(), avgPrice: z.number().nonnegative(), price: z.number().nonnegative(),
    segs: z.array(z.string()).default([]),
  })).max(1000),
  segments: z.array(z.object({
    id: z.string(), name: z.string().min(1).max(60), desc: z.string().max(200).optional().default(""),
    target: z.number().min(0).max(100).nullable().optional(), targets: z.record(z.string(), z.number()).default({}),
  })).max(200).default([]),
});

export async function importarBackup(_: Resultado, fd: FormData): Promise<Resultado> {
  const u = await userForAction(); if (!u) return { erro: "Sessão expirada. Entre de novo." };
  const dt = data.safeParse(fd.get("data")); if (!dt.success) return { erro: "Informe a data das compras" };
  let json: unknown;
  try { json = JSON.parse(String(fd.get("json") ?? "")); } catch { return { erro: "O texto colado não é um JSON válido" }; }
  const p = BackupSchema.safeParse(json); if (!p.success) return { erro: "Formato de backup não reconhecido" };
  const sb = u.supabase;

  // segmentos
  const segMap = new Map<string, string>();
  for (const s of p.data.segments) {
    const { data: row, error } = await sb.from("segmentos")
      .upsert({ nome: s.name.trim(), descricao: s.desc || null, meta_pct: s.target ?? null }, { onConflict: "user_id,nome" })
      .select("id").single();
    if (error || !row) return { erro: erroBanco(error?.message ?? "") };
    segMap.set(s.id, row.id);
  }
  // ativos + compra inicial
  let n = 0;
  for (const a of p.data.assets) {
    const t = ticker.safeParse(a.ticker); if (!t.success || a.qty <= 0) continue;
    const classe = ClsAntiga[a.cls] ?? "outros";
    const manual = !temCotacaoAuto({ classe, moeda: "BRL" });
    const { data: row, error } = await sb.from("ativos").upsert({
      ticker: t.data, nome: a.name || null, classe,
      preco_manual: manual ? a.price : null, preco_manual_em: manual ? new Date().toISOString() : null,
    }, { onConflict: "user_id,ticker" }).select("id").single();
    if (error || !row) return { erro: erroBanco(error?.message ?? "") };
    const { error: e2 } = await sb.from("operacoes").insert({
      ativo_id: row.id, tipo: "compra", data: dt.data, quantidade: a.qty, preco: a.avgPrice, nota: "Importado do app anterior",
    });
    if (e2) return { erro: erroBanco(e2.message) };
    const vinc = a.segs.map((s) => segMap.get(s)).filter((s): s is string => !!s).map((segmento_id) => {
      const orig = p.data.segments.find((x) => segMap.get(x.id) === segmento_id);
      return { segmento_id, ativo_id: row.id, meta_pct: orig?.targets[a.id] ?? null };
    });
    if (vinc.length) await sb.from("segmento_ativos").upsert(vinc, { onConflict: "segmento_id,ativo_id" });
    n++;
  }
  return pronto(`${n} ativos e ${segMap.size} segmentos importados`);
}

export async function sair() {
  const sb = await createClient();
  await sb.auth.signOut();
  redirect("/login");
}

// ---------- notas de corretagem (PDF) ----------
export type LeituraNota =
  | { erro: string; precisaSenha?: boolean }
  | { nota: NotaLida; existentes: Record<string, { id: string; classe: string }>; jaImportadas: string[] };

const MAX_PDF = 5 * 1024 * 1024;

/** Lê o PDF em memória e devolve as operações para conferência. Nada é salvo. */
export async function lerNota(fd: FormData): Promise<LeituraNota> {
  const u = await userForAction(); if (!u) return { erro: "Sessão expirada. Entre de novo." };
  const arquivo = fd.get("arquivo");
  if (!(arquivo instanceof File) || arquivo.size === 0) return { erro: "Escolha o arquivo PDF da nota." };
  if (arquivo.size > MAX_PDF) return { erro: "Arquivo maior que 5 MB." };
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") return { erro: "O arquivo não é um PDF." };
  const senha = String(fd.get("senha") ?? "").slice(0, 100) || undefined;

  let nota: NotaLida;
  try {
    nota = await lerNotaPdf(bytes, senha);
  } catch (e) {
    if (e instanceof NotaErro) return { erro: e.message, precisaSenha: e.codigo === "senha" || e.codigo === "senha_errada" };
    return { erro: "Não foi possível ler este PDF." };
  }

  const tickers = [...new Set(nota.operacoes.map((o) => o.ticker))];
  const { data: ativos } = await u.supabase.from("ativos").select("id,ticker,classe").in("ticker", tickers);
  const existentes = Object.fromEntries((ativos ?? []).map((a) => [a.ticker as string, { id: a.id as string, classe: a.classe as string }]));
  const { data: ja } = await u.supabase.from("operacoes").select("origem").in("origem", nota.operacoes.map((o) => o.origem));
  return { nota, existentes, jaImportadas: (ja ?? []).map((r) => r.origem as string) };
}

const ImportacaoSchema = z.object({
  moeda: z.enum(MOEDAS),
  operacoes: z.array(z.object({
    origem: z.string().regex(/^[a-z]{2,4}:[a-f0-9]{16,64}$/),
    ticker,
    nome: z.string().max(120),
    classe: z.enum(CLASSES),
    tipo: z.enum(["compra", "venda"]),
    data,
    quantidade: z.number().positive().finite(),
    preco: z.number().nonnegative().finite(),
    taxas: z.number().nonnegative().finite(),
    segmentos: z.array(uuid).max(50).default([]),
  })).min(1).max(500),
});

/** Grava as operações conferidas. Linhas já importadas são ignoradas. */
export async function importarNota(payload: unknown): Promise<Resultado> {
  const u = await userForAction(); if (!u) return { erro: "Sessão expirada. Entre de novo." };
  const p = ImportacaoSchema.safeParse(payload); if (!p.success) return { erro: "Dados da nota inválidos. Leia o PDF de novo." };
  const { moeda, operacoes } = p.data;
  const sb = u.supabase;

  // 1. ativos: reaproveita os existentes, cria os que faltam
  const tickers = [...new Set(operacoes.map((o) => o.ticker))];
  const { data: atuais } = await sb.from("ativos").select("id,ticker").in("ticker", tickers);
  const idPorTicker = new Map((atuais ?? []).map((a) => [a.ticker as string, a.id as string]));
  const novos = tickers.filter((t) => !idPorTicker.has(t)).map((t) => {
    const o = operacoes.find((x) => x.ticker === t)!;
    return { ticker: t, nome: o.nome || null, classe: o.classe, moeda };
  });
  if (novos.length) {
    const { data: criados, error } = await sb.from("ativos").insert(novos).select("id,ticker");
    if (error) return { erro: erroBanco(error.message) };
    for (const a of criados ?? []) idPorTicker.set(a.ticker as string, a.id as string);
  }

  // 2. câmbio do dia de cada operação (PTAX de venda), para ativos em dólar
  const cambios = moeda === "USD" ? await ptaxDatas(operacoes.map((o) => o.data)) : new Map<string, number>();

  // 3. operações (a restrição única em `origem` impede duplicar)
  const linhas = operacoes.map((o) => ({
    ativo_id: idPorTicker.get(o.ticker)!, tipo: o.tipo, data: o.data, quantidade: o.quantidade,
    preco: o.preco, taxas: o.taxas, origem: o.origem, nota: "Importado de nota (PDF)",
    cambio: moeda === "USD" ? cambios.get(o.data) ?? null : null,
  }));
  const { data: inseridas, error } = await sb.from("operacoes")
    .upsert(linhas, { onConflict: "user_id,origem", ignoreDuplicates: true }).select("id");
  if (error) return { erro: erroBanco(error.message) };

  // 4. segmentos escolhidos
  const vinc = operacoes.flatMap((o) => o.segmentos.map((segmento_id) => ({ segmento_id, ativo_id: idPorTicker.get(o.ticker)! })));
  if (vinc.length) {
    const unicos = [...new Map(vinc.map((v) => [v.segmento_id + v.ativo_id, v])).values()];
    await sb.from("segmento_ativos").upsert(unicos, { onConflict: "segmento_id,ativo_id", ignoreDuplicates: true });
  }

  // 5. cotação inicial dos ativos novos (não bloqueia se falhar)
  if (novos.length) {
    try { await atualizarCotacoes(novos.filter((n) => temCotacaoAuto(n)).map((n) => ({ ticker: n.ticker, moeda }))); } catch { /* rotina diária cobre */ }
  }

  const n = inseridas?.length ?? 0, dup = linhas.length - n;
  const semCambio = moeda === "USD" && linhas.some((l) => l.cambio == null);
  return pronto(
    `${n} operação(ões) importada(s)` + (dup ? ` · ${dup} já existia(m)` : "") + (novos.length ? ` · ${novos.length} ativo(s) novo(s)` : "") +
    (semCambio ? " · PTAX indisponível em alguma data: usando o dólar atual" : ""),
  );
}

/** Apaga ativos, operações, proventos e vínculos de segmento do usuário (segmentos ficam). */
export async function apagarCarteira(_: Resultado, fd: FormData): Promise<Resultado> {
  const u = await userForAction(); if (!u) return { erro: "Sessão expirada. Entre de novo." };
  if (String(fd.get("confirmacao") ?? "").trim() !== "APAGAR") return { erro: "Digite APAGAR para confirmar." };
  const { error } = await u.supabase.from("ativos").delete().eq("user_id", u.userId);
  if (error) return { erro: "Não foi possível apagar. Tente de novo." };
  return pronto("Carteira apagada. Segmentos foram mantidos (vazios).");
}
