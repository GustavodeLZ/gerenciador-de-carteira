import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { carregarCarteira } from "@/lib/dados";
import { CLASSES, M, MP, Q, dataBR } from "@/lib/carteira";
import { adicionarOperacao, excluirOperacao } from "@/app/actions";
import { ActionForm, ActionButton, SeletorAtivo } from "@/components/forms";
import { NotaUpload } from "@/components/nota-upload";

const NOME_OP: Record<string, string> = { compra: "Compra", venda: "Venda", desdobramento: "Desdobramento", grupamento: "Grupamento", bonificacao: "Bonificação" };

export default async function Operacoes({ searchParams }: { searchParams: Promise<{ ativo?: string; pagina?: string }> }) {
  const { ativo, pagina } = await searchParams;
  const { supabase } = await requireUser();
  const c = await carregarCarteira(supabase);
  const tick = new Map(c.ativos.map((a) => [a.id, a.ticker]));
  const moeda = new Map(c.ativos.map((a) => [a.id, a.moeda]));
  const ops = [...c.operacoes].sort((a, b) => b.data.localeCompare(a.data) || (b.criado_em ?? "").localeCompare(a.criado_em ?? ""));
  const pg = Math.max(1, Number(pagina) || 1), por = 50;
  const vis = ops.slice((pg - 1) * por, pg * por);
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

  return (
    <div className="grid">
      <NotaUpload classes={CLASSES} segmentos={c.segmentos.map((s) => ({ id: s.id, nome: s.nome }))} />
      <div className="card" id="nova">
        <h2>Registrar operação</h2>
        <ActionForm action={adicionarOperacao} className="form">
          <SeletorAtivo ativos={c.ativos.map((a) => ({ id: a.id, ticker: a.ticker }))} classes={CLASSES} inicial={ativo} />
          <label className="f">Tipo
            <select name="tipo" defaultValue="compra">
              <option value="compra">Compra</option><option value="venda">Venda</option>
              <option value="desdobramento">Desdobramento</option><option value="grupamento">Grupamento</option>
              <option value="bonificacao">Bonificação</option>
            </select>
          </label>
          <label className="f">Data<input type="date" name="data" defaultValue={hoje} required /></label>
          <label className="f">Quantidade (ou fator)<input type="text" inputMode="decimal" name="quantidade" required placeholder="100" /></label>
          <label className="f">Preço unitário (na moeda do ativo)<input type="text" inputMode="decimal" name="preco" placeholder="34,20" /></label>
          <label className="f">Taxas<input type="text" inputMode="decimal" name="taxas" placeholder="0" /></label>
          <label className="f">Câmbio R$/US$ (só dólar)<input type="text" inputMode="decimal" name="cambio" placeholder="vazio = PTAX do dia" /></label>
          {c.segmentos.length > 0 && (
            <div className="full">
              <div className="small muted" style={{ marginBottom: 6 }}>Adicionar aos segmentos (opcional)</div>
              <div className="checkchips">{c.segmentos.map((s) => <label key={s.id}><input type="checkbox" name="segmentos" value={s.id} />{s.nome}</label>)}</div>
            </div>
          )}
          <div className="full row"><button className="btn primary">Registrar</button>
            <span className="faint small">Desdobramento 1→2: fator 2 · Grupamento 10→1: fator 10 · Renda fixa: quantidade 1 e preço = valor aplicado</span></div>
        </ActionForm>
      </div>

      <div className="card">
        <h2>Histórico ({ops.length})</h2>
        {vis.length ? (
          <div className="tablewrap"><table>
            <thead><tr><th className="l">Data</th><th className="l">Ativo</th><th className="l">Tipo</th><th>Qtd./fator</th><th>Preço</th><th>Taxas</th><th>Total</th><th>Câmbio</th><th /></tr></thead>
            <tbody>{vis.map((o) => {
              const fator = o.tipo === "desdobramento" || o.tipo === "grupamento";
              return (
                <tr key={o.id}>
                  <td className="l">{dataBR(o.data)}</td>
                  <td className="l"><Link className="tk" href={`/ativos/${o.ativo_id}`}>{tick.get(o.ativo_id)}</Link></td>
                  <td className="l">{NOME_OP[o.tipo]}</td>
                  <td>{Q(Number(o.quantidade))}</td>
                  <td>{fator ? "–" : MP(Number(o.preco), moeda.get(o.ativo_id))}</td>
                  <td>{M(Number(o.taxas), moeda.get(o.ativo_id))}</td>
                  <td>{fator ? "–" : M(Number(o.quantidade) * Number(o.preco), moeda.get(o.ativo_id))}</td>
                  <td className="faint">{o.cambio ? Number(o.cambio).toFixed(4).replace(".", ",") : "—"}</td>
                  <td><ActionButton run={excluirOperacao.bind(null, o.id)} confirmar="Confirmar?">Excluir</ActionButton></td>
                </tr>);
            })}</tbody>
          </table></div>
        ) : <p className="muted">Nenhuma operação ainda.</p>}
        {ops.length > por && (
          <div className="row" style={{ marginTop: 10 }}>
            {pg > 1 && <Link className="btn sm" href={`/operacoes?pagina=${pg - 1}`}>← Anteriores</Link>}
            <span className="faint small">Página {pg} de {Math.ceil(ops.length / por)}</span>
            {pg * por < ops.length && <Link className="btn sm" href={`/operacoes?pagina=${pg + 1}`}>Mais antigas →</Link>}
          </div>
        )}
      </div>
    </div>
  );
}
