import { NextResponse } from "next/server";
import { runSync } from "@/lib/sync-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Trigger manuel depuis l'UI. Optionnel : `mailboxIds` pour ne syncer
 * qu'une sélection. Pas de mailboxIds → toutes les boîtes avec
 * sync_enabled = TRUE.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    mailboxIds?: string[];
    lookbackDays?: number;
  };

  const result = await runSync("manual", {
    mailboxIds: body.mailboxIds,
    lookbackDays: body.lookbackDays ?? 6,
  });
  return NextResponse.json(result);
}
