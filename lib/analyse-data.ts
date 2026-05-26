/**
 * Hook + helpers d'agrégation pour la page /analyse.
 *
 * Données réelles dispo aujourd'hui :
 *  - Revenus : table `revenues` (merchant pay file → capturedAmount par
 *    business + processeur).
 *  - Dépenses : somme des débits des 3 fichiers de rapprochement Excel
 *    (CHF / EUR / USD) du mois — chargés depuis `/api/excel-sheets/:month`.
 *
 * Devise d'affichage : CHF (utilisateur en Suisse). Les montants USD/EUR
 * sont convertis vers CHF via les taux moyens mensuels listés dans
 * MONTHLY_FX_TO_CHF / DEFAULT_FX_TO_CHF (à remplacer par un feed FX réel).
 *
 * Ce qui nécessite un calcul plus poussé (EBITDA, impôts, marge brute…)
 * reste géré côté mock pour l'instant — sera branché ensuite.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  computeExpenseTotal,
  type ParsedSheet,
} from "@/lib/excel-match";
import type { Period } from "@/components/AnalysePeriodPicker";
import { useStore } from "@/lib/store";
import type { AccountCurrency, Business, Revenue } from "@/lib/types";

/**
 * Taux de change par défaut (1 unité de la devise = X CHF).
 * Moyennes approximatives 2024-2026. À surcharger par mois via
 * MONTHLY_FX_TO_CHF pour plus de précision.
 *
 * TODO : intégrer un vrai feed FX (exchangerate.host, ECB, BNS…) pour
 * obtenir les taux moyens du mois en réel et virer ces constantes.
 */
const DEFAULT_FX_TO_CHF: Record<AccountCurrency, number> = {
  CHF: 1,
  USD: 0.88,
  EUR: 0.94,
};

/**
 * Overrides par mois — quand on connaît le taux moyen exact pour un
 * mois donné. Format : "YYYY-MM" → { USD?, EUR? } (CHF est toujours 1).
 */
const MONTHLY_FX_TO_CHF: Record<
  string,
  Partial<Record<AccountCurrency, number>>
> = {
  // Exemples (à remplir avec des valeurs BNS quand on les intègre) :
  // "2026-01": { USD: 0.87, EUR: 0.93 },
};

/** Récupère le taux de change pour 1 unité de `currency` → CHF, pour le
 *  mois donné. Tombe sur DEFAULT_FX_TO_CHF si pas d'override. */
function getRateToChf(month: string, currency: AccountCurrency): number {
  if (currency === "CHF") return 1;
  const override = MONTHLY_FX_TO_CHF[month]?.[currency];
  return override ?? DEFAULT_FX_TO_CHF[currency];
}

export const DISPLAY_CURRENCY: AccountCurrency = "CHF";

export type MonthlyAgg = {
  month: string; // YYYY-MM
  revenue: number; // CHF
  expenses: number; // CHF (somme convertie des 3 buckets)
  net: number; // revenue - expenses
};

export type ExpenseByCurrency = {
  currency: AccountCurrency;
  amount: number; // dans la devise locale
  amountChf: number; // converti
  fileName: string | null;
};

export type FxRatesSummary = {
  /** Taux moyen utilisé sur la période, par devise. 1 unité = X CHF. */
  averages: Record<Exclude<AccountCurrency, "CHF">, number>;
  /** Détail mois par mois pour info / debug. */
  perMonth: { month: string; USD: number; EUR: number }[];
  /** True si au moins 1 mois utilise un override (taux exact), sinon on
   *  affiche les valeurs par défaut. */
  hasOverrides: boolean;
};

