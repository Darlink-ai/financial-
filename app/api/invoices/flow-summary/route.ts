import { NextResponse } from "next/server";
import { getExcelSheet } from "@/lib/db";
import { computeExpenseTotal } from "@/lib/excel-match";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/invoices/flow-summary?startMonth=2026-01&endMonth=2026-03&auth=<CRON_SECRET>
 *
 * Lit les excel_sheets stockés en DB pour la fenetre de mois × toutes les
 * devises supportées (CHF/EUR/USD), calcule pour chaque sheet le total
 * débit (sorties) et total crédit (entrées) via computeExpenseTotal, puis
 * agrège en CHF au taux fixe (approx Q1 2026).
 *
 * Read-only, aucun effet de bord.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth =
    url.searchParams.get("auth") ??
    (req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const startMonth = url.searchParams.get("startMonth");
  const endMonth = url.searchParams.get("endMonth");
  if (!startMonth || !endMonth || !/^\d{4}-\d{2}$/.test(startMonth) || !/^\d{4}-\d{2}$/.test(endMonth)) {
    return NextResponse.json({ error: "bad_params" }, { status: 400 });
  }

  // Taux de conversion CHF (approx moyenne Q1 2026).
  // Peuvent etre override via query params ?eurchf=... &usdchf=...
  const eurChf = Number(url.searchParams.get("eurchf") ?? "0.94");
  const usdChf = Number(url.searchParams.get("usdchf") ?? "0.80");

  // Enumère les mois de startMonth à endMonth inclus.
  const months = enumerateMonths(startMonth, endMonth);
  const currencies = ["CHF", "EUR", "USD"] as const;

  const sheets: Array<{
    month: string;
    currency: string;
    fileName: string | null;
    totalDebit: number;
    totalCredit: number;
    debitRowCount: number;
    creditRowCount: number;
    totalDebitCHF: number;
    totalCreditCHF: number;
  }> = [];

  for (const m of months) {
    for (const c of currencies) {
      const sheet = await getExcelSheet(m, c);
      if (!sheet) continue;
      const totals = computeExpenseTotal({
        headers: sheet.headers,
        rows: sheet.rows as (string | number | null)[][],
      });
      const rate = c === "CHF" ? 1 : c === "EUR" ? eurChf : usdChf;
      sheets.push({
        month: m,
        currency: c,
        fileName: sheet.fileName,
        totalDebit: round2(totals.totalDebit),
        totalCredit: round2(totals.totalCredit),
        debitRowCount: totals.debitRowCount,
        creditRowCount: totals.creditRowCount,
        totalDebitCHF: round2(totals.totalDebit * rate),
        totalCreditCHF: round2(totals.totalCredit * rate),
      });
    }
  }

  const agg = sheets.reduce(
    (acc, s) => ({
      totalDebitCHF: acc.totalDebitCHF + s.totalDebitCHF,
      totalCreditCHF: acc.totalCreditCHF + s.totalCreditCHF,
      debitRowCount: acc.debitRowCount + s.debitRowCount,
      creditRowCount: acc.creditRowCount + s.creditRowCount,
    }),
    { totalDebitCHF: 0, totalCreditCHF: 0, debitRowCount: 0, creditRowCount: 0 },
  );
  agg.totalDebitCHF = round2(agg.totalDebitCHF);
  agg.totalCreditCHF = round2(agg.totalCreditCHF);

  return NextResponse.json({
    ok: true,
    window: { startMonth, endMonth },
    rates: { eurChf, usdChf },
    sheets,
    aggregateCHF: agg,
  });
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
