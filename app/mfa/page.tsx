"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Modo = { tipo: "carregando" } | { tipo: "cadastrar"; factorId: string; qr: string; segredo: string } | { tipo: "verificar"; factorId: string } | { tipo: "erro"; msg: string };

export default function MfaPage() {
  const router = useRouter();
  const [modo, setModo] = useState<Modo>({ tipo: "carregando" });
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal2") { router.replace("/"); return; }
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) { router.replace("/login"); return; }
      const verificado = data.totp.find((f) => f.status === "verified");
      if (verificado) { setModo({ tipo: "verificar", factorId: verificado.id }); return; }
      // Remove cadastros incompletos de tentativas anteriores
      for (const f of data.all.filter((f) => f.status === "unverified")) await supabase.auth.mfa.unenroll({ factorId: f.id });
      const { data: novo, error: e2 } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Minha Carteira" });
      if (e2 || !novo) { setModo({ tipo: "erro", msg: "Não foi possível iniciar o 2FA. Recarregue a página." }); return; }
      setModo({ tipo: "cadastrar", factorId: novo.id, qr: novo.totp.qr_code, segredo: novo.totp.secret });
    })();
  }, [router]);

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (modo.tipo !== "cadastrar" && modo.tipo !== "verificar") return;
    setEnviando(true); setErro("");
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: modo.factorId, code: codigo.replace(/\s/g, "") });
    setEnviando(false);
    if (error) { setErro("Código inválido. Confira o horário do celular e tente o código atual."); return; }
    router.replace("/");
    router.refresh();
  }

  async function sair() {
    await createClient().auth.signOut();
    router.replace("/login");
  }

  return (
    <main className="auth">
      <div className="card">
        <h1>Verificação em duas etapas</h1>
        {modo.tipo === "carregando" && <p className="muted">Carregando…</p>}
        {modo.tipo === "erro" && <p className="msg err">{modo.msg}</p>}
        {modo.tipo === "cadastrar" && (
          <>
            <p className="muted">
              Primeiro acesso: escaneie o QR code com um app autenticador (Google Authenticator, Authy, 1Password…) e digite o código de 6 dígitos.
            </p>
            <div className="qr">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={modo.qr} alt="QR code para o app autenticador" />
            </div>
            <p className="small faint">Sem câmera? Digite a chave no app: <code>{modo.segredo}</code></p>
          </>
        )}
        {modo.tipo === "verificar" && <p className="muted">Digite o código de 6 dígitos do seu app autenticador.</p>}
        {(modo.tipo === "cadastrar" || modo.tipo === "verificar") && (
          <form onSubmit={confirmar} className="grid" style={{ marginTop: 12 }}>
            <input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus
              value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="000000" aria-label="Código de 6 dígitos" />
            <button className="btn primary" disabled={enviando}>{enviando ? "Verificando…" : "Confirmar"}</button>
            {erro && <p className="msg err">{erro}</p>}
          </form>
        )}
        <button className="btn ghost sm" onClick={sair} style={{ marginTop: 14 }}>Sair</button>
      </div>
    </main>
  );
}
