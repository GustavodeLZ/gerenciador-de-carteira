"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { previaB3, importarB3, type PreviaB3, type EscolhasB3 } from "@/app/(app)/importar/acoes";

const R = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const Q = (v: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 8 }).format(v);

type Classe = { id: string; nome: string };

export function ImportarB3({ classes }: { classes: Classe[] }) {
  const router = useRouter();
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [previa, setPrevia] = useState<PreviaB3 | null>(null);
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [analisando, startAnalise] = useTransition();
  const [importando, startImport] = useTransition();
  const [soAtencao, setSoAtencao] = useState(false);

  // escolhas
  const [renomear, setRenomear] = useState<Record<string, string>>({});
  const [excluir, setExcluir] = useState<Set<string>>(new Set());
  const [classesSel, setClassesSel] = useState<Record<string, string>>({});
  const [semAjuste, setSemAjuste] = useState<Set<string>>(new Set());
  const [precoAjuste, setPrecoAjuste] = useState<Record<string, string>>({});
  const [rendaFixa, setRendaFixa] = useState(true);
  const [proventos, setProventos] = useState(true);
  const [resgatar, setResgatar] = useState<Set<string>>(new Set());

  function form(esc: EscolhasB3) {
    const fd = new FormData();
    arquivos.forEach((f) => fd.append("arquivos", f));
    fd.set("escolhas", JSON.stringify(esc));
    return fd;
  }

  function analisar(ren: Record<string, string>, primeira = false) {
    setErro(""); setOk("");
    startAnalise(async () => {
      const r = await previaB3(form({ renomear: ren }));
      if ("erro" in r) { setErro(r.erro); return; }
      if (primeira && r.sugestoesTroca.length) {
        // aplica as trocas sugeridas e recalcula
        const auto = Object.fromEntries(r.sugestoesTroca.map((s) => [s.de, s.para]));
        const r2 = await previaB3(form({ renomear: auto }));
        if ("erro" in r2) { setErro(r2.erro); return; }
        setRenomear(auto);
        setPrevia({ ...r2, sugestoesTroca: r.sugestoesTroca });
      } else {
        setPrevia((p) => ({ ...r, sugestoesTroca: primeira ? r.sugestoesTroca : p?.sugestoesTroca ?? r.sugestoesTroca }));
      }
      if (primeira) {
        setExcluir(new Set()); setClassesSel({}); setSemAjuste(new Set()); setPrecoAjuste({});
        setResgatar(new Set(r.sairam.map((s) => s.ticker)));
        setRendaFixa(r.rendaFixa.length > 0); setProventos(true);
      }
    });
  }

  function trocar(de: string, para: string) {
    const ren = { ...renomear };
    if (para) ren[de] = para; else delete ren[de];
    setRenomear(ren);
    analisar(ren);
  }

  function importar() {
    if (!previa) return;
    const precos: Record<string, number> = {};
    for (const [t, v] of Object.entries(precoAjuste)) {
      const n = Number(v.replace(/\./g, "").replace(",", "."));
      if (v.trim() && isFinite(n) && n >= 0) precos[t] = n;
    }
    setErro("");
    startImport(async () => {
      const r = await importarB3(form({
        renomear, precoAjuste: precos, excluir: [...excluir], classes: classesSel as EscolhasB3["classes"],
        semAjuste: [...semAjuste], rendaFixa, proventos, resgatar: [...resgatar],
      }));
      if (r.erro) { setErro(r.erro); return; }
      setOk(r.ok ?? "Importado"); setPrevia(null); setArquivos([]);
      router.refresh();
    });
  }

  const lista = useMemo(() => {
    if (!previa) return [];
    const atencao = (a: PreviaB3["ativos"][number]) => !!a.ajuste || (a.existe?.opsManuais ?? 0) > 0;
    return [...previa.ativos]
      .filter((a) => !soAtencao || atencao(a))
      .sort((x, y) => Number(atencao(y)) - Number(atencao(x)) || x.ticker.localeCompare(y.ticker));
  }, [previa, soAtencao]);

  const alvosTroca = useMemo(() => (previa ? previa.ativos.filter((a) => a.qtdB3 > 0).map((a) => a.ticker) : []), [previa]);
  const incluidos = previa ? previa.ativos.filter((a) => !excluir.has(a.ticker)) : [];
  const nOps = incluidos.reduce((s, a) => s + a.compras + a.vendas + a.eventos + (a.ajuste && !semAjuste.has(a.ticker) ? 1 : 0), 0);
  const nProv = proventos ? incluidos.reduce((s, a) => s + a.proventos, 0) : 0;
  const vProv = proventos ? incluidos.reduce((s, a) => s + a.totalProventos, 0) : 0;
  const conferem = previa ? previa.ativos.filter((a) => !a.ajuste).length : 0;

  return (
    <div className="card" id="b3">
      <h2>Relatórios da B3 (Excel)</h2>
      {!previa && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            Na Área do Investidor da B3, baixe em Excel: <b>Extratos → Negociação</b>, <b>Extratos → Movimentação</b> (escolha o maior período possível)
            e <b>Posição de Carteira</b>. Envie os três juntos. Se tiver, inclua também o <b>Relatório Histórico do myProfit</b> (.xlsx):
            ele completa compras antigas que a B3 não registrou (de antes de 2019 ou de outra corretora).
          </p>
          <div className="form">
            <label className="f full">Arquivos .xlsx (até 4 MB no total)
              <input type="file" multiple accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => setArquivos([...(e.target.files ?? [])])} />
            </label>
            <div className="full row">
              <button className="btn primary" disabled={!arquivos.length || analisando} onClick={() => analisar({}, true)}>
                {analisando ? "Analisando…" : `Analisar ${arquivos.length || ""} arquivo(s)`}
              </button>
              <span className="faint small">Os arquivos são lidos no servidor e descartados. Nada é salvo antes da sua confirmação.</span>
            </div>
          </div>
        </>
      )}

      {previa && (
        <>
          <div className="grid kpis" style={{ marginBottom: 14 }}>
            <div><div className="faint small">Ativos de bolsa</div><div className="big" style={{ marginTop: 2 }}>{incluidos.length}</div>
              {previa.temPosicao && <div className="muted small">{conferem} conferem com a B3</div>}</div>
            <div><div className="faint small">Operações</div><div className="big" style={{ marginTop: 2 }}>{nOps}</div>
              <div className="muted small">de {previa.contagem.negociacoes} negociações</div></div>
            <div><div className="faint small">Proventos</div><div className="big" style={{ marginTop: 2 }}>{nProv}</div><div className="muted small">{R(vProv)}</div></div>
            <div><div className="faint small">Renda fixa e Tesouro</div><div className="big" style={{ marginTop: 2 }}>{rendaFixa ? previa.rendaFixa.length : 0}</div>
              <div className="muted small">{R(rendaFixa ? previa.rendaFixa.reduce((s, r) => s + r.valorAtual, 0) : 0)}</div></div>
          </div>

          {previa.corte && (
            <div className="note" style={{ marginBottom: 12 }}>
              Posição inicial em <b>{previa.corte.split("-").reverse().join("/")}</b>: só entram operações <b>depois</b> dessa data.
              Proventos entram de todo o período. A conferência com a B3 já soma a posição inicial.
            </div>
          )}
          {previa.desconhecidos.length > 0 && <p className="msg err">Não reconhecidos: {previa.desconhecidos.join(", ")}</p>}

          {previa.sugestoesTroca.length > 0 && (
            <div className="note" style={{ marginBottom: 12 }}>
              <b>Mudanças de código detectadas</b> (já aplicadas; desmarque se estiver errado):
              <div className="checkchips" style={{ marginTop: 8 }}>
                {previa.sugestoesTroca.map((s) => (
                  <label key={s.de} title={s.motivo}>
                    <input type="checkbox" checked={renomear[s.de] === s.para} disabled={analisando} onChange={(e) => trocar(s.de, e.target.checked ? s.para : "")} />
                    {s.de} → {s.para}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0, fontSize: 14 }}>Ativos de bolsa</h2>
            <span className="spacer" />
            <label className="small muted row" style={{ gap: 6 }}><input type="checkbox" checked={soAtencao} onChange={(e) => setSoAtencao(e.target.checked)} />Só os que precisam de atenção</label>
          </div>
          <div className="tablewrap" style={{ maxHeight: 520, overflowY: "auto" }}>
            <table>
              <thead><tr>
                <th className="l"><input type="checkbox" aria-label="Incluir todos" checked={excluir.size === 0}
                  onChange={(e) => setExcluir(e.target.checked ? new Set() : new Set(previa.ativos.map((a) => a.ticker)))} /></th>
                <th className="l">Ativo</th><th className="l">Classe</th><th>Compras/vendas/eventos</th><th>Proventos</th>
                <th>Qtd. calculada</th><th>Qtd. na B3</th><th className="l">Conferência</th>
              </tr></thead>
              <tbody>
                {lista.map((a) => {
                  const fora = excluir.has(a.ticker);
                  return (
                    <tr key={a.ticker} style={fora ? { opacity: 0.45 } : undefined}>
                      <td className="l"><input type="checkbox" checked={!fora} aria-label={`Incluir ${a.ticker}`}
                        onChange={(e) => { const s = new Set(excluir); if (e.target.checked) s.delete(a.ticker); else s.add(a.ticker); setExcluir(s); }} /></td>
                      <td className="l">
                        <span className="tk">{a.ticker}</span>
                        <span className="tkname" title={a.nome ?? ""}>
                          {a.incorporou.length ? `inclui ${a.incorporou.join(", ")} · ` : ""}{a.existe ? "já na carteira" : "novo"}{a.nome ? ` · ${a.nome}` : ""}
                        </span>
                        {(a.existe?.opsManuais ?? 0) > 0 && <span className="msg err" style={{ display: "block", margin: 0, fontSize: 12 }}>
                          já tem {a.existe!.opsManuais} operação(ões) lançadas à mão — pode duplicar</span>}
                      </td>
                      <td className="l">
                        <select value={a.existe ? a.existe.classe : classesSel[a.ticker] ?? a.classe} disabled={!!a.existe || fora}
                          onChange={(e) => setClassesSel({ ...classesSel, [a.ticker]: e.target.value })} style={{ width: "auto", padding: "4px 6px" }}
                          title={a.classeConfirmada ? "Classe pela aba da posição" : "Classe deduzida pelo código"}>
                          {classes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                        </select>
                      </td>
                      <td>{a.compras}/{a.vendas}/{a.eventos}</td>
                      <td>{a.proventos ? <>{a.proventos} <span className="faint">· {R(a.totalProventos)}</span></> : <span className="faint">—</span>}</td>
                      <td>{Q(a.qtdCalculada)}</td>
                      <td>{previa.temPosicao ? Q(a.qtdB3) : "–"}</td>
                      <td className="l" style={{ whiteSpace: "normal", minWidth: 260 }}>
                        {!a.ajuste ? <span className="pos">✓ confere</span> : (
                          <div className="grid" style={{ gap: 4 }}>
                            <label className="row small" style={{ gap: 6 }}>
                              <input type="checkbox" checked={!semAjuste.has(a.ticker)} disabled={fora}
                                onChange={(e) => { const s = new Set(semAjuste); if (e.target.checked) s.delete(a.ticker); else s.add(a.ticker); setSemAjuste(s); }} />
                              {a.ajuste.tipo === "compra" ? (
                                <>ajuste: entrada de {Q(a.ajuste.quantidade)} a R$
                                  <input className="inline-input" type="text" inputMode="decimal" style={{ width: 80 }} disabled={fora || semAjuste.has(a.ticker)}
                                    value={precoAjuste[a.ticker] ?? String(a.ajuste.preco.toFixed(2)).replace(".", ",")}
                                    onChange={(e) => setPrecoAjuste({ ...precoAjuste, [a.ticker]: e.target.value })} aria-label={`Preço do ajuste de ${a.ticker}`} /></>
                              ) : a.ajuste.tipo === "venda" ? <>ajuste: saída de {Q(a.ajuste.quantidade)} pelo preço médio ({R(a.ajuste.preco)})</>
                                : <>ajuste de incorporação: {Q(a.qtdCalculada)} → {Q(a.qtdB3)} cotas, mantendo o custo total</>}
                            </label>
                            {a.qtdB3 === 0 && a.qtdCalculada > 0 && (
                              <label className="row small" style={{ gap: 6 }}>ou virou
                                <select value={renomear[a.ticker] ?? ""} disabled={analisando || fora} style={{ width: "auto", padding: "2px 6px" }}
                                  onChange={(e) => trocar(a.ticker, e.target.value)}>
                                  <option value="">—</option>
                                  {alvosTroca.filter((t) => t !== a.ticker).map((t) => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </label>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="faint small" style={{ margin: "8px 0 0" }}>
            Ajuste de entrada usa o preço de fechamento da B3 como custo (edite se souber o preço real, ex.: transferência de outra corretora).
            Ajuste de saída usa o preço médio, sem gerar lucro nem prejuízo.
          </p>

          <div className="row" style={{ marginTop: 16, gap: 18 }}>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={proventos} onChange={(e) => setProventos(e.target.checked)} />Importar proventos</label>
            {previa.rendaFixa.length > 0 && (
              <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={rendaFixa} onChange={(e) => setRendaFixa(e.target.checked)} />
                Importar/atualizar {previa.rendaFixa.length} título(s) de renda fixa e Tesouro</label>
            )}
          </div>
          {rendaFixa && previa.rendaFixa.some((r) => r.valorAplicado == null && !r.existe) && (
            <p className="faint small" style={{ margin: "6px 0 0" }}>A B3 não informa o valor aplicado de CDB/LCI: o custo entra igual ao valor atual (rentabilidade zero). Edite na página do ativo se souber.</p>
          )}

          {previa.sairam.length > 0 && (
            <div className="note" style={{ marginTop: 12 }}>
              <b>Saíram da posição</b> (vencidos ou resgatados) — registrar resgate pelo último valor:
              <div className="checkchips" style={{ marginTop: 8 }}>
                {previa.sairam.map((s) => (
                  <label key={s.ticker}><input type="checkbox" checked={resgatar.has(s.ticker)}
                    onChange={(e) => { const x = new Set(resgatar); if (e.target.checked) x.add(s.ticker); else x.delete(s.ticker); setResgatar(x); }} />
                    {s.ticker} · {R(s.valor)}</label>
                ))}
              </div>
            </div>
          )}

          {(previa.avisos.length > 0 || Object.keys(previa.ignorados).length > 0) && (
            <details style={{ marginTop: 12 }}>
              <summary className="small muted" style={{ cursor: "pointer" }}>
                {previa.avisos.length} aviso(s) · {Object.values(previa.ignorados).reduce((s, n) => s + n, 0)} linha(s) não importadas
              </summary>
              {previa.avisos.map((a) => <p key={a} className="small" style={{ margin: "6px 0" }}>• {a}</p>)}
              <div className="tablewrap" style={{ marginTop: 8 }}><table style={{ minWidth: 400 }}><tbody>
                {Object.entries(previa.ignorados).sort((a, b) => b[1] - a[1]).map(([k, n]) => (
                  <tr key={k}><td className="l small">{k}</td><td className="small">{n}</td></tr>
                ))}
              </tbody></table></div>
            </details>
          )}

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={importar} disabled={importando || analisando}>
              {importando ? "Importando…" : `Importar ${nOps} operação(ões) e ${nProv} provento(s)`}
            </button>
            <button className="btn ghost" onClick={() => { setPrevia(null); setErro(""); }} disabled={importando}>Cancelar</button>
            {analisando && <span className="faint small">Recalculando…</span>}
          </div>
        </>
      )}
      {erro && <p className="msg err" role="alert">{erro}</p>}
      {ok && <p className="msg ok" role="status">{ok} <Link href="/">Ver resumo →</Link></p>}
    </div>
  );
}
