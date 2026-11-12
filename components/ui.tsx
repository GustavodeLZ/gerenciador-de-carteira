import Link from "next/link";
import { classeInfo } from "@/lib/carteira";

export function ClasseLabel({ id }: { id: string }) {
  const c = classeInfo(id);
  return <span className="cls"><span className="sw" style={{ background: c.cor }} />{c.nome}</span>;
}

export function Kpi({ label, valor, sub, cls }: { label: string; valor: string; sub?: string; cls?: string }) {
  return (
    <div className="card kpi">
      <div className="lbl">{label}</div>
      <div className={`val ${cls ?? ""}`}>{valor}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Vazio({ titulo, children }: { titulo: string; children?: React.ReactNode }) {
  return (
    <div className="card empty">
      <h2 style={{ fontSize: 18, color: "var(--text)" }}>{titulo}</h2>
      {children}
    </div>
  );
}

export function CarteiraVazia() {
  return (
    <Vazio titulo="Sua carteira está vazia">
      <p>Registre sua primeira compra ou importe o backup do app anterior.</p>
      <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
        <Link className="btn primary" href="/operacoes#nova">+ Registrar operação</Link>
        <Link className="btn" href="/config#importar">Importar backup</Link>
      </div>
    </Vazio>
  );
}

export const sinal = (v: number | null) => (v == null ? "" : v > 0 ? "pos" : v < 0 ? "neg" : "");
