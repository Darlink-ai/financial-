import { NextResponse } from "next/server";
import { runSync } from "@/lib/sync-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro : 5 min max

/**
 * Endpoint appelé par le cron Vercel toutes les ~5 jours (cf. vercel.json).
 * Sécurisé par CRON_SECRET (env var) — Vercel le pose en
 * `Authorization: Bearer ${CRON_SECRET}` automatiquement.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const result = await runSync("cron", { lookbackDays: 6 });
  return NextResponse.json(result);
}
