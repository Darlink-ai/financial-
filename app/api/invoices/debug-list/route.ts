import { NextResponse } from "next/server";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/invoices/debug-list?month=2026-03&currency=CHF&auth=<CRON_SECRET>
 * Liste les factures validées (status='matched' + excel_row_matched non-null)
 * pour un mois + devise donnés, triées par n° de ligne Excel.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = url.searchParams.get("auth") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const month = url.searchParams.get("month");
  const currency = url.searchParams.get("currency");
  if (!month || !currency) {
    return NextResponse.json(
      { error: "missing_params", message: "month + currency requis." },
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
    const rows = await sql<
      {
        id: string;
        creditor: string | null;
        amount: string | null;
        currency: string | null;
        invoice_date: Date | null;
        excel_row_matched: number | null;
        status: string;
        account_currency: string;
        mailbox: string;
      }[]
    >`
      SELECT id, creditor, amount, currency, invoice_date,
             excel_row_matched, status, account_currency, mailbox
      FROM invoices
      WHERE to_char(invoice_date, 'YYYY-MM') = ${month}
        AND account_currency = ${currency}
        AND excel_row_matched IS NOT NULL
      ORDER BY excel_row_matched ASC
    `;
    return NextResponse.json({
      ok: true,
      count: rows.length,
      invoices: rows.map((r) => ({
        id: r.id,
        creditor: r.creditor,
        amount: r.amount != null ? Number(r.amount) : null,
        currency: r.currency,
        invoiceDate: r.invoice_date?.toISOString().slice(0, 10),
        excelRowMatched: r.excel_row_matched,
        status: r.status,
        accountCurrency: r.account_currency,
        mailbox: r.mailbox,
      })),
    });
  } finally {
    await sql.end();
  }
}
