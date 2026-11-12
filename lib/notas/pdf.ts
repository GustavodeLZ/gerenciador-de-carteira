import { getDocumentProxy } from "unpdf";
import { NotaErro } from "./tipos.ts";

type Item = { str: string; transform: number[] };

/**
 * Extrai o texto do PDF em linhas, na ordem visual (de cima para baixo,
 * da esquerda para a direita). Blocos de texto da mesma linha são separados
 * por dois espaços. Tudo em memória: nada é gravado em disco.
 */
export async function linhasDoPdf(bytes: Uint8Array, senha?: string): Promise<string[]> {
  let pdf;
  try {
    // pdf.js 6.x (via unpdf) não executa código de fontes embutidas (falha CVE-2024-4367 corrigida)
    pdf = await getDocumentProxy(bytes, senha ? { password: senha } : {});
  } catch (e) {
    const nome = (e as { name?: string; code?: number })?.name;
    const code = (e as { code?: number })?.code;
    if (nome === "PasswordException") {
      throw new NotaErro(
        code === 2 ? "Senha incorreta." : "Este PDF tem senha. Informe a senha para continuar.",
        code === 2 ? "senha_errada" : "senha",
      );
    }
    throw new NotaErro("Não foi possível abrir o PDF.", "pdf");
  }

  const linhas: string[] = [];
  try {
    for (let p = 1; p <= Math.min(pdf.numPages, 50); p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const grupos: { y: number; itens: { x: number; s: string }[] }[] = [];
      for (const raw of tc.items as Item[]) {
        const s = raw.str?.trim();
        if (!s || !raw.transform) continue;
        const y = raw.transform[5], x = raw.transform[4];
        let g = grupos.find((g) => Math.abs(g.y - y) <= 2);
        if (!g) { g = { y, itens: [] }; grupos.push(g); }
        g.itens.push({ x, s });
      }
      grupos.sort((a, b) => b.y - a.y);
      for (const g of grupos) linhas.push(g.itens.sort((a, b) => a.x - b.x).map((i) => i.s).join("  "));
    }
  } finally {
    const d = pdf as unknown as { destroy?: () => Promise<void>; cleanup?: () => Promise<void> };
    await (d.destroy ?? d.cleanup)?.call(pdf).catch(() => {});
  }
  return linhas;
}
