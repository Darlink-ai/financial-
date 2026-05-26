import { NextResponse } from "next/server";
import { runSync } from "@/lib/sync-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Trigger manuel depuis l'UI. Body :
 *   { mailboxIds?: string[], lookbackDays?: number,
 *     afterDate?: string YYYY-MM-DD, beforeDate?: string YYYY-MM-DD }
 * Si afterDate/beforeDate fournis, ils ont priorité sur lookbackDays.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    mailboxIds?: string[];
    lookbackDays?: number;
    afterDate?: string;
    beforeDate?: string;
  };

  const result = await runSync("manual", {
    mailboxIds: body.mailboxIds,
    lookbackDays: body.lookbackDays ?? 6,
    afterDate: body.afterDate?.trim() || undefined,
    beforeDate: body.beforeDate?.trim() || undefined,
  });
  return NextResponse.json(result);
}
