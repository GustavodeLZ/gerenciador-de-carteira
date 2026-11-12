import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { carregarCarteira } from "@/lib/dados";
import { CLASSES, R, M, MP, P, Q, dataBR, temCotacaoAuto } from "@/lib/carteira";
import { salvarAtivo, excluirAtivo, excluirOperacao, definirSegmentosDoAtivo } from "@/app/actions";
import { ActionForm, ActionButton } from "@/components/forms";
import { ClasseLabel, Kpi, sinal } from "@/components/ui";

const NOME_PROV: Record<string, string> = { dividendo: "Dividendo", jcp: "JCP", rendimento: "Rendimento", juros: "Juros", outro: "Outro" };
const NOME_OP: Record<string, string> = { compra: "Compra", venda: "Venda", desdobramento: "Desdobramento", grupamento: "Grupamento", bonificacao: "Bonificação" };

export default async function AtivoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const c = await carregarCarteira(supabase);
  const p = c.todas.find((x) => x.ativo.id === id);
  if (!p) notFound();
  const a = p.ativo;
  const ops = c.operacoes.filter((o) => o.ativo_id === id).sort((x, y) => y.data.localeCompare(x.data));
  const provs = c.proventos.filter((o) => o.ativo_id === id).sort((x, y) => y.data_pagamento.localeCompare(x.data_pagamento));
  const meus = new Set(c.vinculos.filter((v) => v.ativo_id === id).map((v) => v.segmento_id));
  const manual = !temCotacaoAuto(a);
  const usd = a.moeda === "USD";

  return (
    <div className="grid">
      <div className="row">
        <div><h1><span className="tk" style={{ fontSize: 20 }}>{a.ticker}</span></h1><div className="muted">{a.nome ?? ""} <ClasseLabel id={a.classe} /></div></div>
        <span className="spacer" />
        <Link className="btn" href={`/operacoes?ativo=${a.id}#nova`}>+ Operação</Link>
        <Link className="btn" href={`/proventos?ativo=${a.id}#novo`}>+ Provento</Link>
      </div>
      <div className="grid kpis">
        <Kpi label="Saldo" valor={R(p.valor)} sub={`${Q(p.quantidade)} × ${MP(p.preco, a.moeda)}${usd ? ` = ${M(p.valorMoeda, "USD")}` : ""}`} />
        <Kpi label="Preço médio" valor={MP(p.precoMedio, a.moeda)} sub={`custo ${R(p.custo)}${usd ? ` (${M(p.custoMoeda, "USD")})` : ""}`} />
        <Kpi label="Resultado" valor={R(p.resultado)} cls={sinal(p.resultado)}
          sub={p.rentabilidade == null ? undefined : usd ? `${P(p.rentabilidade)} em R$ · ${P(p.rentabilidadeMoeda)} em US$` : P(p.rentabilidade)} />
        <Kpi label="Proventos recebidos" valor={R(p.proventos)} sub={`${R(p.proventos12m)} nos últimos 12m · lucro realizado ${M(p.lucroRealizado, a.moeda)}`} />
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Operações</h2>
          {ops.length ? (
            <div className="tablewrap"><table style={{ minWidth: 520 }}>
              <thead><tr><th className="l">Data</th><th className="l">Tipo</th><th>Qtd./fator</th><th>Preço</th><th>Taxas</th><th /></tr></thead>
              <tbody>{ops.map((o) => (
                <tr key={o.id}>
                  <td className="l">{dataBR(o.data)}</td><td className="l">{NOME_OP[o.tipo]}</td><td>{Q(Number(o.quantidade))}</td>
                  <td>{o.tipo === "desdobramento" || o.tipo === "grupamento" ? "–" : MP(Number(o.preco), a.moeda)}</td><td>{M(Number(o.taxas), a.moeda)}</td>
                  <td><ActionButton run={excluirOperacao.bind(null, o.id)} confirmar="Confirmar?">Excluir</ActionButton></td>
                </tr>))}
              </tbody></table></div>
          ) : <p className="muted">Nenhuma operação.</p>}
          {provs.length > 0 && <>
            <h2 style={{ marginTop: 18 }}>Proventos</h2>
            <div className="tablewrap"><table style={{ minWidth: 360 }}><tbody>{provs.map((v) => (
              <tr key={v.id}><td className="l">{dataBR(v.data_pagamento)}</td><td className="l">{NOME_PROV[v.tipo] ?? v.tipo}</td><td>{M(Number(v.valor_total), a.moeda)}</td></tr>
            ))}</tbody></table></div>
          </>}
        </div>
        <div className="grid" style={{ alignSelf: "start" }}>
          <div className="card">
            <h2>Segmentos</h2>
            {c.segmentos.length ? (
              <ActionForm action={definirSegmentosDoAtivo.bind(null, a.id)} resetOnOk={false}>
                <div className="checkchips">{c.segmentos.map((s) => (
                  <label key={s.id}><input type="checkbox" name="segmentos" value={s.id} defaultChecked={meus.has(s.id)} />{s.nome}</label>
                ))}</div>
                <button className="btn sm" style={{ marginTop: 10 }}>Salvar segmentos</button>
              </ActionForm>
            ) : <p className="muted">Nenhum segmento criado. <Link href="/segmentos?novo=1">Criar</Link></p>}
          </div>
          <div className="card">
            <h2>Dados do ativo</h2>
            <ActionForm action={salvarAtivo} className="form" resetOnOk={false}>
              <input type="hidden" name="id" value={a.id} />
              <label className="f">Ticker<input type="text" name="ticker" defaultValue={a.ticker} required /></label>
              <label className="f">Classe<select name="classe" defaultValue={a.classe}>{CLASSES.map((k) => <option key={k.id} value={k.id}>{k.nome}</option>)}</select></label>
              <label className="f">Moeda<select name="moeda" defaultValue={a.moeda}><option value="BRL">Real</option><option value="USD">Dólar</option></select></label>
              <label className="f">Nome<input type="text" name="nome" defaultValue={a.nome ?? ""} /></label>
              <label className="f full">
                {manual ? `Preço atual (${usd ? "US$" : "R$"}) — renda fixa: saldo ÷ quantidade` : `Preço manual (${usd ? "US$" : "R$"}) — opcional, só usado sem cotação`}
                <input type="text" inputMode="decimal" name="preco_manual" defaultValue={a.preco_manual == null ? "" : String(a.preco_manual).replace(".", ",")} />
              </label>
              <div className="row full"><button className="btn primary sm">Salvar</button><span className="spacer" />
                <ActionButton run={excluirAtivo.bind(null, a.id)} confirmar="Excluir tudo deste ativo?" className="btn sm ghost danger">Excluir ativo</ActionButton>
              </div>
            </ActionForm>
          </div>
        </div>
      </div>
    </div>
  );
}
