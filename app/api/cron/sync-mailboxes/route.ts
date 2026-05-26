import { NextResponse } from "next/server";
import { runSync } from "@/lib/sync-engine";
import { getSetting } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro : 5 min max

/**
 * Endpoint appelé par le cron Vercel toutes les ~5 jours (cf. vercel.json).
 * Sécurisé par CRON_SECRET (env var) — Vercel le pose en
 * `Authorization: Bearer ${CRON_SECRET}` automatiquement.
 * Peut être mis en pause via le toggle "Cron actif" (DB setting).
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // Check le flag global "cron_enabled" (toggle UI).
  const enabledVal = await getSetting("cron_enabled");
  const enabled = enabledVal !== "false";
  if (!enabled) {
    return NextResponse.json({
      skipped: true,
      reason: "cron_paused_by_user",
    });
  }

  try {
    const result = await runSync("cron", { lookbackDays: 6 });
    return NextResponse.json(result);
  } catch (e) {
    const err = e as Error;
    console.error("/api/cron/sync-mailboxes crashed", err);
    return NextResponse.json(
      {
        error: "cron_sync_failed",
        message: err.message,
        stack: err.stack?.split("\n").slice(0, 8).join("\n"),
      },
      { status: 500 },
    );
  }
}
