import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { carregarCarteira } from "@/lib/dados";
import { CLASSES, R, P, dataBR, classeInfo, rotulo } from "@/lib/carteira";
import { Kpi, CarteiraVazia } from "@/components/ui";

export default async function Resumo() {
  const { supabase } = await requireUser();
  const c = await carregarCarteira(supabase);
  if (!c.posicoes.length) return <CarteiraVazia />;

  const T = c.total, resultado = T - c.custo;
  const prov12 = c.posicoes.reduce((s, p) => s + p.proventos12m, 0);
  const classes = CLASSES.map((k) => ({ ...k, v: c.posicoes.filter((p) => p.ativo.classe === k.id).reduce((s, p) => s + p.valor, 0) }))
    .filter((k) => k.v > 0).sort((a, b) => b.v - a.v);
  const top = [...c.posicoes].sort((a, b) => b.valor - a.valor).slice(0, 8);

  return (
    <>
      <div className="grid kpis">
        <Kpi label="Patrimônio" valor={R(T)} sub={`${c.posicoes.length} ativos · cotações de ${dataBR(c.ultimaCotacao)}`} />
        <Kpi label="Custo da posição" valor={R(c.custo)} sub="pelo preço médio" />
        <Kpi label="Resultado não realizado" valor={R(resultado)} sub={c.custo ? `${P(resultado / c.custo)} sobre o custo` : undefined} cls={resultado >= 0 ? "pos" : "neg"} />
        <Kpi label="Proventos (12 meses)" valor={R(prov12)} sub={T ? `${P(prov12 / T)} do patrimônio` : undefined} />
      </div>

      <div className="grid two" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>Distribuição por classe</h2>
          <div className="stack" role="img" aria-label="Distribuição por classe">
            {classes.map((k) => <div key={k.id} title={`${k.nome}: ${P(k.v / T)}`} style={{ width: `${(k.v / T) * 100}%`, background: k.cor }} />)}
          </div>
          <div className="alloc">
            {classes.map((k) => (
              <Frag key={k.id}>
                <span className="sw" style={{ background: k.cor }} /><span>{k.nome}</span>
                <span className="v">{R(k.v)}</span><span className="pct">{P(k.v / T)}</span>
                <div className="bar"><span style={{ width: `${(k.v / classes[0].v) * 100}%`, background: k.cor }} /></div>
              </Frag>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="row"><h2 style={{ margin: 0 }}>Maiores posições</h2><span className="spacer" /><Link href="/ativos" className="small faint">ver todos</Link></div>
          <div className="alloc" style={{ marginTop: 12 }}>
            {top.map((p) => (
              <Frag key={p.ativo.id}>
                <span className="sw" style={{ background: classeInfo(p.ativo.classe).cor }} />
                <Link className="tk" href={`/ativos/${p.ativo.id}`}>{rotulo(p.ativo)}</Link>
                <span className="v">{R(p.valor)}</span><span className="pct">{P(p.valor / T)}</span>
                <div className="bar"><span style={{ width: `${(p.valor / top[0].valor) * 100}%`, background: classeInfo(p.ativo.classe).cor }} /></div>
              </Frag>
            ))}
          </div>
        </div>
      </div>

      <div className="row" style={{ margin: "22px 0 10px" }}>
        <h2 style={{ margin: 0 }}>Segmentos</h2><span className="spacer" />
        <Link className="btn sm" href="/segmentos?novo=1">+ Segmento</Link>
      </div>
      {c.resumoSegmentos.length ? (
        <div className="grid segcards">
          {c.resumoSegmentos.map((s) => (
            <Link key={s.segmento.id} href={`/segmentos?s=${s.segmento.id}`} className="card segcard">
              <div style={{ fontWeight: 600 }}>{s.segmento.nome}</div>
              <div className="faint small">{s.itens.length} ativo{s.itens.length === 1 ? "" : "s"}{s.proventos12m ? ` · ${R(s.proventos12m)} em proventos 12m` : ""}</div>
              <div className="big">{R(s.valor)}</div>
              <div className="muted small">{P(s.pctCarteira)} da carteira{s.segmento.meta_pct != null ? ` · meta ${P(Number(s.segmento.meta_pct) / 100)}` : ""}</div>
              <div className="meter">
                <span style={{ width: `${Math.min(100, s.pctCarteira * 100)}%` }} />
                {s.segmento.meta_pct != null && <i style={{ left: `${Math.min(100, Number(s.segmento.meta_pct))}%` }} title="Meta" />}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card note">Crie segmentos como “Dividendos” ou “Crescimento” para ver o peso de cada ativo dentro deles e na carteira total.</div>
      )}
    </>
  );
}

function Frag({ children }: { children: React.ReactNode }) { return <>{children}</>; }
