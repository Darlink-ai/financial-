import { NextResponse } from "next/server";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/invoices/force-match
 * Body: { id, row, currency, month? }
 * Passe une invoice en status='matched' + excel_row_matched=row +
 * account_currency=currency (+ invoice_date recalé sur month + jour
 * de l'invoice si month fourni). Bearer CRON_SECRET.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    row?: number;
    currency?: string;
    month?: string;
  };
  if (!body.id || !body.row || !body.currency) {
    return NextResponse.json(
      { error: "missing", message: "id, row, currency requis" },
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
    // Optionnel : ré-aligne invoice_date sur le month cible en préservant
    // le jour extrait (utile quand user force un autre mois que celui
    // détecté auto).
    if (body.month) {
      const cur = await sql<{ invoice_date: Date | null }[]>`
        SELECT invoice_date FROM invoices WHERE id = ${body.id}
      `;
      const currentDate = cur[0]?.invoice_date;
      const day = currentDate
        ? String(currentDate.getUTCDate()).padStart(2, "0")
        : "15";
      const newDate = `${body.month}-${day}`;
      await sql`
        UPDATE invoices
        SET status = 'matched',
            excel_row_matched = ${body.row},
            account_currency = ${body.currency},
            invoice_date = ${newDate}
        WHERE id = ${body.id}
      `;
    } else {
      await sql`
        UPDATE invoices
        SET status = 'matched',
            excel_row_matched = ${body.row},
            account_currency = ${body.currency}
        WHERE id = ${body.id}
      `;
    }
    const [inv] = await sql<
      {
        id: string;
        creditor: string | null;
        excel_row_matched: number;
        account_currency: string;
        invoice_date: Date | null;
        status: string;
      }[]
    >`
      SELECT id, creditor, excel_row_matched, account_currency, invoice_date, status
      FROM invoices WHERE id = ${body.id}
    `;
    return NextResponse.json({ ok: true, invoice: inv });
  } finally {
    await sql.end();
  }
}
