"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { previaEUA, importarEUA, type PreviaEUA } from "@/app/(app)/importar/acoes";

const U = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
const Q = (v: number | null | undefined) => (v == null ? "—" : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 }).format(v));
const D = (d: string) => d.split("-").reverse().join("/");

export function ImportarEUA() {
  const router = useRouter();
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [previa, setPrevia] = useState<PreviaEUA | null>(null);
  const [pm, setPm] = useState<Record<string, string>>({});
  const [excluir, setExcluir] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [lendo, startLer] = useTransition();
  const [salvando, startSalvar] = useTransition();

  function form() {
    const fd = new FormData();
    arquivos.forEach((f) => fd.append("arquivos", f));
    const pmInter: Record<string, number> = {};
    for (const [t, v] of Object.entries(pm)) { const n = Number(v.replace(",", ".")); if (n > 0) pmInter[t] = n; }
    fd.set("pmInter", JSON.stringify(pmInter));
    fd.set("excluir", JSON.stringify([...excluir]));
    return fd;
  }
  function analisar() {
    setErro(""); setOk("");
    startLer(async () => {
      const r = await previaEUA(form());
      if ("erro" in r) { setErro(r.erro); return; }
      setPrevia(r);
    });
  }
  function importar() {
    startSalvar(async () => {
      const r = await importarEUA(form());
      if (r.erro) { setErro(r.erro); return; }
      setOk(r.ok ?? "Importado"); setPrevia(null); setArquivos([]); setPm({}); router.refresh();
    });
  }

  const conferem = previa ? previa.ativos.filter((a) => !a.ajuste).length : 0;
  const pedemPm = previa ? previa.ativos.filter((a) => a.precisaPm) : [];

  return (
    <div className="card" id="eua">
      <h2>Ações e ETFs dos EUA (Inter)</h2>
      {!previa && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Envie juntos o <b>Relatório Histórico do myProfit</b> (.xlsx, para o histórico de compras), o <b>extrato mensal</b> da conta
            americana do Inter (PDF, para conferir as quantidades e trazer os dividendos) e as <b>confirmações de operação</b> (PDF) de
            depois do extrato. O app confere tudo contra o extrato e mostra as diferenças antes de gravar.
          </p>
          <div className="form">
            <label className="f full">Arquivos .xlsx e .pdf (até 4 MB no total)
              <input type="file" multiple accept=".xlsx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setArquivos([...(e.target.files ?? [])])} />
            </label>
            <div className="full row">
              <button className="btn primary" disabled={!arquivos.length || lendo} onClick={analisar}>
                {lendo ? "Analisando…" : `Analisar ${arquivos.length || ""} arquivo(s)`}
              </button>
              <span className="faint small">Os arquivos são lidos no servidor e descartados. Nada é salvo antes da sua confirmação.</span>
            </div>
          </div>
        </>
      )}
      {previa && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {previa.ativos.length} ativo(s){previa.dataExtrato ? <> · extrato até <b>{D(previa.dataExtrato)}</b></> : " · sem extrato para conferir"}
            {" · "}<b>{conferem}</b> conferem com o extrato
            {previa.confirmacoesRepetidas > 0 && <> · {previa.confirmacoesRepetidas} confirmação(ões) já constavam no myProfit (ignoradas)</>}
          </p>
          {previa.desconhecidos.length > 0 && <p className="msg err">Não reconhecidos (ignorados): {previa.desconhecidos.join(", ")}</p>}
          {previa.avisos.map((a, i) => <div className="note" key={i} style={{ marginBottom: 8 }}>{a}</div>)}
          {pedemPm.length > 0 && (
            <div className="note" style={{ marginBottom: 12 }}>
              <b>Preço médio do Inter:</b> para estes ativos o extrato não traz o custo. Informe o preço médio que aparece no app do Inter
              (em US$) para a entrada de ajuste ficar com o custo certo, e clique em Analisar de novo.
              <div className="form" style={{ marginTop: 8 }}>
                {pedemPm.map((a) => (
                  <label className="f" key={a.ticker}>{a.ticker}
                    <input inputMode="decimal" value={pm[a.ticker] ?? ""} onChange={(e) => setPm({ ...pm, [a.ticker]: e.target.value })} />
                  </label>
                ))}
              </div>
              <button className="btn" style={{ marginTop: 8 }} disabled={lendo} onClick={analisar}>{lendo ? "Analisando…" : "Analisar de novo"}</button>
            </div>
          )}
          <div className="tbl">
            <table>
              <thead><tr><th></th><th>Ativo</th><th className="r">Compras/vendas</th><th className="r">Qtd. calculada</th><th className="r">Qtd. extrato</th>
                <th className="r">Custo extrato</th><th className="r">Dividendos</th><th>Ajuste</th></tr></thead>
              <tbody>
                {previa.ativos.map((a) => (
                  <tr key={a.ticker} style={excluir.has(a.ticker) ? { opacity: 0.45 } : undefined}>
                    <td><input type="checkbox" checked={!excluir.has(a.ticker)} onChange={(e) => {
                      const n = new Set(excluir); if (e.target.checked) n.delete(a.ticker); else n.add(a.ticker); setExcluir(n);
                    }} /></td>
                    <td><b>{a.ticker}</b>{a.existe && <span className="faint small"> · já existe</span>}<div className="faint small">{a.nome ?? ""}</div></td>
                    <td className="r">{a.compras}/{a.vendas}</td>
                    <td className="r">{Q(a.qtdCalculada)}</td>
                    <td className="r">{Q(a.qtdExtrato)}</td>
                    <td className="r">{U(a.custoExtrato)}</td>
                    <td className="r">{a.proventos.length ? U(a.proventos.reduce((s, p) => s + p.valor, 0)) : "—"}</td>
                    <td className="small">{a.ajuste ? <>{a.ajuste.tipo} {Q(a.ajuste.quantidade)} a {U(a.ajuste.preco)}<div className="faint">{a.ajuste.motivo}</div></> : <span className="faint">confere</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={salvando} onClick={importar}>{salvando ? "Gravando…" : `Importar ${previa.ativos.length - excluir.size} ativo(s)`}</button>
            <button className="btn" disabled={salvando} onClick={() => { setPrevia(null); setErro(""); }}>Cancelar</button>
            <span className="faint small">O câmbio de cada operação é a PTAX de venda do dia (Banco Central). Importar de novo não duplica.</span>
          </div>
        </>
      )}
      {erro && <p className="msg err">{erro}</p>}
      {ok && <p className="msg ok">{ok}</p>}
    </div>
  );
}
