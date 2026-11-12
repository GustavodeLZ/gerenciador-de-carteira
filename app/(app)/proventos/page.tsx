import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { carregarCarteira } from "@/lib/dados";
import { R, M, dataBR } from "@/lib/carteira";
import { adicionarProvento, excluirProvento } from "@/app/actions";
import { ActionForm, ActionButton } from "@/components/forms";
import { Kpi } from "@/components/ui";

const NOME: Record<string, string> = { dividendo: "Dividendo", jcp: "JCP", rendimento: "Rendimento", juros: "Juros", outro: "Outro" };

export default async function Proventos({ searchParams }: { searchParams: Promise<{ ativo?: string }> }) {
  const { ativo } = await searchParams;
  const { supabase } = await requireUser();
  const c = await carregarCarteira(supabase);
  const tick = new Map(c.ativos.map((a) => [a.id, a.ticker]));
  const moeda = new Map(c.ativos.map((a) => [a.id, a.moeda]));
  const fx = (id: string) => (moeda.get(id) === "USD" ? c.dolar ?? 1 : 1);
  const lista = [...c.proventos].sort((a, b) => b.data_pagamento.localeCompare(a.data_pagamento));
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

  // últimos 12 meses, mês a mês
  const meses: { k: string; v: number }[] = [];
  const d = new Date(hoje + "T12:00:00");
  for (let i = 11; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    meses.push({ k: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`, v: 0 });
  }
  for (const p of lista) { const m = meses.find((x) => p.data_pagamento.startsWith(x.k)); if (m) m.v += Number(p.valor_total) * fx(p.ativo_id); }
  const total12 = meses.reduce((s, m) => s + m.v, 0);
  const max = Math.max(...meses.map((m) => m.v), 1);
  const ano = hoje.slice(0, 4);
  const noAno = lista.filter((p) => p.data_pagamento.startsWith(ano)).reduce((s, p) => s + Number(p.valor_total) * fx(p.ativo_id), 0);

  return (
    <div className="grid">
      <div className="grid kpis">
        <Kpi label="Últimos 12 meses" valor={R(total12)} sub={`média ${R(total12 / 12)}/mês`} />
        <Kpi label={`Em ${ano}`} valor={R(noAno)} />
        <Kpi label="Yield 12m" valor={c.total ? ((total12 / c.total) * 100).toFixed(2).replace(".", ",") + "%" : "–"} sub="sobre o patrimônio atual" />
        <Kpi label="Total registrado" valor={R(lista.reduce((s, p) => s + Number(p.valor_total) * fx(p.ativo_id), 0))} sub={`${lista.length} lançamentos`} />
      </div>

      <div className="card">
        <h2>Por mês</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(12,1fr)", gap: 6, alignItems: "end", height: 140 }}>
          {meses.map((m) => (
            <div key={m.k} title={`${m.k.slice(5)}/${m.k.slice(0, 4)}: ${R(m.v)}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
              <div style={{ width: "100%", maxWidth: 34, height: `${(m.v / max) * 100}%`, minHeight: m.v ? 2 : 0, background: "var(--c1)", borderRadius: "4px 4px 0 0" }} />
              <span className="faint" style={{ fontSize: 11 }}>{m.k.slice(5)}/{m.k.slice(2, 4)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" id="novo">
        <h2>Registrar provento</h2>
        {c.ativos.length ? (
          <ActionForm action={adicionarProvento} className="form">
            <label className="f">Ativo<select name="ativo_id" defaultValue={ativo ?? ""} required>
              <option value="" disabled>Escolha…</option>
              {c.ativos.map((a) => <option key={a.id} value={a.id}>{a.ticker}</option>)}
            </select></label>
            <label className="f">Tipo<select name="tipo" defaultValue="dividendo">{Object.entries(NOME).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="f">Data de pagamento<input type="date" name="data_pagamento" defaultValue={hoje} required /></label>
            <label className="f">Valor total recebido (na moeda do ativo)<input type="text" inputMode="decimal" name="valor_total" required placeholder="152,40" /></label>
            <div className="full"><button className="btn primary">Registrar</button></div>
          </ActionForm>
        ) : <p className="muted">Cadastre um ativo primeiro em <Link href="/operacoes#nova">Operações</Link>.</p>}
      </div>

      <div className="card">
        <h2>Lançamentos</h2>
        {lista.length ? (
          <div className="tablewrap"><table style={{ minWidth: 520 }}>
            <thead><tr><th className="l">Pagamento</th><th className="l">Ativo</th><th className="l">Tipo</th><th>Valor</th><th /></tr></thead>
            <tbody>{lista.slice(0, 200).map((p) => (
              <tr key={p.id}>
                <td className="l">{dataBR(p.data_pagamento)}</td>
                <td className="l"><Link className="tk" href={`/ativos/${p.ativo_id}`}>{tick.get(p.ativo_id)}</Link></td>
                <td className="l">{NOME[p.tipo] ?? p.tipo}</td><td>{M(Number(p.valor_total), moeda.get(p.ativo_id))}</td>
                <td><ActionButton run={excluirProvento.bind(null, p.id)} confirmar="Confirmar?">Excluir</ActionButton></td>
              </tr>))}
            </tbody>
          </table></div>
        ) : <p className="muted">Nenhum provento registrado.</p>}
      </div>
    </div>
  );
}
