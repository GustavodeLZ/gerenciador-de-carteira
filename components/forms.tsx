"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { Resultado } from "@/app/actions";

/** Formulário ligado a uma server action, com mensagem de erro/sucesso. */
export function ActionForm({
  action, children, className, resetOnOk = true,
}: {
  action: (prev: Resultado, fd: FormData) => Promise<Resultado>;
  children: React.ReactNode; className?: string; resetOnOk?: boolean;
}) {
  const [state, run, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnOk) ref.current?.reset(); }, [state, resetOnOk]);
  return (
    <form ref={ref} action={run} className={className} aria-busy={pending}>
      <fieldset disabled={pending} style={{ border: 0, padding: 0, margin: 0, display: "contents" }}>{children}</fieldset>
      {state?.erro && <p className="msg err full" role="alert">{state.erro}</p>}
      {state?.ok && <p className="msg ok full" role="status">{state.ok}</p>}
    </form>
  );
}

/** Botão que roda uma action; com `confirmar`, pede um segundo clique. */
export function ActionButton({
  run, children, confirmar, className = "btn sm ghost",
}: { run: () => Promise<Resultado>; children: React.ReactNode; confirmar?: string; className?: string }) {
  const [pending, start] = useTransition();
  const [armado, setArmado] = useState(false);
  const [erro, setErro] = useState("");
  useEffect(() => { if (!armado) return; const t = setTimeout(() => setArmado(false), 4000); return () => clearTimeout(t); }, [armado]);
  return (
    <>
      <button type="button" className={className + (armado ? " danger" : "")} disabled={pending}
        onClick={() => {
          if (confirmar && !armado) { setArmado(true); return; }
          setArmado(false);
          start(async () => { const r = await run(); setErro(r?.erro ?? ""); });
        }}>
        {pending ? "…" : armado ? confirmar : children}
      </button>
      {erro && <span className="msg err">{erro}</span>}
    </>
  );
}

/** Campo de meta (%) que salva ao sair do campo. */
export function MetaInput({ valor, salvar }: { valor: number | null; salvar: (v: string) => Promise<Resultado> }) {
  const [pending, start] = useTransition();
  const inicial = valor == null ? "" : String(valor).replace(".", ",");
  return (
    <input className="inline-input" type="text" inputMode="decimal" placeholder="%" defaultValue={inicial} disabled={pending}
      aria-label="Meta no segmento (%)"
      onBlur={(e) => { if (e.target.value !== inicial) start(async () => { await salvar(e.target.value); }); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}

/** Select que roda a action ao escolher. */
export function SelectAction({ opcoes, placeholder, run }: { opcoes: { v: string; l: string }[]; placeholder: string; run: (v: string) => Promise<Resultado> }) {
  const [pending, start] = useTransition();
  return (
    <select style={{ width: "auto" }} disabled={pending} value="" onChange={(e) => { const v = e.target.value; if (v) start(async () => { await run(v); }); }}>
      <option value="">{pending ? "Salvando…" : placeholder}</option>
      {opcoes.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

/** Mostra os campos de "novo ativo" só quando escolhido. */
export function SeletorAtivo({ ativos, classes, inicial }: { ativos: { id: string; ticker: string }[]; classes: { id: string; nome: string }[]; inicial?: string }) {
  const [v, setV] = useState(inicial ?? (ativos.length ? "" : "__novo"));
  return (
    <>
      <label className="f">Ativo
        <select name="ativo_id" value={v} onChange={(e) => setV(e.target.value)} required>
          <option value="" disabled>Escolha…</option>
          <option value="__novo">+ Novo ativo</option>
          {ativos.map((a) => <option key={a.id} value={a.id}>{a.ticker}</option>)}
        </select>
      </label>
      {v === "__novo" && (
        <>
          <label className="f">Ticker / código<input type="text" name="novo_ticker" required placeholder="ITUB4" autoCapitalize="characters" /></label>
          <label className="f">Classe
            <select name="nova_classe" defaultValue="acao">{classes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</select>
          </label>
          <label className="f">Moeda
            <select name="nova_moeda" defaultValue="BRL"><option value="BRL">Real (B3)</option><option value="USD">Dólar (EUA)</option></select>
          </label>
        </>
      )}
    </>
  );
}

export function Nav() {
  const path = usePathname();
  const links = [["/", "Resumo"], ["/ativos", "Ativos"], ["/operacoes", "Operações"], ["/proventos", "Proventos"], ["/segmentos", "Segmentos"], ["/importar", "Importar"], ["/config", "Ajustes"]];
  return (
    <nav className="tabs" aria-label="Seções">
      {links.map(([h, l]) => (
        <Link key={h} href={h} className={(h === "/" ? path === "/" : path.startsWith(h)) ? "on" : ""}>{l}</Link>
      ))}
    </nav>
  );
}
