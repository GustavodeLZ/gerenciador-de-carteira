import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { atualizarCotacoes } from "@/lib/cotacoes";
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
    return NextResponse.json({ atualizadas: r.ok.length, falharam: r.falha });
  } catch {
    return NextResponse.json({ erro: "falha ao atualizar" }, { status: 500 });
  }
}
