import { NextResponse } from "next/server";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/invoices/list-unmatched?startMonth=YYYY-MM&endMonth=YYYY-MM&auth=<CRON_SECRET>
 *
 * Liste TOUTES les factures dont invoice_date tombe dans la fenêtre
 * ET dont le status n'est PAS 'matched'. Utile pour identifier les
 * factures non-renseignées / non-traitées / archivées.
 *
 * Trié par (invoice_date, creditor).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = url.searchParams.get("auth") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const startMonth = url.searchParams.get("startMonth");
  const endMonth = url.searchParams.get("endMonth");
  if (!startMonth || !endMonth || !/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) {
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
    const rows = await sql<
      {
        id: string;
        creditor: string | null;
        subject: string | null;
        amount: string | null;
        currency: string | null;
        invoice_date: Date | null;
        received_at: Date | null;
        status: string;
        account_currency: string;
        mailbox: string;
        drive_path: string | null;
        final_name: string | null;
        folder_code: string | null;
        folder_label: string | null;
        last_error: string | null;
      }[]
    >`
      SELECT id, creditor, subject, amount, currency, invoice_date,
             received_at, status, account_currency, mailbox,
             drive_path, final_name, folder_code, folder_label, last_error
      FROM invoices
      WHERE invoice_date IS NOT NULL
        AND to_char(invoice_date, 'YYYY-MM') >= ${startMonth}
        AND to_char(invoice_date, 'YYYY-MM') <= ${endMonth}
        AND status != 'matched'
      ORDER BY invoice_date ASC, creditor ASC NULLS LAST
    `;
    return NextResponse.json({
      ok: true,
      window: { startMonth, endMonth },
      count: rows.length,
      invoices: rows.map((r) => ({
        id: r.id,
        creditor: r.creditor,
        subject: r.subject,
        amount: r.amount != null ? Number(r.amount) : null,
        currency: r.currency,
        invoiceDate: r.invoice_date?.toISOString().slice(0, 10) ?? null,
        month: r.invoice_date?.toISOString().slice(0, 7) ?? null,
        receivedAt: r.received_at?.toISOString().slice(0, 10) ?? null,
        status: r.status,
        accountCurrency: r.account_currency,
        mailbox: r.mailbox,
        drivePath: r.drive_path,
        finalName: r.final_name,
        folderCode: r.folder_code,
        folderLabel: r.folder_label,
        lastError: r.last_error,
      })),
    });
  } finally {
    await sql.end();
  }
}
