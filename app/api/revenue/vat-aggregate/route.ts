import { NextResponse } from "next/server";
import postgres from "postgres";
import { computeVatByCountry } from "@/lib/vat-provision";
import type { Revenue, TxCounts, FeeRates } from "@/lib/types";
import { EMPTY_TX_COUNTS } from "@/lib/types";
import { DEFAULT_FEE_RATES } from "@/lib/types";
import { getRateToChf } from "@/lib/fx";
import type { AccountCurrency } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/revenue/vat-aggregate?startMonth=YYYY-MM&endMonth=YYYY-MM&auth=<CRON_SECRET>
 *
 * Agrège TOUS les revenus (toutes devises + tous business) sur la fenêtre
 * de mois × tous les pays UE+UK. Retourne pour chaque pays :
 *   - montant CA HT (converti CHF via taux moyens mensuels)
 *   - montant CA HT (converti EUR, pour la déclaration VAT MOSS Irish Revenue)
 *   - taux TVA du pays (standard)
 *   - TVA calculée (CA × taux)
 *
 * Agrégation faite par pays uniquement — on cumule les mois.
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
  if (!startMonth || !endMonth) {
    return NextResponse.json({ error: "bad_params" }, { status: 400 });
  }

  const sql = postgres(
    process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "postgres://localhost/postgres",
    { max: 1, prepare: false, ssl: "require" },
  );

  try {
    type RawRevenue = {
      id: string;
      business_id: string;
      month: string;
      processor: string;
      currency: string;
      captured_amount: string;
      fees: string;
      rolling_reserve_percent: string;
      rolling_reserve_months: number;
      released_at: Date | null;
      validated_at: Date | null;
      notes: string | null;
      country_breakdown: { country: string; amount: number }[] | null;
      country_file_name: string | null;
      tx_counts: Partial<TxCounts> | null;
      fee_rates: Partial<FeeRates> | null;
    };
    const rawRows = await sql<RawRevenue[]>`
      SELECT * FROM revenues
      WHERE month >= ${startMonth} AND month <= ${endMonth}
    `;
    const revenues: Revenue[] = rawRows.map((r) => ({
      id: r.id,
      businessId: r.business_id,
      month: r.month,
      processor: r.processor,
      currency: r.currency,
      capturedAmount: Number(r.captured_amount),
      fees: Number(r.fees),
      rollingReservePercent: Number(r.rolling_reserve_percent),
      rollingReserveMonths: r.rolling_reserve_months,
      releasedAt: r.released_at?.toISOString() ?? null,
      validatedAt: r.validated_at?.toISOString() ?? null,
      notes: r.notes ?? undefined,
      countryBreakdown: r.country_breakdown ?? [],
      countryFileName: r.country_file_name,
      txCounts: { ...EMPTY_TX_COUNTS, ...(r.tx_counts ?? {}) },
      feeRates: { ...DEFAULT_FEE_RATES, ...(r.fee_rates ?? {}) },
    }));

    // Enumère les mois
    const months = enumerateMonths(startMonth, endMonth);
    const perMonth = months.map((m) => computeVatByCountry(revenues, m));

    // Agrège par pays sur la période complète
    const byCountry = new Map<
      string,
      {
        iso: string;
        name: string;
        rate: number;
        amountChf: number;
        vatChf: number;
      }
    >();
    for (const monthSummary of perMonth) {
      for (const row of monthSummary.rows) {
        const existing = byCountry.get(row.country.iso) ?? {
          iso: row.country.iso,
          name: row.country.name,
          rate: row.country.rate,
          amountChf: 0,
          vatChf: 0,
        };
        existing.amountChf += row.amountChf;
        existing.vatChf += row.vatChf;
        byCountry.set(row.country.iso, existing);
      }
    }
    const rows = [...byCountry.values()].sort((a, b) => b.amountChf - a.amountChf);

    // Taux EUR/CHF moyen sur la période (pour conversion EUR → CHF et inverse)
    // getRateToChf(month, "EUR") = CHF for 1 EUR. On moyenne sur les mois.
    const eurChfRates = months.map((m) => getRateToChf(m, "EUR" as AccountCurrency));
    const eurChfAvg =
      eurChfRates.reduce((s, r) => s + r, 0) / Math.max(1, eurChfRates.length);
    // Pour convertir CHF → EUR : amountChf / eurChfAvg
    const toEur = (chf: number) => (eurChfAvg > 0 ? chf / eurChfAvg : chf);

    const rowsWithEur = rows.map((r) => ({
      iso: r.iso,
      name: r.name,
      rate: r.rate,
      amountChf: round2(r.amountChf),
      vatChf: round2(r.vatChf),
      amountEur: round2(toEur(r.amountChf)),
      vatEur: round2(toEur(r.vatChf)),
    }));

    const totalCA_CHF = rows.reduce((s, r) => s + r.amountChf, 0);
    const totalVAT_CHF = rows.reduce((s, r) => s + r.vatChf, 0);

    return NextResponse.json({
      ok: true,
      window: { startMonth, endMonth },
      months,
      count: rowsWithEur.length,
      rows: rowsWithEur,
      totals: {
        amountChf: round2(totalCA_CHF),
        vatChf: round2(totalVAT_CHF),
        amountEur: round2(toEur(totalCA_CHF)),
        vatEur: round2(toEur(totalVAT_CHF)),
      },
      eurChfRate: round2(eurChfAvg),
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

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
