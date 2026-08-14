import { NextResponse } from "next/server";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/invoices/debug-search?q=<term>&auth=<CRON_SECRET>
 * Recherche full-text sur creditor + subject + drive_path + final_name.
 * Renvoie tous les états (matched, renamed, manual).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = url.searchParams.get("auth") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = url.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "missing_q" }, { status: 400 });

  const sql = postgres(
    process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "postgres://localhost/postgres",
    { max: 1, prepare: false, ssl: "require" },
  );
  try {
    const term = `%${q}%`;
    const rows = await sql`
      SELECT id, creditor, subject, amount, currency, invoice_date,
             excel_row_matched, account_currency, status, mailbox,
             drive_path, final_name, last_error
      FROM invoices
      WHERE creditor ILIKE ${term}
         OR subject ILIKE ${term}
         OR drive_path ILIKE ${term}
         OR final_name ILIKE ${term}
      ORDER BY received_at DESC
      LIMIT 50
    `;
    return NextResponse.json({ ok: true, count: rows.length, invoices: rows });
  } finally {
    await sql.end();
  }
}
