import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/forms";
import { resumoUso } from "@/lib/limites";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const uso = await resumoUso().catch(() => null);
  return (
    <div className="app">
      <header className="top">
        <Link href="/" className="brand">Minha Carteira</Link>
        <Nav />
        <Link href="/operacoes#nova" className="btn primary">+ Operação</Link>
      </header>
      {uso && uso.alertas.length > 0 && (
        <div className="card note" role="alert" style={{ marginBottom: 14, border: "1px solid var(--neg)" }}>
          <b>Limites dos planos gratuitos:</b>{" "}
          {uso.alertas.join(" · ")} <Link href="/config#limites">Ver detalhes</Link>
        </div>
      )}
      <main>{children}</main>
    </div>
  );
}
