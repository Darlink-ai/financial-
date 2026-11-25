import { NextResponse } from "next/server";
import { listAllRowAssignments } from "@/lib/db";
import { cascadeAssignment, getCreditorKeyFor } from "@/lib/row-assignment-cascade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/admin/recascade
 * Auth: Bearer CRON_SECRET
 *
 * Relance l'attribution automatique pour chaque attribution posée à la main
 * (utile après un changement de la règle de cascade ou un nouveau relevé).
 * N'écrase jamais une attribution existante.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const manual = (await listAllRowAssignments({})).filter((a) => !a.autoCascaded);
  const results: { source: string; key: string | null; added: number }[] = [];
  for (const a of manual) {
    const key = await getCreditorKeyFor(a.month, a.accountCurrency, a.rowNumber);
    let added = 0;
    if (key) {
      const r = await cascadeAssignment({
        creditorKey: key,
        assignee: a.assignee,
        assignedBy: a.assignedBy,
        sinceMonth: a.month,
        excludeSelf: { month: a.month, currency: a.accountCurrency, row: a.rowNumber },
      });
      added = r.added;
    }
    results.push({ source: `${a.month} ${a.accountCurrency} #${a.rowNumber} → ${a.assignee}`, key, added });
  }
  return NextResponse.json({ ok: true, results });
}
