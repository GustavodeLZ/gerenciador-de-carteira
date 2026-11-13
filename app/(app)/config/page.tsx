import { requireUser } from "@/lib/auth";
import { carregarCarteira } from "@/lib/dados";
import { dataBR, temCotacaoAuto } from "@/lib/carteira";
import { resumoUso, BANCO } from "@/lib/limites";
import { atualizarCotacoesAgora, importarBackup, sair, apagarCarteira } from "@/app/actions";
import { ActionForm, ActionButton } from "@/components/forms";

export default async function Config() {
  const { supabase } = await requireUser();
  const c = await carregarCarteira(supabase);
  const { data: u } = await supabase.auth.getUser();
  const bolsa = c.ativos.filter((a) => temCotacaoAuto(a)).length;
  const uso = await resumoUso().catch(() => null);
  const mb = (b: number) => (b / 1024 / 1024).toFixed(1).replace(".", ",") + " MB";
  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

  return (
    <div className="grid two">
      <div className="grid" style={{ alignSelf: "start" }}>
        <div className="card">
          <h2>Cotações</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Atualizadas de segunda a sexta às 18h30: B3 pela brapi.dev, EUA pela Finnhub e dólar pela PTAX do Banco Central.
            Última cotação: <b>{dataBR(c.ultimaCotacao)}</b> · dólar: <b>{c.dolar ? c.dolar.toFixed(4).replace(".", ",") : "–"}</b>{c.dolarData ? ` (${dataBR(c.dolarData)})` : ""}.
            {" "}{bolsa} ativo(s) com cotação automática. Renda fixa, Tesouro e cripto usam o preço informado em cada ativo.
          </p>
          <ActionButton run={atualizarCotacoesAgora} className="btn">Atualizar agora</ActionButton>
        </div>
        <div className="card">
          <h2>Conta</h2>
          <p className="muted" style={{ marginTop: 0 }}>Conectado como <b>{u.user?.email}</b> com verificação em duas etapas.</p>
          <form action={sair}><button className="btn">Sair</button></form>
        </div>
        <div className="card" id="limites">
          <h2>Limites dos planos gratuitos</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            O app trava o uso abaixo do limite de cada plano. Nenhum desses serviços cobra no plano gratuito sem cartão cadastrado —
            <b> não cadastre cartão nem faça upgrade</b> e não há como gerar cobrança.
          </p>
          {uso ? (
            <div className="tablewrap"><table style={{ minWidth: 520 }}>
              <thead><tr><th className="l">Serviço</th><th className="l">Plano gratuito</th><th>Uso / trava</th><th>%</th></tr></thead>
              <tbody>
                {uso.servicos.map((s) => (
                  <tr key={s.servico}>
                    <td className="l">{s.nome}<span className="tkname">período {s.periodo}{s.bloqueado ? ` · ${s.bloqueado} bloqueada(s)` : ""}</span></td>
                    <td className="l small">{s.plano}</td>
                    <td>{s.usado.toLocaleString("pt-BR")} / {s.trava.toLocaleString("pt-BR")}</td>
                    <td className={s.pct >= 1 ? "neg" : s.pct >= 0.8 ? "neg" : ""}>{Math.round(s.pct * 100)}%</td>
                  </tr>
                ))}
                {uso.banco && (
                  <tr>
                    <td className="l">Supabase — banco de dados<span className="tkname">aviso em 70% · importações travam em 90%</span></td>
                    <td className="l small">500 MB</td>
                    <td>{mb(uso.banco.bytes)} / {mb(BANCO.planoBytes)}</td>
                    <td className={uso.banco.pct >= BANCO.avisoPct ? "neg" : ""}>{Math.round(uso.banco.pct * 100)}%</td>
                  </tr>
                )}
              </tbody>
            </table></div>
          ) : <p className="muted">Não foi possível ler o uso agora.</p>}
          <details style={{ marginTop: 10 }}>
            <summary className="small muted" style={{ cursor: "pointer" }}>Outros limites (acompanhados nos painéis dos serviços)</summary>
            <ul className="small muted">
              <li><b>Vercel Hobby:</b> 4 h de CPU ativa, 1 milhão de execuções e 100 GB de tráfego por mês. Sem cobrança: ao passar, o recurso para até virar o mês. Uso real deste app: fração mínima.</li>
              <li><b>Supabase:</b> 5 GB de tráfego e 50 mil usuários/mês; projeto pausa após 7 dias sem uso (a rotina diária de cotações mantém ativo).</li>
              <li><b>Envio de e-mails de login (Supabase):</b> poucos por hora no serviço embutido — suficiente para uso pessoal.</li>
              <li><b>GitHub:</b> repositório privado grátis; o app não usa GitHub Actions.</li>
            </ul>
          </details>
        </div>
        <div className="card" id="apagar">
          <h2>Apagar dados da carteira</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Remove todos os ativos, operações e proventos ({c.ativos.length} ativo(s), {c.operacoes.length} operação(ões)). Os segmentos ficam, vazios.
            Use para recomeçar a partir de uma posição inicial. <b>Não dá para desfazer.</b>
          </p>
          <ActionForm action={apagarCarteira} className="row">
            <input type="text" name="confirmacao" placeholder="digite APAGAR" autoComplete="off" style={{ width: 180 }} aria-label="Confirmação" />
            <button className="btn danger">Apagar tudo</button>
          </ActionForm>
        </div>
      </div>
      <div className="card" id="importar" style={{ alignSelf: "start" }}>
        <h2>Importar do app anterior</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          No app antigo, abra “Cotações e dados” → “Copiar backup (JSON)” e cole aqui. Cada ativo vira uma compra na data abaixo, pelo preço médio; segmentos e metas vêm junto.
          Rodar duas vezes duplica as compras.
        </p>
        <ActionForm action={importarBackup} className="grid">
          <label className="f">Data das compras importadas<input type="date" name="data" defaultValue={hoje} required /></label>
          <label className="f">Backup JSON<textarea name="json" required placeholder='{"assets":[…],"segments":[…]}' /></label>
          <div><button className="btn primary">Importar</button></div>
        </ActionForm>
      </div>
    </div>
  );
}
