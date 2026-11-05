import { NextResponse } from "next/server";
import { saveExcelSheet } from "@/lib/db";
import { rematchInvoicesForBucket } from "@/lib/auto-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * POST /api/admin/upload-sheet
 * Body: { month: "YYYY-MM", currency: "USD"|"EUR"|"CHF", fileName, headers, rows }
 * Auth: Bearer CRON_SECRET
 *
 * Même logique que PUT /api/excel-sheets/[month] mais sans la session
 * Supabase — permet aux scripts admin d'uploader un fichier banque.
 * Déclenche aussi le rematch automatique des factures du bucket.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    month?: string;
    currency?: string;
    fileName?: string;
    headers?: string[];
    rows?: (string | number | null)[][];
  };
  if (
    !body.month ||
    !/^\d{4}-\d{2}$/.test(body.month) ||
    !body.currency ||
    !["USD", "EUR", "CHF"].includes(body.currency.toUpperCase()) ||
    !body.fileName ||
    !Array.isArray(body.headers) ||
    !Array.isArray(body.rows)
  ) {
    return NextResponse.json(
      { error: "bad_body", message: "month, currency, fileName, headers, rows requis" },
      { status: 400 },
    );
  }
  const accountCurrency = body.currency.toUpperCase();
  try {
    const saved = await saveExcelSheet({
      month: body.month,
      accountCurrency,
      fileName: body.fileName,
      headers: body.headers,
      rows: body.rows,
    });
    let rematch: { matched: number; cleared: number } | null = null;
    try {
      rematch = await rematchInvoicesForBucket({
        month: body.month,
        accountCurrency,
      });
    } catch (e) {
      console.error("rematchInvoicesForBucket failed", e);
    }
    return NextResponse.json({
      ok: true,
      month: body.month,
      currency: accountCurrency,
      rowsSaved: body.rows.length,
      fileName: saved.fileName,
      rematch,
    });
  } catch (e) {
    console.error("POST /api/admin/upload-sheet failed", e);
    return NextResponse.json(
      { error: "db_error", message: (e as Error).message },
      { status: 503 },
    );
  }
}
