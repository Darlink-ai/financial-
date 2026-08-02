import { NextResponse } from "next/server";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/invoices/unmatch
 * Body : { month: "YYYY-MM", currency: "EUR|CHF|USD", rows: [157, 158, ...] }
 * OU   : { ids: ["inv-xxx", ...] }
 *
 * Retire le vert sur les rows Excel spécifiées : status='matched' →
 * 'renamed' + excel_row_matched=null. Ne supprime PAS les invoices.
 *
 * Auth : Bearer CRON_SECRET.
 */
export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") ?? "";
    const secret = process.env.CRON_SECRET;
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as {
      month?: string;
      currency?: string;
      rows?: number[];
      ids?: string[];
    };

    const sql = postgres(
      process.env.DATABASE_URL ??
        process.env.POSTGRES_URL ??
        "postgres://localhost/postgres",
      { max: 1, prepare: false, ssl: "require" },
    );

    try {
      let updated: { id: string }[] = [];
      if (body.ids && body.ids.length > 0) {
        updated = await sql<{ id: string }[]>`
          UPDATE invoices
          SET status = 'renamed', excel_row_matched = NULL
          WHERE id = ANY(${body.ids})
          RETURNING id
        `;
      } else if (body.month && body.currency && body.rows?.length) {
        updated = await sql<{ id: string }[]>`
          UPDATE invoices
          SET status = 'renamed', excel_row_matched = NULL
          WHERE excel_row_matched = ANY(${body.rows})
            AND account_currency = ${body.currency}
            AND invoice_date IS NOT NULL
            AND to_char(invoice_date, 'YYYY-MM') = ${body.month}
            AND status = 'matched'
          RETURNING id
        `;
      } else {
        return NextResponse.json(
          {
            error: "bad_body",
            message: "Passer { ids } ou { month, currency, rows }",
          },
          { status: 400 },
        );
      }
      return NextResponse.json({
        ok: true,
        unmatched: updated.length,
        ids: updated.map((r) => r.id),
      });
    } finally {
      await sql.end();
    }
  } catch (e) {
    return NextResponse.json(
      { error: "unmatch_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
