"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { diasUteis, nivelEm, valorEm, type Serie } from "@/lib/desempenho";
import type { DadosComparacao } from "@/lib/comparacao";

/** Cor fixa por série: a cor acompanha o índice, não a ordem em que aparece. */
const INDICES = [
  { id: "CDI", nome: "CDI", cor: "var(--c4)" },
  { id: "IBOV", nome: "IBOV", cor: "var(--c1)" },
  { id: "IDIV", nome: "IDIV", cor: "var(--c3)" },
  { id: "IFIX", nome: "IFIX", cor: "var(--c2)" },
  { id: "SP500", nome: "S&P 500 (US$)", cor: "var(--c7)" },
  { id: "IPCA", nome: "IPCA", cor: "var(--c9)" },
] as const;
const PERIODOS = [
  { id: "1m", nome: "1M", dias: 31 }, { id: "3m", nome: "3M", dias: 92 }, { id: "6m", nome: "6M", dias: 183 },
  { id: "12m", nome: "12M", dias: 366 }, { id: "ano", nome: "No ano", dias: 0 }, { id: "tudo", nome: "Tudo", dias: -1 },
] as const;

const somaDias = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(2).replace(".", ",")}%`;
const dataCurta = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y.slice(2)}`; };

type Linha = { id: string; nome: string; cor: string; forte?: boolean; pontos: (number | null)[] };

