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
    console.error("GET /api/state failed", e);
    return NextResponse.json(
      {
        error: "db_unavailable",
        message:
          "Impossible de joindre la base Postgres. Lance `supabase start` localement ou vérifie DATABASE_URL.",
      },
      { status: 503 },
    );
  }
}
