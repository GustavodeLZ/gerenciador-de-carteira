import { linhasDoPdf } from "./pdf.ts";
import { ehDriveWealth, lerDriveWealth } from "./drivewealth.ts";
import { NotaErro, type NotaLida } from "./tipos.ts";

export { NotaErro } from "./tipos.ts";
export type { NotaLida, OperacaoNota } from "./tipos.ts";

/** Formatos suportados. Para incluir outra corretora, adicione aqui. */
const LEITORES: { nome: string; detecta: (l: string[]) => boolean; le: (l: string[]) => NotaLida }[] = [
  { nome: "DriveWealth (Inter EUA)", detecta: ehDriveWealth, le: lerDriveWealth },
];

export function lerLinhas(linhas: string[]): NotaLida {
  if (!linhas.some((l) => l.trim())) {
    throw new NotaErro("O PDF não tem texto legível (pode ser uma imagem escaneada).", "vazio");
  }
  const leitor = LEITORES.find((l) => l.detecta(linhas));
  if (!leitor) {
    throw new NotaErro(
      "Formato de nota ainda não suportado. Hoje o app lê a confirmação da conta internacional do Inter (DriveWealth).",
      "formato",
    );
  }
  const nota = leitor.le(linhas);
  if (!nota.operacoes.length) throw new NotaErro("Nenhuma operação encontrada nesta nota.", "vazio");
  return nota;
}

export async function lerNotaPdf(bytes: Uint8Array, senha?: string): Promise<NotaLida> {
  return lerLinhas(await linhasDoPdf(bytes, senha));
}
