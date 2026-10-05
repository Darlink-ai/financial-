import { NextResponse } from "next/server";
import postgres from "postgres";
import { getExcelSheet } from "@/lib/db";
import { detectColumns } from "@/lib/excel-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/invoices/unmatched-rows?startMonth=YYYY-MM&endMonth=YYYY-MM&auth=<CRON_SECRET>
 *
 * Pour chaque mois × devise (CHF/EUR/USD) de la fenêtre, liste les lignes
 * bancaires en DÉBIT (sorties) qui n'ont AUCUNE facture validée (= pas de
 * invoice status='matched' avec excel_row_matched pointant dessus).
 *
 * Ces lignes = depenses pour lesquelles on n'a pas encore remonté le PDF
 * de facture correspondant. Permet d'exporter la liste à traiter.
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
    return NextResponse.json({ error: "bad_params" }, { status: 400 });
  }

  const sql = postgres(
    process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "postgres://localhost/postgres",
    { max: 1, prepare: false, ssl: "require" },
  );

  try {
    // 1) Load les rows matched par (month, currency, excel_row_matched).
    const matchedRows = await sql<
      { month: string; account_currency: string; excel_row_matched: number }[]
    >`
      SELECT to_char(invoice_date, 'YYYY-MM') as month,
             account_currency,
             excel_row_matched
      FROM invoices
      WHERE status = 'matched'
        AND excel_row_matched IS NOT NULL
        AND invoice_date IS NOT NULL
        AND to_char(invoice_date, 'YYYY-MM') >= ${startMonth}
        AND to_char(invoice_date, 'YYYY-MM') <= ${endMonth}
    `;
    const matchedSet = new Set(
      matchedRows.map((r) => `${r.month}|${r.account_currency}|${r.excel_row_matched}`),
    );

    const months = enumerateMonths(startMonth, endMonth);
    const currencies = ["CHF", "EUR", "USD"] as const;

    type UnmatchedRow = {
      month: string;
      currency: string;
      rowNumber: number;
      date: string | null;
      description: string | null;
      amount: number;
      fileName: string;
    };
    const unmatched: UnmatchedRow[] = [];

    for (const m of months) {
      for (const c of currencies) {
        const sheet = await getExcelSheet(m, c);
        if (!sheet) continue;
        const parsed = {
          headers: sheet.headers,
          rows: sheet.rows as (string | number | null)[][],
        };
        const cols = detectColumns(parsed);
        const idxDebit = cols.idxDebit >= 0 ? cols.idxDebit : cols.idxAmount;
        if (idxDebit < 0) continue;

        for (let i = cols.dataStartRow; i < parsed.rows.length; i++) {
          const row = parsed.rows[i];
          if (!row) continue;
          const raw = row[idxDebit];
          const amount = parseAmount(raw);
          if (!amount || amount <= 0) continue;

          const rowNumber = i + 2; // 1-based + header
          const key = `${m}|${c}|${rowNumber}`;
          if (matchedSet.has(key)) continue;

          const dateCell = cols.idxDate >= 0 ? row[cols.idxDate] : null;
          const descCell = cols.idxCreditor >= 0 ? row[cols.idxCreditor] : null;

          unmatched.push({
            month: m,
            currency: c,
            rowNumber,
            date: formatDateCell(dateCell),
            description: descCell != null ? String(descCell).slice(0, 200) : null,
            amount,
            fileName: sheet.fileName,
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      window: { startMonth, endMonth },
      count: unmatched.length,
      rows: unmatched,
    });
  } finally {
    await sql.end();
  }
}

function enumerateMonths(start: string, end: string): string[] {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const out: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

function parseAmount(raw: string | number | null | undefined): number {
  if (raw == null) return 0;
  if (typeof raw === "number") return Math.abs(raw);
  const cleaned = String(raw)
    .replace(/[\s'’]/g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

function formatDateCell(cell: unknown): string | null {
  if (cell == null) return null;
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  const s = String(cell);
  // Try ISO
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Try DD.MM.YYYY or DD/MM/YYYY
  const dmy = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})/);
  if (dmy) {
    const [, d, mo, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return s.slice(0, 20);
}
