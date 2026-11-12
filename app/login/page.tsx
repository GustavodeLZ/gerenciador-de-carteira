"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"idle" | "enviando" | "enviado" | "erro">("idle");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEstado("enviando");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    // Mesma resposta para e-mail autorizado ou não: não revela quem tem conta.
    // Só o limite de envios (429) é mostrado como erro.
    setEstado(error?.status === 429 ? "erro" : "enviado");
  }

  return (
    <main className="auth">
      <div className="card">
        <h1>Minha Carteira</h1>
        <p className="muted" style={{ marginTop: 0 }}>Entre com seu e-mail. Você receberá um link de acesso.</p>
        {estado === "enviado" ? (
          <div className="note">Se este e-mail estiver autorizado, o link chega em instantes. Abra-o neste mesmo navegador.</div>
        ) : (
          <form onSubmit={enviar} className="grid">
            <label className="f">
              E-mail
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <button className="btn primary" disabled={estado === "enviando"}>
              {estado === "enviando" ? "Enviando…" : "Enviar link"}
            </button>
            {estado === "erro" && <p className="msg err">Não foi possível enviar agora. Tente de novo em alguns minutos.</p>}
          </form>
        )}
      </div>
    </main>
  );
}
