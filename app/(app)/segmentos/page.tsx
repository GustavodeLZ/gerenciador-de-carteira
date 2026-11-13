import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { carregarCarteira } from "@/lib/dados";
import { R, P, rotulo, subRotulo, classeInfo, CLASSES } from "@/lib/carteira";
import { salvarSegmento, excluirSegmento, vincularAtivos, desvincularAtivo, definirMetaAtivo } from "@/app/actions";
import { ActionForm, ActionButton, MetaInput } from "@/components/forms";
import { SeletorAtivos } from "@/components/seletor-ativos";
import { carregarComparacao } from "@/lib/comparacao";
import { GraficoComparacao } from "@/components/grafico-comparacao";
import { ClasseLabel } from "@/components/ui";

function FormSegmento({ s }: { s?: { id: string; nome: string; descricao: string | null; meta_pct: number | null } }) {
  return (
    <ActionForm action={salvarSegmento} className="form" resetOnOk={!s}>
      {s && <input type="hidden" name="id" value={s.id} />}
      <label className="f">Nome<input type="text" name="nome" required defaultValue={s?.nome} placeholder="Dividendos" /></label>
      <label className="f">Meta na carteira (%)<input type="text" inputMode="decimal" name="meta_pct" defaultValue={s?.meta_pct == null ? "" : String(s.meta_pct).replace(".", ",")} placeholder="opcional" /></label>
      <label className="f full">Descrição<input type="text" name="descricao" defaultValue={s?.descricao ?? ""} placeholder="opcional" /></label>
      <div className="full row"><button className="btn primary sm">{s ? "Salvar" : "Criar segmento"}</button>
        {s && <><span className="spacer" /><ActionButton run={excluirSegmento.bind(null, s.id)} confirmar="Excluir segmento?" className="btn sm ghost danger">Excluir segmento</ActionButton></>}
      </div>
    </ActionForm>
  );
}

