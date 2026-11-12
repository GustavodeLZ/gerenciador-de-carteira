import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/forms";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <div className="app">
      <header className="top">
        <Link href="/" className="brand">Minha Carteira</Link>
        <Nav />
        <Link href="/operacoes#nova" className="btn primary">+ Operação</Link>
      </header>
      <main>{children}</main>
    </div>
  );
}