export function GraficoComparacao({ dados, titulo, nomeSerie, padrao = ["CDI", "IBOV"] }: {
  dados: DadosComparacao; titulo: string; nomeSerie: string; padrao?: string[];
}) {
  const [periodo, setPeriodo] = useState<(typeof PERIODOS)[number]["id"]>("tudo");
  const [ativos, setAtivos] = useState<Set<string>>(() => new Set(padrao));
  const [hover, setHover] = useState<number | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(720);
  useEffect(() => {
    const el = caixa.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setLargura(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  const temSerie = dados.serie.length > 1;
  const primeiraData = temSerie ? dados.serie[0][0] : somaDias(dados.hoje, -366);

  const { datas, linhas } = useMemo(() => {
    const p = PERIODOS.find((x) => x.id === periodo)!;
    let ini = p.dias === -1 ? primeiraData : p.dias === 0 ? `${dados.hoje.slice(0, 4)}-01-01` : somaDias(dados.hoje, -p.dias);
    if (ini < primeiraData) ini = primeiraData;
    let ds = temSerie ? dados.serie.map((x) => x[0]).filter((d) => d >= ini) : diasUteis(ini, dados.hoje);
    if (ds.length > 320) { const passo = ds.length / 320; ds = Array.from({ length: 320 }, (_, i) => ds[Math.floor(i * passo)]).concat(ds.at(-1)!); }
    const base = ds[0];
    const rebase = (s: Serie | undefined, interp: boolean) => {
      const b = nivelEm(s, base, interp);
      if (!s?.length || !b || s[0][0] > base) return null;
      return ds.map((d) => { const v = nivelEm(s, d, interp); return v == null ? null : v / b - 1; });
    };
    const out: Linha[] = [];
    if (temSerie) {
      const b = valorEm(dados.serie, base)!;
      out.push({ id: "carteira", nome: nomeSerie, cor: "var(--text)", forte: true, pontos: ds.map((d) => (valorEm(dados.serie, d) ?? b) / b - 1) });
    }
    for (const i of INDICES) {
      if (!ativos.has(i.id)) continue;
      const pts = rebase(dados.indices[i.id], i.id === "IPCA");
      if (pts) out.push({ id: i.id, nome: i.nome, cor: i.cor, pontos: pts });
    }
    return { datas: ds, linhas: out };
  }, [periodo, ativos, dados, temSerie, primeiraData, nomeSerie]);

  // ---- escala ----
  const alt = 280, m = { t: 12, r: 16, b: 26, l: 52 };
  const w = largura - m.l - m.r, h = alt - m.t - m.b;
  const valores = linhas.flatMap((l) => l.pontos.filter((v): v is number => v != null));
  let lo = Math.min(0, ...valores), hi = Math.max(0, ...valores);
  if (hi - lo < 0.01) { hi += 0.005; lo -= 0.005; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const passoY = [0.005, 0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1].find((s) => (hi - lo) / s <= 6) ?? 1;
  const ticksY: number[] = []; for (let v = Math.ceil(lo / passoY) * passoY; v <= hi + 1e-12; v += passoY) ticksY.push(Math.round(v * 1e6) / 1e6);
  const x = (i: number) => m.l + (datas.length > 1 ? (i / (datas.length - 1)) * w : w / 2);
  const y = (v: number) => m.t + (1 - (v - lo) / (hi - lo)) * h;
  const ticksX = datas.length > 1 ? Array.from(new Set([0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (datas.length - 1))))) : [0];
  const caminho = (pts: (number | null)[]) => {
    let d = "", aberto = false;
    pts.forEach((v, i) => { if (v == null) { aberto = false; return; } d += `${aberto ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`; aberto = true; });
    return d;
  };
  const idx = hover ?? datas.length - 1;
  const valorNo = (l: Linha, i: number) => { for (let j = i; j >= 0; j--) if (l.pontos[j] != null) return l.pontos[j]; return null; };
  const legenda = linhas.map((l) => ({ ...l, v: valorNo(l, idx) })).sort((a, b) => (b.v ?? -9) - (a.v ?? -9));

  const mover = (ev: React.PointerEvent<SVGRectElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    const f = (ev.clientX - r.left) / r.width;
    setHover(Math.max(0, Math.min(datas.length - 1, Math.round(f * (datas.length - 1)))));
  };

  return (
    <div className="card">
      <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
        <h2 style={{ margin: 0 }}>{titulo}</h2><span className="spacer" />
        <div className="seg" role="group" aria-label="Período">
          {PERIODOS.map((p) => <button type="button" key={p.id} className={periodo === p.id ? "on" : ""} onClick={() => setPeriodo(p.id)}>{p.nome}</button>)}
        </div>
      </div>
      <div className="chips" role="group" aria-label="Comparar com" style={{ margin: "10px 0 4px" }}>
        {INDICES.map((i) => {
          const tem = !!dados.indices[i.id]?.length;
          return (
            <button type="button" key={i.id} disabled={!tem} title={tem ? undefined : "Ainda sem dados deste índice"}
              className={`chip${ativos.has(i.id) ? " on" : ""}`} aria-pressed={ativos.has(i.id)}
              onClick={() => setAtivos((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })}>
              <span className="sw" style={{ background: i.cor }} />{i.nome}
            </button>
          );
        })}
      </div>

      <div ref={caixa} style={{ position: "relative" }}>
        {datas.length > 1 && linhas.length > 0 ? (
          <svg width={largura} height={alt} role="img" aria-label={`${titulo}: ${legenda.map((l) => `${l.nome} ${l.v == null ? "sem dado" : pct(l.v)}`).join(", ")}`} style={{ display: "block", touchAction: "pan-y" }}>
            {ticksY.map((v) => (
              <g key={v}>
                <line x1={m.l} x2={m.l + w} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={v === 0 ? 1.5 : 1} strokeDasharray={v === 0 ? undefined : "2 4"} />
                <text x={m.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--text-3)">{`${(v * 100).toFixed(Number.isInteger(Math.round(passoY * 1e6) / 1e4) ? 0 : 1).replace(".", ",")}%`}</text>
              </g>
            ))}
            {ticksX.map((i) => (
              <text key={i} x={x(i)} y={alt - 6} textAnchor={i === 0 ? "start" : i === datas.length - 1 ? "end" : "middle"} fontSize="11" fill="var(--text-3)">{dataCurta(datas[i])}</text>
            ))}
            {[...linhas].reverse().map((l) => (
              <path key={l.id} d={caminho(l.pontos)} fill="none" stroke={l.cor} strokeWidth={l.forte ? 2.5 : 2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + h} stroke="var(--text-3)" strokeWidth={1} />
                {linhas.map((l) => { const v = l.pontos[hover]; return v == null ? null : <circle key={l.id} cx={x(hover)} cy={y(v)} r={4} fill={l.cor} stroke="var(--surface)" strokeWidth={2} />; })}
              </g>
            )}
            <rect x={m.l} y={m.t} width={w} height={h} fill="transparent" onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => setHover(null)} />
          </svg>
        ) : (
          <div className="note" style={{ margin: "10px 0" }}>Ainda não há dados suficientes para o gráfico neste período.</div>
        )}
        {hover != null && datas[hover] && (
          <div className="tip" style={{ left: Math.min(Math.max(x(hover) + 12, 0), largura - 190), top: 8 }} role="status">
            <div className="faint small">{dataCurta(datas[hover])}</div>
            {legenda.map((l) => <div key={l.id} className="tipl"><span className="sw" style={{ background: l.cor }} />{l.nome}<b>{l.v == null ? "—" : pct(l.v)}</b></div>)}
          </div>
        )}
      </div>

      <div className="legenda">
        {legenda.map((l) => (
          <span key={l.id}><span className="ln" style={{ background: l.cor, height: l.forte ? 3 : 2 }} />{l.nome} <b className={l.v == null ? "" : l.v >= 0 ? "pos" : "neg"}>{l.v == null ? "—" : pct(l.v)}</b></span>
        ))}
        {datas.length > 1 && <span className="faint small" style={{ marginLeft: "auto" }}>{dataCurta(datas[0])} → {dataCurta(datas[idx])}</span>}
      </div>
      {!temSerie && (
        <p className="faint small" style={{ margin: "8px 0 0" }}>
          A linha da {nomeSerie.toLowerCase()} aparece quando houver histórico de preços para quase todos os ativos
          {dados.semHistorico.length ? <> (faltam: {dados.semHistorico.slice(0, 8).join(", ")}{dados.semHistorico.length > 8 ? "…" : ""})</> : null}.
          Clique em “Atualizar cotações” para baixar o histórico.{!dados.temTiingo && dados.semHistorico.some((t) => /^[A-Z.]+$/.test(t) && !/\d/.test(t)) ? " Para ativos dos EUA, configure a chave gratuita da Tiingo." : ""}
        </p>
      )}
      {temSerie && dados.semHistorico.length > 0 && (
        <p className="faint small" style={{ margin: "8px 0 0" }}>Sem histórico de preços (entram com preço constante): {dados.semHistorico.slice(0, 8).join(", ")}{dados.semHistorico.length > 8 ? "…" : ""}.</p>
      )}
      <p className="faint small" style={{ margin: "6px 0 0" }}>Rentabilidade pelo método da cota: aportes e resgates não contam; proventos contam como retorno. IBOV, IDIV e IFIX também incluem proventos; S&P 500 em dólar, sem dividendos.</p>
    </div>
  );
}
