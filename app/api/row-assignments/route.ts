import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAllowedEmail } from "@/lib/supabase/env";
import {
  deleteRowAssignment,
  getRowAssignmentsForSheet,
  setRowAssignmentProblem,
  upsertRowAssignment,
  type RowAssignee,
} from "@/lib/db";
import {
  cascadeAssignment,
  getCreditorKeyFor,
} from "@/lib/row-assignment-cascade";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MONTH_RE = /^\d{4}-\d{2}$/;
const ALLOWED_CURRENCIES = new Set(["USD", "EUR", "CHF"]);
const ASSIGNEES: ReadonlySet<RowAssignee> = new Set([
  "gauthier",
  "robin",
  "jacqueline",
  "a_creer",
]);

async function requireUserEmail(): Promise<string | null> {
  // En dev (AUTH_ENABLED pas activé), le middleware laisse passer sans
  // session — on retombe sur un email par défaut pour ne pas tout casser.
  if (process.env.AUTH_ENABLED !== "true") {
    return process.env.DEV_FALLBACK_EMAIL ?? "gauthier.koller@famelink.ai";
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email?.toLowerCase().trim() ?? null;
  if (!email || !isAllowedEmail(email)) return null;
  return email;
}

export async function GET(req: Request) {
  const email = await requireUserEmail();
  if (!email)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? "";
  const currency = (url.searchParams.get("currency") ?? "").toUpperCase();
  if (!MONTH_RE.test(month) || !ALLOWED_CURRENCIES.has(currency)) {
    return NextResponse.json({ error: "bad_params" }, { status: 400 });
  }
  try {
    const list = await getRowAssignmentsForSheet(month, currency);
    return NextResponse.json({ assignments: list });
  } catch (e) {
    console.error("GET /api/row-assignments failed", e);
    return NextResponse.json({ error: "db_error" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const email = await requireUserEmail();
  if (!email)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    month?: string;
    currency?: string;
    row?: number;
    assignee?: string;
    cascade?: boolean;
  };
  const month = body.month ?? "";
  const currency = (body.currency ?? "").toUpperCase();
  const row = Number(body.row);
  const assignee = body.assignee as RowAssignee | undefined;
  if (
    !MONTH_RE.test(month) ||
    !ALLOWED_CURRENCIES.has(currency) ||
    !Number.isInteger(row) ||
    row < 2 ||
    !assignee ||
    !ASSIGNEES.has(assignee)
  ) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  try {
    const creditorKey = await getCreditorKeyFor(month, currency, row);
    await upsertRowAssignment({
      month,
      accountCurrency: currency,
      rowNumber: row,
      assignee,
      creditorKey,
      assignedBy: email,
      autoCascaded: false,
    });

    let cascade: { added: number; scanned: number } | null = null;
    if (body.cascade !== false && creditorKey) {
      cascade = await cascadeAssignment({
        creditorKey,
        assignee,
        assignedBy: email,
        sinceMonth: month,
        excludeSelf: { month, currency, row },
      });
    }
    return NextResponse.json({ ok: true, creditorKey, cascade });
  } catch (e) {
    console.error("POST /api/row-assignments failed", e);
    return NextResponse.json(
      { error: "db_error", message: (e as Error).message },
      { status: 503 },
    );
  }
}

export async function PATCH(req: Request) {
  const email = await requireUserEmail();
  if (!email)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    month?: string;
    currency?: string;
    row?: number;
    problem?: boolean;
  };
  const month = body.month ?? "";
  const currency = (body.currency ?? "").toUpperCase();
  const row = Number(body.row);
  if (
    !MONTH_RE.test(month) ||
    !ALLOWED_CURRENCIES.has(currency) ||
    !Number.isInteger(row) ||
    row < 2 ||
    typeof body.problem !== "boolean"
  ) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  try {
    const ok = await setRowAssignmentProblem(month, currency, row, body.problem);
    if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("PATCH /api/row-assignments failed", e);
    return NextResponse.json({ error: "db_error" }, { status: 503 });
  }
}

export async function DELETE(req: Request) {
  const email = await requireUserEmail();
  if (!email)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    month?: string;
    currency?: string;
    row?: number;
  };
  const month = body.month ?? "";
  const currency = (body.currency ?? "").toUpperCase();
  const row = Number(body.row);
  if (
    !MONTH_RE.test(month) ||
    !ALLOWED_CURRENCIES.has(currency) ||
    !Number.isInteger(row) ||
    row < 2
  ) {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  try {
    await deleteRowAssignment(month, currency, row);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("DELETE /api/row-assignments failed", e);
    return NextResponse.json({ error: "db_error" }, { status: 503 });
  }
}
