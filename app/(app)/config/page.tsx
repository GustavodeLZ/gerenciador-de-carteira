import { requireUser } from "@/lib/auth";
import { carregarCarteira } from "@/lib/dados";
import { dataBR, temCotacaoAuto } from "@/lib/carteira";
import { atualizarCotacoesAgora, importarBackup, sair, apagarCarteira } from "@/app/actions";
import { ActionForm, ActionButton } from "@/components/forms";

export default async function Config() {
  const { supabase } = await requireUser();
  const c = await carregarCarteira(supabase);
  const { data: u } = await supabase.auth.getUser();
  const bolsa = c.ativos.filter((a) => temCotacaoAuto(a)).length;
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