export type AnalyseAggregates = {
  loading: boolean;
  /** Mois inclus dans la période (du plus ancien au plus récent). */
  months: string[];
  /** Série complète revenu / dépenses / net en CHF, par mois. */
  series: MonthlyAgg[];
  /** Totaux sur la période complète. */
  totals: {
    revenue: number; // CHF
    expenses: number; // CHF total
    net: number; // CHF
    expensesByCurrency: ExpenseByCurrency[];
  };
  /** Ventilation CA par business sur la période (en CHF). */
  byBusiness: { id: string; name: string; color: string; amount: number; share: number }[];
  /** Ventilation CA par processeur de paiement (EMP, Centrobill, …) en CHF. */
  byProcessor: Record<string, number>;
  /** Taux de change utilisés sur la période. */
  fx: FxRatesSummary;
};

/** Construit la liste des mois "YYYY-MM" couverts par la période. */
function monthsInPeriod(p: Period): string[] {
  if (p.kind === "month") {
    return [fmt(p.year, p.month)];
  }
  if (p.kind === "quarter") {
    const start = (p.quarter - 1) * 3 + 1;
    return [fmt(p.year, start), fmt(p.year, start + 1), fmt(p.year, start + 2)];
  }
  if (p.kind === "year") {
    return Array.from({ length: 12 }, (_, i) => fmt(p.year, i + 1));
  }
  // YTD : du Jan jusqu'au mois courant (de l'année p.year)
  const now = new Date();
  const last =
    p.year === now.getFullYear() ? now.getMonth() + 1 : 12;
  return Array.from({ length: last }, (_, i) => fmt(p.year, i + 1));
}

