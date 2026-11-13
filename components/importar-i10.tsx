"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { previaI10, importarI10, type PreviaI10 } from "@/app/(app)/importar/acoes";

const fmt = (v: number, moeda: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda === "USD" ? "USD" : "BRL", maximumFractionDigits: moeda === "USD" ? 4 : 2 }).format(v || 0);
const Q = (v: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 }).format(v);

export function ImportarI10({ nomesClasse }: { nomesClasse: Record<string, string> }) {
  const router = useRouter();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [data, setData] = useState("");
  const [previa, setPrevia] = useState<PreviaI10 | null>(null);
  const [excluir, setExcluir] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [lendo, startLer] = useTransition();
  const [salvando, startSalvar] = useTransition();

  function escolher(f: File | null) {
    setArquivo(f); setPrevia(null); setErro(""); setOk("");
    const m = f?.name.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) setData(m[1]);
  }

  function analisar() {
    if (!arquivo) return;
    const fd = new FormData(); fd.set("arquivo", arquivo);
    startLer(async () => {
      const r = await previaI10(fd);
      if ("erro" in r) { setErro(r.erro); return; }
      setErro(""); setPrevia(r);
      setExcluir(new Set(r.posicoes.filter((p) => p.jaImportado).map((p) => p.ticker)));
    });
  }

  function importar() {
    if (!arquivo || !data) { setErro("Informe a data da posição."); return; }
    const fd = new FormData(); fd.set("arquivo", arquivo);
    fd.set("escolhas", JSON.stringify({ data, excluir: [...excluir] }));
    startSalvar(async () => {
      const r = await importarI10(fd);
      if (r.erro) { setErro(r.erro); return; }
      setOk(r.ok ?? "Importado"); setPrevia(null); setArquivo(null); router.refresh();
    });
  }

  const sel = previa ? previa.posicoes.filter((p) => !excluir.has(p.ticker)) : [];
  const comOps = previa ? previa.posicoes.filter((p) => p.existe && !p.jaImportado).length : 0;
  const porCat = sel.reduce<Record<string, { n: number; v: number; moeda: string }>>((m, p) => {
    const k = p.categoria; m[k] = m[k] ?? { n: 0, v: 0, moeda: p.moeda }; m[k].n++; m[k].v += p.saldo; return m;
  }, {});

  return (
    <div className="card" id="i10">
      <h2>Posição inicial do Investidor10 (CSV)</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Grava cada ativo como uma compra na data da posição, pelo preço médio do Investidor10. Depois disso, as importações da B3
        trazem só as operações <b>posteriores</b> a essa data (os proventos continuam vindo de todo o período).
      </p>
      {!previa && (
        <div className="form">
          <label className="f full">Arquivo .csv de posições
            <input type="file" accept=".csv,text/csv" onChange={(e) => escolher(e.target.files?.[0] ?? null)} />
          </label>
          <div className="full row">
            <button className="btn primary" disabled={!arquivo || lendo} onClick={analisar}>{lendo ? "Lendo…" : "Analisar"}</button>
          </div>
        </div>
      )}
      {previa && (
        <>
          {previa.corteExistente && (
            <p className="msg err" style={{ marginTop: 0 }}>Já existe uma posição inicial em {previa.corteExistente.split("-").reverse().join("/")}. Importar de novo só acrescenta ativos que ainda não estão lá.</p>
          )}
          {comOps > 0 && (
            <div className="note" style={{ marginBottom: 12 }}>
              <b>{comOps} ativo(s) já têm operações no app</b> (de importações anteriores ou lançamentos manuais). A posição inicial vai
              <b> somar</b> com elas. Para usar o Investidor10 como base limpa, apague os dados antes em <Link href="/config#apagar">Ajustes</Link>.
            </div>
          )}
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(170px,1fr))", marginBottom: 12 }}>
            {Object.entries(porCat).map(([k, v]) => (
              <div key={k}><div className="faint small">{k}</div><div style={{ fontWeight: 650 }}>{v.n} · {fmt(v.v, v.moeda)}</div></div>
            ))}
          </div>
          <div className="tablewrap" style={{ maxHeight: 420, overflowY: "auto" }}>
            <table>
              <thead><tr>
                <th className="l"><input type="checkbox" aria-label="Incluir todos" checked={excluir.size === 0}
                  onChange={(e) => setExcluir(e.target.checked ? new Set() : new Set(previa.posicoes.map((p) => p.ticker)))} /></th>
                <th className="l">Ativo</th><th className="l">Classe</th><th>Quantidade</th><th>Preço médio / aplicado</th><th>Saldo</th><th className="l">Observação</th>
              </tr></thead>
              <tbody>{previa.posicoes.map((p) => (
                <tr key={p.ticker} style={excluir.has(p.ticker) ? { opacity: 0.45 } : undefined}>
                  <td className="l"><input type="checkbox" checked={!excluir.has(p.ticker)} disabled={p.jaImportado} aria-label={`Incluir ${p.ticker}`}
                    onChange={(e) => { const s = new Set(excluir); if (e.target.checked) s.delete(p.ticker); else s.add(p.ticker); setExcluir(s); }} /></td>
                  <td className="l"><span className="tk">{p.ticker}</span>{p.jaImportado ? <span className="tkname">já importado</span> : p.existe ? <span className="tkname">já tem operações</span> : null}</td>
                  <td className="l">{nomesClasse[p.classe] ?? p.classe}</td>
                  <td>{Q(p.quantidade)}</td>
                  <td>{fmt(p.precoMedio, p.moeda)}</td>
                  <td>{fmt(p.saldo, p.moeda)}</td>
                  <td className="l small faint" style={{ whiteSpace: "normal", minWidth: 200 }}>{p.observacao ?? ""}</td>
                </tr>))}
              </tbody>
            </table>
          </div>
          {(previa.avisos.length > 0 || previa.ignoradas.length > 0) && (
            <details style={{ marginTop: 10 }}>
              <summary className="small muted" style={{ cursor: "pointer" }}>{previa.avisos.length} aviso(s) · {previa.ignoradas.length} linha(s) ignoradas</summary>
              {[...previa.avisos, ...previa.ignoradas].map((a) => <p key={a} className="small" style={{ margin: "4px 0" }}>• {a}</p>)}
            </details>
          )}
          <p className="faint small">Ativos em dólar: o custo em reais usa o dólar atual, porque o arquivo não traz o câmbio de cada compra.</p>
          <div className="row" style={{ marginTop: 12 }}>
            <label className="f" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>Data da posição
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={{ width: "auto" }} required />
            </label>
            <button className="btn primary" disabled={salvando || !sel.length || !data} onClick={importar}>
              {salvando ? "Importando…" : `Importar ${sel.length} posição(ões)`}
            </button>
            <button className="btn ghost" disabled={salvando} onClick={() => setPrevia(null)}>Cancelar</button>
          </div>
        </>
      )}
      {erro && <p className="msg err" role="alert">{erro}</p>}
      {ok && <p className="msg ok" role="status">{ok} <Link href="/">Ver resumo →</Link></p>}
    </div>
  );
}
