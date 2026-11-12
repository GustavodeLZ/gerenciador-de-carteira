"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { lerNota, importarNota, type LeituraNota } from "@/app/actions";
import type { NotaLida } from "@/lib/notas/tipos";

type Linha = NotaLida["operacoes"][number] & { incluir: boolean; classe: string; segmentos: string[]; jaImportada: boolean; ativoExiste: boolean };

const moedaFmt = (moeda: string) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda, minimumFractionDigits: 2, maximumFractionDigits: 4 });
const qtdFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 });

export function NotaUpload({ classes, segmentos }: { classes: { id: string; nome: string }[]; segmentos: { id: string; nome: string }[] }) {
  const router = useRouter();
  const [lendo, startLer] = useTransition();
  const [salvando, startSalvar] = useTransition();
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [pedeSenha, setPedeSenha] = useState(false);
  const [nota, setNota] = useState<NotaLida | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [segsTodos, setSegsTodos] = useState<string[]>([]);

  function ler(fd: FormData) {
    setErro(""); setOk("");
    startLer(async () => {
      const r: LeituraNota = await lerNota(fd);
      if ("erro" in r) { setErro(r.erro); setPedeSenha(!!r.precisaSenha); return; }
      setPedeSenha(false);
      setNota(r.nota);
      const classePadrao = r.nota.moeda === "USD" ? "exterior" : "acao";
      setLinhas(r.nota.operacoes.map((o) => {
        const ja = r.jaImportadas.includes(o.origem);
        return { ...o, incluir: !ja, jaImportada: ja, ativoExiste: !!r.existentes[o.ticker], classe: r.existentes[o.ticker]?.classe ?? classePadrao, segmentos: [] };
      }));
    });
  }

  function atualiza(i: number, patch: Partial<Linha>) {
    setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function confirmar() {
    if (!nota) return;
    const sel = linhas.filter((l) => l.incluir);
    if (!sel.length) { setErro("Nenhuma operação selecionada."); return; }
    setErro("");
    startSalvar(async () => {
      const r = await importarNota({
        moeda: nota.moeda,
        operacoes: sel.map((l) => ({
          origem: l.origem, ticker: l.ticker.trim().toUpperCase(), nome: l.nome, classe: l.classe, tipo: l.tipo, data: l.data,
          quantidade: l.quantidade, preco: l.preco, taxas: l.taxas, segmentos: [...new Set([...l.segmentos, ...segsTodos])],
        })),
      });
      if (r?.erro) { setErro(r.erro); return; }
      setOk(r?.ok ?? "Importado"); setNota(null); setLinhas([]); setSegsTodos([]);
      router.refresh();
    });
  }

  const fmt = nota ? moedaFmt(nota.moeda) : moedaFmt("BRL");
  const total = linhas.filter((l) => l.incluir).reduce((s, l) => s + (l.tipo === "compra" ? l.liquido : -l.liquido), 0);

  return (
    <div className="card" id="nota">
      <h2>Importar nota de corretagem (PDF)</h2>
      {!nota && (
        <form action={ler} className="form">
          <label className="f full">Arquivo PDF (até 5 MB)
            <input type="file" name="arquivo" accept="application/pdf,.pdf" required />
          </label>
          {pedeSenha && (
            <label className="f">Senha do PDF<input type="password" name="senha" autoComplete="off" autoFocus /></label>
          )}
          <div className="full row">
            <button className="btn primary" disabled={lendo}>{lendo ? "Lendo…" : "Ler nota"}</button>
            <span className="faint small">O PDF é lido no servidor e descartado: só as operações que você confirmar são salvas.</span>
          </div>
        </form>
      )}

      {nota && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            <b>{nota.corretora}</b> · {linhas.length} operação(ões) em {nota.moeda === "USD" ? "dólar" : "reais"}. Confira antes de importar.
            {nota.moeda === "USD" && " O custo em reais usa a PTAX de venda do dia de cada operação."}
          </p>
          {nota.avisos.map((a) => <p key={a} className="msg err" style={{ marginTop: 0 }}>{a}</p>)}
          <div className="tablewrap">
            <table>
              <thead><tr>
                <th className="l"><input type="checkbox" aria-label="Selecionar todas" checked={linhas.every((l) => l.incluir || l.jaImportada)}
                  onChange={(e) => setLinhas((ls) => ls.map((l) => ({ ...l, incluir: e.target.checked && !l.jaImportada })))} /></th>
                <th className="l">Ticker</th><th className="l">Classe</th><th className="l">Tipo</th><th className="l">Data</th>
                <th>Quantidade</th><th>Preço</th><th>Taxas</th><th>Líquido</th>
                {segmentos.length > 0 && <th className="l">Segmentos</th>}
              </tr></thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={l.origem} style={l.jaImportada ? { opacity: 0.5 } : undefined}>
                    <td className="l"><input type="checkbox" checked={l.incluir} disabled={l.jaImportada} onChange={(e) => atualiza(i, { incluir: e.target.checked })} aria-label={`Importar ${l.ticker}`} /></td>
                    <td className="l">
                      <span className="tk">{l.ticker}</span>
                      <span className="tkname" title={l.nome}>{l.jaImportada ? "já importada" : l.ativoExiste ? "ativo já na carteira" : "ativo novo"} · {l.nome}</span>
                    </td>
                    <td className="l">
                      <select value={l.classe} disabled={l.ativoExiste || l.jaImportada} onChange={(e) => atualiza(i, { classe: e.target.value })} style={{ width: "auto", padding: "4px 6px" }}>
                        {classes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    </td>
                    <td className="l">{l.tipo === "compra" ? "Compra" : "Venda"}</td>
                    <td className="l">{l.data.split("-").reverse().join("/")}</td>
                    <td>{qtdFmt.format(l.quantidade)}</td>
                    <td>{fmt.format(l.preco)}</td>
                    <td>{fmt.format(l.taxas)}</td>
                    <td><b>{fmt.format(l.liquido)}</b></td>
                    {segmentos.length > 0 && (
                      <td className="l">
                        <div className="checkchips" style={{ flexWrap: "nowrap" }}>
                          {segmentos.map((s) => (
                            <label key={s.id} style={{ padding: "2px 8px" }}>
                              <input type="checkbox" disabled={l.jaImportada} checked={l.segmentos.includes(s.id)}
                                onChange={(e) => atualiza(i, { segmentos: e.target.checked ? [...l.segmentos, s.id] : l.segmentos.filter((x) => x !== s.id) })} />
                              {s.nome}
                            </label>
                          ))}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td className="l" colSpan={8}><b>Total selecionado</b></td><td><b>{fmt.format(total)}</b></td>{segmentos.length > 0 && <td />}</tr></tfoot>
            </table>
          </div>
          {segmentos.length > 0 && (
            <div className="row" style={{ marginTop: 12 }}>
              <span className="small muted">Adicionar todos ao segmento:</span>
              <div className="checkchips">{segmentos.map((s) => (
                <label key={s.id}><input type="checkbox" checked={segsTodos.includes(s.id)}
                  onChange={(e) => setSegsTodos((v) => (e.target.checked ? [...v, s.id] : v.filter((x) => x !== s.id)))} />{s.nome}</label>
              ))}</div>
            </div>
          )}
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={confirmar} disabled={salvando}>
              {salvando ? "Importando…" : `Importar ${linhas.filter((l) => l.incluir).length} operação(ões)`}
            </button>
            <button className="btn ghost" onClick={() => { setNota(null); setLinhas([]); setErro(""); }} disabled={salvando}>Cancelar</button>
          </div>
        </>
      )}
      {erro && <p className="msg err" role="alert">{erro}</p>}
      {ok && <p className="msg ok" role="status">{ok}</p>}
    </div>
  );
}
