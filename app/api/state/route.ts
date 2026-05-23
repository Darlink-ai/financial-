import { NextResponse } from "next/server";
import { getAllState, dbInfo } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await getAllState();
    const info = await dbInfo();
    return NextResponse.json({ ...state, _info: info });
  } catch (e) {
    const err = e as Error & { code?: string };
    console.error("GET /api/state failed", err);
    return NextResponse.json(
      {
        error: "db_unavailable",
        message:
          "Impossible de joindre la base Postgres. Lance `supabase start` localement ou vérifie DATABASE_URL.",
        debug: {
          name: err.name,
          code: err.code,
          message: err.message,
          // Quel URL la fonction tente d'utiliser (sans le password)
          using:
            (process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "local")
              .replace(/:[^:@/]+@/, ":****@"),
          hasDATABASE_URL: !!process.env.DATABASE_URL,
          hasPOSTGRES_URL: !!process.env.POSTGRES_URL,
        },
      },
      { status: 503 },
    );
  }
}
