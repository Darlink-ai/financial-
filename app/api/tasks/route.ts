import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/supabase/env";
import { listAllRowAssignments, type RowAssignee } from "@/lib/db";
import { enrichAssignments } from "@/lib/row-assignment-cascade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const EMAIL_TO_ASSIGNEE: Record<string, RowAssignee> = {
  "gauthier.koller@famelink.ai": "gauthier",
  "contact@famelink.ai": "gauthier",
  "robin.koller@famelink.ai": "robin",
  "jacqueline@famelink.ai": "jacqueline",
};

export async function GET() {
  let email: string | null = null;
  if (process.env.AUTH_ENABLED !== "true") {
    email = process.env.DEV_FALLBACK_EMAIL ?? "gauthier.koller@famelink.ai";
  } else {
    const supabase = await createSupabaseServerClient();
    if (!supabase)
      return NextResponse.json({ error: "no_auth" }, { status: 503 });
    const { data } = await supabase.auth.getUser();
    email = data.user?.email?.toLowerCase().trim() ?? null;
    if (!email || !isAllowedEmail(email)) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  const me = EMAIL_TO_ASSIGNEE[email] ?? null;
  // Seuls Robin, Gauthier, Jacqueline voient leurs propres tâches ;
  // la section « À créer » est visible pour ces 3 personnes.
  if (!me) {
    return NextResponse.json({ error: "no_tasks_for_this_user" }, { status: 403 });
  }

  try {
    const [mine, toCreate] = await Promise.all([
      listAllRowAssignments({ assignee: me }),
      listAllRowAssignments({ assignee: "a_creer" }),
    ]);
    const [mineE, toCreateE] = await Promise.all([
      enrichAssignments(mine),
      enrichAssignments(toCreate),
    ]);
    // Une ligne validée par une facture n'est plus une tâche.
    const open = (list: typeof mineE) => list.filter((r) => !r.matchedCreditor);
    return NextResponse.json({
      me,
      mine: open(mineE),
      toCreate: open(toCreateE),
    });
  } catch (e) {
    console.error("GET /api/tasks failed", e);
    return NextResponse.json(
      { error: "db_error", message: (e as Error).message },
      { status: 503 },
    );
  }
}
