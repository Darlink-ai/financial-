import { NextResponse } from "next/server";
import { deleteAssignmentsFor, type RowAssignee } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const ASSIGNEES = new Set<RowAssignee>(["gauthier", "robin", "jacqueline", "a_creer"]);

/**
 * POST /api/admin/clear-assignee
 * Body: { assignee }   Auth: Bearer CRON_SECRET
 * Retire toutes les tâches d'une personne.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { assignee?: string };
  const assignee = body.assignee as RowAssignee | undefined;
  if (!assignee || !ASSIGNEES.has(assignee)) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const deleted = await deleteAssignmentsFor(assignee);
  return NextResponse.json({ ok: true, assignee, deleted });
}
