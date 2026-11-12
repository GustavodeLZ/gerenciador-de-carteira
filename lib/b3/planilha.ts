import ExcelJS from "exceljs";

/** Uma linha de planilha como { cabeçalho: valor }. */
export type Linha = Record<string, string | number | null>;
export type Aba = { nome: string; linhas: Linha[] };

export type ArquivosB3 = {
  negociacao: Linha[];
  movimentacao: Linha[];
  posicao: Aba[];
  /** Nomes dos arquivos que não foram reconhecidos */
  desconhecidos: string[];
};

function valorCelula(v: ExcelJS.CellValue): string | number | null {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "string") return typeof v === "string" ? v.trim() : v;
  if (typeof v === "boolean") return String(v);
  if (v instanceof Date) {
    const d = v.getUTCDate(), m = v.getUTCMonth() + 1, y = v.getUTCFullYear();
    return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
  }
  if (typeof v === "object") {
    if ("result" in v && v.result != null) return valorCelula(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("").trim();
    if ("text" in v) return String(v.text).trim();
  }
  return null;
}

/** Lê uma aba: a primeira linha não vazia é o cabeçalho. Linhas de total são descartadas depois. */
function lerAba(ws: ExcelJS.Worksheet): Aba {
  const linhas: Linha[] = [];
  let cab: string[] | null = null;
  ws.eachRow({ includeEmpty: false }, (row) => {
    const vals = (row.values as ExcelJS.CellValue[]).slice(1).map(valorCelula);
    if (!vals.some((v) => v !== null && v !== "")) return;
    if (!cab) { cab = vals.map((v) => String(v ?? "").trim()); return; }
    const l: Linha = {};
    cab.forEach((c, i) => { if (c) l[c] = vals[i] ?? null; });
    linhas.push(l);
  });
  return { nome: ws.name, linhas };
}

/** Identifica cada arquivo pelos cabeçalhos (o nome do arquivo não importa). */
export async function lerArquivosB3(arquivos: { nome: string; bytes: Uint8Array }[]): Promise<ArquivosB3> {
  const out: ArquivosB3 = { negociacao: [], movimentacao: [], posicao: [], desconhecidos: [] };
  for (const arq of arquivos) {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(arq.bytes.buffer.slice(arq.bytes.byteOffset, arq.bytes.byteOffset + arq.bytes.byteLength) as ArrayBuffer);
    } catch {
      out.desconhecidos.push(arq.nome);
      continue;
    }
    const abas = wb.worksheets.slice(0, 20).map(lerAba);
    const cab = (a: Aba) => Object.keys(a.linhas[0] ?? {});
    let reconhecido = false;
    for (const a of abas) {
      const c = cab(a);
      if (c.includes("Data do Negócio") && c.includes("Código de Negociação")) { out.negociacao.push(...a.linhas); reconhecido = true; }
      else if (c.includes("Entrada/Saída") && c.includes("Movimentação")) { out.movimentacao.push(...a.linhas); reconhecido = true; }
      else if (c.includes("Produto") && (c.includes("Código de Negociação") || c.includes("Código") || c.includes("Código ISIN"))) { out.posicao.push(a); reconhecido = true; }
    }
    if (!reconhecido) out.desconhecidos.push(arq.nome);
  }
  return out;
}
