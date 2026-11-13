import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { carregarCarteira } from "@/lib/dados";
import { CLASSES, R, M, MP, P, Q, dataBR, rotulo, subRotulo } from "@/lib/carteira";
import { ClasseLabel, CarteiraVazia, sinal } from "@/components/ui";

export default async function Ativos({ searchParams }: { searchParams: Promise<{ classe?: string; seg?: string }> }) {
  const { classe = "all", seg = "all" } = await searchParams;
  const { supabase } = await requireUser();
  const c = await carregarCarteira(supabase);
  if (!c.posicoes.length) return <CarteiraVazia />;

  const T = c.total;
  const segsDe = (id: string) => c.vinculos.filter((v) => v.ativo_id === id).map((v) => c.segmentos.find((s) => s.id === v.segmento_id)).filter(Boolean);
  let lista = [...c.posicoes].sort((a, b) => b.valor - a.valor);
  if (classe !== "all") lista = lista.filter((p) => p.ativo.classe === classe);
  if (seg === "none") lista = lista.filter((p) => !segsDe(p.ativo.id).length);
  else if (seg !== "all") lista = lista.filter((p) => c.vinculos.some((v) => v.ativo_id === p.ativo.id && v.segmento_id === seg));
  const sub = lista.reduce((s, p) => s + p.valor, 0);
  const valorClasse = (k: string) => c.posicoes.filter((p) => p.ativo.classe === k).reduce((s, p) => s + p.valor, 0);
  const usadas = CLASSES.filter((k) => c.posicoes.some((p) => p.ativo.classe === k.id));
  const href = (k: string, s: string) => `/ativos?classe=${k}&seg=${s}`;

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="muted small" style={{ width: 70 }}>Classe</span>
        <div className="chips">
          <Link className={`chip ${classe === "all" ? "on" : ""}`} href={href("all", seg)}>Todas</Link>
          {usadas.map((k) => <Link key={k.id} className={`chip ${classe === k.id ? "on" : ""}`} href={href(k.id, seg)}>{k.nome}</Link>)}
        </div>
      </div>
      <div className="row" style={{ marginBottom: 14 }}>
        <span className="muted small" style={{ width: 70 }}>Segmento</span>
        <div className="chips">
          <Link className={`chip ${seg === "all" ? "on" : ""}`} href={href(classe, "all")}>Todos</Link>
          {c.segmentos.map((s) => <Link key={s.id} className={`chip ${seg === s.id ? "on" : ""}`} href={href(classe, s.id)}>{s.nome}</Link>)}
          <Link className={`chip ${seg === "none" ? "on" : ""}`} href={href(classe, "none")}>Sem segmento</Link>
        </div>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr>
            <th className="l">Ativo</th><th className="l">Classe</th><th className="l">Segmentos</th><th>Qtd.</th><th>Preço médio</th>
            <th>Cotação</th><th>Saldo</th><th>Rentab.</th><th>Proventos 12m</th><th>% carteira</th><th>% na classe</th>
          </tr></thead>
          <tbody>
            {lista.map((p) => {
              const vc = valorClasse(p.ativo.classe);
              return (
                <tr key={p.ativo.id}>
                  <td className="l"><Link className="tk" href={`/ativos/${p.ativo.id}`}>{rotulo(p.ativo)}</Link>{subRotulo(p.ativo) && <span className="tkname">{subRotulo(p.ativo)}</span>}</td>
                  <td className="l"><ClasseLabel id={p.ativo.classe} /></td>
                  <td className="l">{segsDe(p.ativo.id).map((s) => <Link key={s!.id} className="tag" href={`/segmentos?s=${s!.id}`}>{s!.nome}</Link>)}{!segsDe(p.ativo.id).length && <span className="faint">—</span>}</td>
                  <td>{Q(p.quantidade)}</td>
                  <td>{MP(p.precoMedio, p.ativo.moeda)}</td>
                  <td title={p.precoFonte === "cotacao" ? `Fechamento de ${dataBR(p.precoData)}` : p.precoFonte === "manual" ? `Preço manual (${dataBR(p.precoData)})` : "Sem cotação: usando o preço médio"}>
                    {MP(p.preco, p.ativo.moeda)}{p.precoFonte !== "cotacao" && <span className="faint"> {p.precoFonte === "manual" ? "m" : "*"}</span>}
                  </td>
                  <td><b>{R(p.valor)}</b>{p.ativo.moeda === "USD" && <span className="tkname" style={{ marginLeft: "auto" }}>{M(p.valorMoeda, "USD")}</span>}</td>
                  <td className={sinal(p.rentabilidade)}>{p.rentabilidade == null ? "–" : (p.rentabilidade > 0 ? "+" : "") + P(p.rentabilidade)}</td>
                  <td>{p.proventos12m ? R(p.proventos12m) : <span className="faint">—</span>}</td>
                  <td>{P(T ? p.valor / T : 0)}</td>
                  <td>{P(vc ? p.valor / vc : 0)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot><tr>
            <td className="l" colSpan={6}><b>{lista.length} ativo{lista.length === 1 ? "" : "s"}</b>{lista.length !== c.posicoes.length && <span className="faint"> (filtrado)</span>}</td>
            <td><b>{R(sub)}</b></td><td /><td /><td><b>{P(T ? sub / T : 0)}</b></td><td />
          </tr></tfoot>
        </table>
      </div>
      <p className="faint small" style={{ margin: "10px 0 0" }}>
        m = preço informado manualmente · * = ainda sem cotação, usando o preço médio · Saldo sempre em R$
        {c.dolar ? ` (dólar ${c.dolar.toFixed(4).replace(".", ",")}${c.dolarData ? `, PTAX de ${dataBR(c.dolarData)}` : ""})` : ""}
      </p>
    </div>
  );
}
