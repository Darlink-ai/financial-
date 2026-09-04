import { NextResponse } from "next/server";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/invoices/archive-unmatched
 * Body: { startMonth: "YYYY-MM", endMonth: "YYYY-MM" }
 * Auth: Bearer CRON_SECRET
 *
 * Bulk-passe en status='archived' toutes les factures dont invoice_date
 * tombe dans [startMonth, endMonth] et qui ne sont PAS déjà matched
 * (donc les 'renamed', 'manual', 'classified', 'uploaded'…). Le "fichier 0"
 * du user = un dépôt où on met les factures non-traitables pour les
 * sortir de la vue "à traiter" sans les supprimer.
 *
 * Réversible via /api/invoices/unarchive.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    startMonth?: string;
    endMonth?: string;
  };
  if (
    !body.startMonth ||
    !body.endMonth ||
    !/^\d{4}-\d{2}$/.test(body.startMonth) ||
    !/^\d{4}-\d{2}$/.test(body.endMonth)
  ) {
    return NextResponse.json(
      { error: "bad_params", message: "startMonth + endMonth YYYY-MM requis." },
      { status: 400 },
    );
  }

  const sql = postgres(
    process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "postgres://localhost/postgres",
    { max: 1, prepare: false, ssl: "require" },
  );
  try {
    const affected = await sql<{ id: string; creditor: string | null; status: string }[]>`
      UPDATE invoices
      SET status = 'archived'
      WHERE invoice_date IS NOT NULL
        AND to_char(invoice_date, 'YYYY-MM') >= ${body.startMonth}
        AND to_char(invoice_date, 'YYYY-MM') <= ${body.endMonth}
        AND status != 'matched'
        AND status != 'archived'
      RETURNING id, creditor, status
    `;
    return NextResponse.json({
      ok: true,
      count: affected.length,
      invoices: affected.map((r) => ({ id: r.id, creditor: r.creditor })),
    });
  } finally {
    await sql.end();
  }
}