export default async function Segmentos({ searchParams }: { searchParams: Promise<{ s?: string; novo?: string; editar?: string }> }) {
  const { s: sel, novo, editar } = await searchParams;
  const { supabase } = await requireUser();
  const c = await carregarCarteira(supabase);

  if (!c.segmentos.length || novo) {
    return (
      <div className="card" style={{ maxWidth: 640 }}>
        <h2>Novo segmento</h2>
        {!c.segmentos.length && <p className="muted" style={{ marginTop: 0 }}>Segmentos são carteiras dentro da carteira. Ex.: “Dividendos” com ITUB4, TAEE11 e HGLG11 — você vê o peso de cada um no segmento e na carteira total.</p>}
        <FormSegmento />
        {c.segmentos.length > 0 && <p style={{ marginTop: 12 }}><Link href="/segmentos">← Voltar</Link></p>}
      </div>
    );
  }

  const r = c.resumoSegmentos.find((x) => x.segmento.id === sel) ?? c.resumoSegmentos[0];
  const s = r.segmento;
  const dentro = new Set(c.vinculos.filter((v) => v.segmento_id === s.id).map((v) => v.ativo_id));
  const ordemClasse = (id: string) => CLASSES.findIndex((x) => x.id === id);
  const fora = c.posicoes.filter((p) => !dentro.has(p.ativo.id))
    .sort((a, b) => ordemClasse(a.ativo.classe) - ordemClasse(b.ativo.classe) || rotulo(a.ativo).localeCompare(rotulo(b.ativo), "pt-BR", { numeric: true }));
  const meta = s.meta_pct == null ? null : Number(s.meta_pct);
  const comparacao = dentro.size ? await carregarComparacao(supabase, c, dentro).catch(() => null) : null;
  const classesSeg = new Set(r.itens.map((i) => i.posicao.ativo.classe));
  const padraoSeg = ["CDI", ...(classesSeg.has("fii") ? ["IFIX"] : []), ...(classesSeg.has("acao") ? ["IDIV", "IBOV"] : []),
    ...([...classesSeg].some((k) => ["exterior", "etf_exterior", "reit"].includes(k)) ? ["SP500"] : [])].slice(0, 4);
  const diffSeg = meta == null ? null : (meta / 100) * c.total - r.valor;

  return (
    <div className="grid seglayout">
      <nav className="card seglist" style={{ padding: 10, alignSelf: "start" }} aria-label="Segmentos">
        {c.resumoSegmentos.map((x) => (
          <Link key={x.segmento.id} href={`/segmentos?s=${x.segmento.id}`} className={x.segmento.id === s.id ? "on" : ""}>
            <b style={{ fontWeight: 600 }}>{x.segmento.nome}</b><span className="faint">{P(x.pctCarteira)}</span>
          </Link>
        ))}
        <Link href="/segmentos?novo=1" style={{ color: "var(--accent)" }}>+ Novo segmento</Link>
      </nav>

      <div className="grid" style={{ alignSelf: "start" }}>
        <div className="card">
          <div className="row">
            <div><h1>{s.nome}</h1>{s.descricao && <div className="muted">{s.descricao}</div>}</div>
            <span className="spacer" />
            <Link className="btn sm" href={editar ? `/segmentos?s=${s.id}` : `/segmentos?s=${s.id}&editar=1`}>{editar ? "Fechar" : "Editar"}</Link>
          </div>
          {editar && <div style={{ marginTop: 14 }}><FormSegmento s={s} /></div>}
          <div className="grid" style={{ marginTop: 14, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
            <div><div className="faint small">Valor do segmento</div><div className="big" style={{ marginTop: 2 }}>{R(r.valor)}</div></div>
            <div><div className="faint small">Peso na carteira</div><div className="big" style={{ marginTop: 2 }}>{P(r.pctCarteira)}</div></div>
            <div><div className="faint small">Meta na carteira</div><div className="big" style={{ marginTop: 2 }}>{meta == null ? "—" : P(meta / 100)}</div>
              {diffSeg != null && <div className="muted small">{diffSeg > 0 ? `faltam ${R(diffSeg)}` : `acima em ${R(-diffSeg)}`}</div>}</div>
            <div><div className="faint small">Proventos 12m</div><div className="big" style={{ marginTop: 2 }}>{R(r.proventos12m)}</div>
              {r.valor > 0 && <div className="muted small">yield {((r.proventos12m / r.valor) * 100).toFixed(2).replace(".", ",")}%</div>}</div>
          </div>
        </div>

        {comparacao && <GraficoComparacao key={s.id} dados={comparacao} titulo="Rentabilidade do segmento vs índices" nomeSerie="Segmento" padrao={padraoSeg} />}

        <div className="card">
          <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Ativos no segmento</h2><span className="spacer" />
            {fora.length > 0 && <SeletorAtivos key={s.id} run={vincularAtivos.bind(null, s.id)} itens={fora.map((p) => ({
              id: p.ativo.id, rotulo: rotulo(p.ativo), sub: subRotulo(p.ativo), classe: p.ativo.classe,
              classeNome: classeInfo(p.ativo.classe).nome, cor: classeInfo(p.ativo.classe).cor, valor: R(p.valor),
            }))} />}
          </div>
          {r.itens.length ? (
            <>
              <div className="tablewrap"><table>
                <thead><tr><th className="l">Ativo</th><th className="l">Classe</th><th>Saldo</th><th>% no segmento</th><th>% na carteira</th><th>Meta no segmento</th><th>Diferença</th><th>Para atingir a meta</th><th /></tr></thead>
                <tbody>{r.itens.map((i) => {
                  const d = i.meta == null ? null : i.pctSegmento - i.meta / 100;
                  return (
                    <tr key={i.posicao.ativo.id}>
                      <td className="l"><Link className="tk" href={`/ativos/${i.posicao.ativo.id}`}>{rotulo(i.posicao.ativo)}</Link>{rotulo(i.posicao.ativo) !== i.posicao.ativo.ticker && subRotulo(i.posicao.ativo) && <span className="tkname">{subRotulo(i.posicao.ativo)}</span>}</td>
                      <td className="l"><ClasseLabel id={i.posicao.ativo.classe} /></td>
                      <td>{R(i.posicao.valor)}</td>
                      <td><b>{P(i.pctSegmento)}</b></td>
                      <td>{P(i.pctCarteira)}</td>
                      <td><MetaInput valor={i.meta} salvar={definirMetaAtivo.bind(null, s.id, i.posicao.ativo.id)} /></td>
                      <td className="muted">{d == null ? "–" : Math.abs(d) < 0.0005 ? "na meta" : `${Math.abs(d * 100).toFixed(1).replace(".", ",")} p.p. ${d > 0 ? "acima" : "abaixo"}`}</td>
                      <td>{i.aportar == null ? "–" : i.aportar > 0.005 ? `aportar ${R(i.aportar)}` : "—"}</td>
                      <td><ActionButton run={desvincularAtivo.bind(null, s.id, i.posicao.ativo.id)}>Remover</ActionButton></td>
                    </tr>);
                })}</tbody>
                <tfoot><tr>
                  <td className="l" colSpan={2}><b>Total</b></td><td><b>{R(r.valor)}</b></td><td><b>100%</b></td><td><b>{P(r.pctCarteira)}</b></td>
                  <td className={r.somaMetas && Math.abs(r.somaMetas - 100) > 0.01 ? "neg" : ""}>{r.somaMetas ? `${r.somaMetas.toFixed(1).replace(".", ",")}%` : ""}</td>
                  <td className="l faint small" colSpan={3}>{r.somaMetas && Math.abs(r.somaMetas - 100) > 0.01 ? "As metas deveriam somar 100%" : ""}</td>
                </tr></tfoot>
              </table></div>
              <p className="faint small" style={{ margin: "10px 0 0" }}>“Para atingir a meta” usa o valor atual do segmento; depois do aporte os percentuais mudam um pouco. “Remover” tira só deste segmento.</p>
            </>
          ) : <div className="note">Nenhum ativo neste segmento ainda. Use “+ Adicionar ativos”.</div>}
        </div>
      </div>
    </div>
  );
}
