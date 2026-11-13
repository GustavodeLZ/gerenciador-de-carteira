import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { atualizarCotacoes, preencherCambios } from "@/lib/cotacoes";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function autorizado(req: NextRequest) {
  const recebido = Buffer.from(req.headers.get("authorization") ?? "");
  const esperado = Buffer.from(`Bearer ${env.cronSecret()}`);
  return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
}

// A Vercel chama esta rota no horário de vercel.json, enviando o CRON_SECRET.
export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  try {
    const r = await atualizarCotacoes();
    let cambios = 0;
    try { cambios = await preencherCambios(); } catch { /* tenta de novo amanhã */ }
    return NextResponse.json({ cambios, atualizadas: r.ok.length, falharam: r.falha, travadas: r.travados });
  } catch {
    return NextResponse.json({ erro: "falha ao atualizar" }, { status: 500 });
  }
}