function fmt(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Récupère un sheet via l'API, ou null si rien stocké. */
async function fetchSheet(
  month: string,
  currency: AccountCurrency,
  signal: AbortSignal,
): Promise<{ sheet: ParsedSheet | null; fileName: string | null }> {
  try {
    const r = await fetch(`/api/excel-sheets/${month}?currency=${currency}`, {
      cache: "no-store",
      signal,
    });
    if (!r.ok) return { sheet: null, fileName: null };
    const data = (await r.json()) as {
      sheet: {
        headers: string[];
        rows: (string | number | null)[][];
        fileName: string;
      } | null;
    };
    if (!data.sheet) return { sheet: null, fileName: null };
    return {
      sheet: { headers: data.sheet.headers, rows: data.sheet.rows },
      fileName: data.sheet.fileName,
    };
  } catch {
    return { sheet: null, fileName: null };
  }
}

const CURRENCIES: AccountCurrency[] = ["USD", "EUR", "CHF"];

/**
 * Hook principal. Agrège revenus + dépenses sur la période, tout converti
 * en CHF via les taux moyens mensuels.
 */
export function useAnalyseAggregates(period: Period): AnalyseAggregates {
  const { revenues, businesses } = useStore();
  const months = useMemo(() => monthsInPeriod(period), [period]);

  // monthlySheets[month][currency] = { amount, fileName } en devise locale
  const [monthlySheets, setMonthlySheets] = useState<
    Record<string, Partial<Record<AccountCurrency, { amount: number; fileName: string | null }>>>
  >({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setLoading(true);
    (async () => {
      const next: typeof monthlySheets = {};
      // Charge en parallèle tous les buckets de la période.
      await Promise.all(
        months.flatMap((month) =>
          CURRENCIES.map(async (currency) => {
            const { sheet, fileName } = await fetchSheet(
              month,
              currency,
              controller.signal,
            );
            if (cancelled) return;
            if (!sheet) {
              (next[month] ??= {})[currency] = { amount: 0, fileName: null };
              return;
            }
            const { totalDebit } = computeExpenseTotal(sheet);
            (next[month] ??= {})[currency] = { amount: totalDebit, fileName };
          }),
        ),
      );
      if (!cancelled) {
        setMonthlySheets(next);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [months]);

  const series = useMemo<MonthlyAgg[]>(() => {
    return months.map((month) => {
      // Revenus du mois → conversion CHF avec taux du mois en question.
      const revenueChf = revenues
        .filter((r) => r.month === month)
        .reduce((sum, r) => sum + toChf(r.capturedAmount, r.currency, month), 0);

      const bucket = monthlySheets[month] ?? {};
      const expensesChf = CURRENCIES.reduce((sum, c) => {
        const localAmount = bucket[c]?.amount ?? 0;
        return sum + localAmount * getRateToChf(month, c);
      }, 0);

      return {
        month,
        revenue: revenueChf,
        expenses: expensesChf,
        net: revenueChf - expensesChf,
      };
    });
  }, [months, revenues, monthlySheets]);

  const totals = useMemo(() => {
    const totalRevenue = series.reduce((s, m) => s + m.revenue, 0);
    const totalExpenses = series.reduce((s, m) => s + m.expenses, 0);
    // Détail "par devise" : somme native par devise + équivalent CHF
    // (moyenne pondérée sur la période).
    const expensesByCurrency: ExpenseByCurrency[] = CURRENCIES.map((c) => {
      let amount = 0;
      let amountChf = 0;
      let fileName: string | null = null;
      for (const m of months) {
        const b = monthlySheets[m]?.[c];
        if (b) {
          amount += b.amount;
          amountChf += b.amount * getRateToChf(m, c);
          if (!fileName && b.fileName) fileName = b.fileName;
        }
      }
      return { currency: c, amount, amountChf, fileName };
    });
    return {
      revenue: totalRevenue,
      expenses: totalExpenses,
      net: totalRevenue - totalExpenses,
      expensesByCurrency,
    };
  }, [series, months, monthlySheets]);

  const byBusiness = useMemo(() => {
    const filteredRevenues = revenues.filter((r) => months.includes(r.month));
    const totalCa = filteredRevenues.reduce(
      (s, r) => s + toChf(r.capturedAmount, r.currency, r.month),
      0,
    );
    return businesses
      .map((b: Business) => {
        const amount = filteredRevenues
          .filter((r: Revenue) => r.businessId === b.id)
          .reduce(
            (s, r) => s + toChf(r.capturedAmount, r.currency, r.month),
            0,
          );
        return {
          id: b.id,
          name: b.name,
          color: b.color,
          amount,
          share: totalCa > 0 ? (amount / totalCa) * 100 : 0,
        };
      })
      .filter((b) => b.amount > 0)
      .sort((a, b) => b.amount - a.amount);
  }, [businesses, revenues, months]);

  // Volume par processeur (EMP, Centrobill…) en CHF.
  const byProcessor = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const r of revenues) {
      if (!months.includes(r.month)) continue;
      const key = r.processor || "—";
      map[key] = (map[key] ?? 0) + toChf(r.capturedAmount, r.currency, r.month);
    }
    return map;
  }, [revenues, months]);

  // Récap des taux FX utilisés sur la période — moyenne simple sur les
  // mois inclus, pour donner un repère visuel à l'utilisateur.
  const fx = useMemo<FxRatesSummary>(() => {
    const perMonth = months.map((month) => ({
      month,
      USD: getRateToChf(month, "USD"),
      EUR: getRateToChf(month, "EUR"),
    }));
    const avg = (key: "USD" | "EUR") =>
      perMonth.length
        ? perMonth.reduce((s, p) => s + p[key], 0) / perMonth.length
        : DEFAULT_FX_TO_CHF[key];
    const hasOverrides = months.some((m) => MONTHLY_FX_TO_CHF[m] != null);
    return {
      averages: { USD: avg("USD"), EUR: avg("EUR") },
      perMonth,
      hasOverrides,
    };
  }, [months]);

  return { loading, months, series, totals, byBusiness, byProcessor, fx };
}

/** Convertit un montant local en CHF via la table FX du mois.
 *  Tolère les currency inconnues en les considérant comme CHF. */
function toChf(amount: number, currency: string, month: string): number {
  const c = currency.toUpperCase() as AccountCurrency;
  if (!(c in DEFAULT_FX_TO_CHF)) return amount; // unknown → treat as CHF
  return amount * getRateToChf(month, c);
}
