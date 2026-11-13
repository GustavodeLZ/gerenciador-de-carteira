import ExcelJS from "exceljs";
import { lerMyProfit, type OpMyProfit } from "./myprofit.ts";

function valor(v: ExcelJS.CellValue): unknown {
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) return v.result;
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return v.text;
  }
  return v;
}

/** Se a planilha for o relatório do myProfit, devolve as operações; senão, null. */
export async function tentarMyProfit(bytes: Uint8Array): Promise<{ ops: OpMyProfit[]; ignoradas: string[] } | null> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer); } catch { return null; }
  const ws = wb.worksheets[0];
  if (!ws) return null;
  const linhas: unknown[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => { if (linhas.length < 20000) linhas.push((r.values as ExcelJS.CellValue[]).slice(1).map(valor)); });
  const r = lerMyProfit(linhas);
  return r.ops.length ? r : null;
}
