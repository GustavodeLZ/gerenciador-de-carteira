"use client";
import { useMemo, useState, useTransition } from "react";
import type { Resultado } from "@/app/actions";

export type ItemSeletor = { id: string; rotulo: string; sub: string; classe: string; classeNome: string; cor: string; valor: string };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Escolha de vários ativos de uma vez: busca, filtro por classe e "marcar todos" por grupo. */
export function SeletorAtivos({ itens, run, rotuloBotao = "Adicionar ativos" }: {
  itens: ItemSeletor[]; run: (ids: string[]) => Promise<Resultado>; rotuloBotao?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [classe, setClasse] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<Resultado>(null);
  const [pending, start] = useTransition();

  const classes = useMemo(() => {
    const m = new Map<string, { nome: string; cor: string; n: number }>();
    for (const i of itens) { const c = m.get(i.classe) ?? { nome: i.classeNome, cor: i.cor, n: 0 }; c.n++; m.set(i.classe, c); }
    return [...m.entries()];
  }, [itens]);

  const q = norm(busca.trim());
  const visiveis = itens.filter((i) => (!classe || i.classe === classe) && (!q || norm(`${i.rotulo} ${i.sub}`).includes(q)));
  const grupos = classes.map(([id, c]) => ({ id, ...c, itens: visiveis.filter((i) => i.classe === id) })).filter((g) => g.itens.length);

  const alterna = (ids: string[], marcar: boolean) => setSel((s) => { const n = new Set(s); ids.forEach((id) => (marcar ? n.add(id) : n.delete(id))); return n; });
  const fechar = () => { setAberto(false); setBusca(""); setClasse(""); setSel(new Set()); };

  if (!aberto) {
    return (
      <>
        <button type="button" className="btn sm primary" onClick={() => { setMsg(null); setAberto(true); }}>+ {rotuloBotao}</button>
        {msg?.ok && <span className="msg ok" role="status" style={{ margin: 0 }}>{msg.ok}</span>}
      </>
    );
  }

  return (
    <div className="seletor" role="dialog" aria-label={rotuloBotao}>
      <div className="seletor-topo">
        <input type="search" autoFocus placeholder="Buscar por código ou nome…" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <div className="chips" role="group" aria-label="Filtrar por classe">
          <button type="button" className={`chip${classe ? "" : " on"}`} onClick={() => setClasse("")}>Todas <span>{itens.length}</span></button>
          {classes.map(([id, c]) => (
            <button type="button" key={id} className={`chip${classe === id ? " on" : ""}`} onClick={() => setClasse(classe === id ? "" : id)}>
              <span className="sw" style={{ background: c.cor }} />{c.nome} <span>{c.n}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="seletor-lista">
        {grupos.length === 0 && <p className="faint" style={{ padding: 12, margin: 0 }}>Nenhum ativo encontrado.</p>}
        {grupos.map((g) => {
          const ids = g.itens.map((i) => i.id);
          const todos = ids.every((id) => sel.has(id));
          const alguns = !todos && ids.some((id) => sel.has(id));
          return (
            <section key={g.id}>
              <label className="seletor-grupo">
                <input type="checkbox" checked={todos} ref={(el) => { if (el) el.indeterminate = alguns; }} onChange={(e) => alterna(ids, e.target.checked)} />
                <span className="sw" style={{ background: g.cor }} /><b>{g.nome}</b><span className="faint">{g.itens.length}</span>
              </label>
              <div className="seletor-itens">
                {g.itens.map((i) => (
                  <label key={i.id} className={`seletor-item${sel.has(i.id) ? " on" : ""}`}>
                    <input type="checkbox" checked={sel.has(i.id)} onChange={(e) => alterna([i.id], e.target.checked)} />
                    <span className="nm"><span className="tk">{i.rotulo}</span>{i.sub && <span className="tkname">{i.sub}</span>}</span>
                    <span className="v">{i.valor}</span>
                  </label>
                ))}
              </div>
            </section>
          );
        })}
      </div>
      <div className="seletor-rodape">
        <span className="muted small">{sel.size ? `${sel.size} selecionado(s)` : "Marque os ativos ou um grupo inteiro"}</span>
        {sel.size > 0 && <button type="button" className="btn sm ghost" onClick={() => setSel(new Set())}>Limpar</button>}
        <span className="spacer" />
        <button type="button" className="btn sm ghost" onClick={fechar} disabled={pending}>Cancelar</button>
        <button type="button" className="btn sm primary" disabled={!sel.size || pending}
          onClick={() => start(async () => { const r = await run([...sel]); setMsg(r); if (r?.ok) fechar(); })}>
          {pending ? "Salvando…" : `Adicionar ${sel.size || ""}`}
        </button>
      </div>
      {msg?.erro && <p className="msg err" role="alert" style={{ margin: "8px 0 0" }}>{msg.erro}</p>}
    </div>
  );
}
