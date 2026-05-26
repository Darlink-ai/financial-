/**
 * Hook + helpers d'agrégation pour la page /analyse.
 *
 * Données réelles dispo aujourd'hui :
 *  - Revenus : table `revenues` (merchant pay file → capturedAmount par
 *    business + processeur).
 *  - Dépenses : somme des débits des 3 fichiers de rapprochement Excel
 *    (CHF / EUR / USD) du mois — chargés depuis `/api/excel-sheets/:month`.
 *
 * Tout est converti en USD pour les KPIs et graphiques globaux, via des
 * taux FX fixes simples (à raffiner plus tard via une vraie source FX).
 * Le détail par devise reste accessible pour transparence côté UI.
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

/** Taux FX fixes pour convertir en USD. Plus tard : table FX par mois. */
const FX_TO_USD: Record<AccountCurrency, number> = {
  USD: 1,
  EUR: 1.07,
  CHF: 1.13,
};

export type MonthlyAgg = {
  month: string; // YYYY-MM
  revenue: number; // USD
  expenses: number; // USD (somme convertie des 3 buckets)
  net: number; // revenue - expenses
};

export type ExpenseByCurrency = {
  currency: AccountCurrency;
  amount: number; // dans la devise locale
  amountUsd: number; // converti
  fileName: string | null;
};

export type AnalyseAggregates = {
  loading: boolean;
  /** Mois inclus dans la période (du plus ancien au plus récent). */
  months: string[];
  /** Série complète revenu / dépenses / net en USD, par mois. */
  series: MonthlyAgg[];
  /** Totaux sur la période complète. */
  totals: {
    revenue: number;
    expenses: number; // USD total
    net: number;
    expensesByCurrency: ExpenseByCurrency[]; // pour le dernier mois de la période
  };
  /** Ventilation CA par business sur la période. */
  byBusiness: { id: string; name: string; color: string; amount: number; share: number }[];
  /** Ventilation CA par processeur de paiement (EMP, Centrobill, …) en USD. */
  byProcessor: Record<string, number>;
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
 * Hook principal. Agrège revenus + dépenses sur la période.
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
      // Revenus du mois (somme capturedAmount, toutes devises confondues — la
      // plupart des processeurs sont déjà en USD mais on convertit au cas où).
      const revenueUsd = revenues
        .filter((r) => r.month === month)
        .reduce((sum, r) => sum + toUsd(r.capturedAmount, r.currency), 0);

      const bucket = monthlySheets[month] ?? {};
      const expensesUsd = CURRENCIES.reduce((sum, c) => {
        const localAmount = bucket[c]?.amount ?? 0;
        return sum + localAmount * FX_TO_USD[c];
      }, 0);

      return {
        month,
        revenue: revenueUsd,
        expenses: expensesUsd,
        net: revenueUsd - expensesUsd,
      };
    });
  }, [months, revenues, monthlySheets]);

  const totals = useMemo(() => {
    const totalRevenue = series.reduce((s, m) => s + m.revenue, 0);
    const totalExpenses = series.reduce((s, m) => s + m.expenses, 0);
    // Pour le détail "par devise", on prend le dernier mois de la période
    // (le plus représentatif pour un mois unique ; sur une année on somme).
    const expensesByCurrency: ExpenseByCurrency[] = CURRENCIES.map((c) => {
      let amount = 0;
      let fileName: string | null = null;
      for (const m of months) {
        const b = monthlySheets[m]?.[c];
        if (b) {
          amount += b.amount;
          // Garde le 1er fileName non-null trouvé comme représentatif.
          if (!fileName && b.fileName) fileName = b.fileName;
        }
      }
      return {
        currency: c,
        amount,
        amountUsd: amount * FX_TO_USD[c],
        fileName,
      };
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
      (s, r) => s + toUsd(r.capturedAmount, r.currency),
      0,
    );
    return businesses
      .map((b: Business) => {
        const amount = filteredRevenues
          .filter((r: Revenue) => r.businessId === b.id)
          .reduce((s, r) => s + toUsd(r.capturedAmount, r.currency), 0);
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

  // Volume par processeur (EMP, Centrobill…) — converti en USD.
  const byProcessor = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const r of revenues) {
      if (!months.includes(r.month)) continue;
      const key = r.processor || "—";
      map[key] = (map[key] ?? 0) + toUsd(r.capturedAmount, r.currency);
    }
    return map;
  }, [revenues, months]);

  return { loading, months, series, totals, byBusiness, byProcessor };
}

/** Convertit un montant local en USD via la table FX. Tolère les currency
 *  inconnues en les considérant comme USD. */
function toUsd(amount: number, currency: string): number {
  const c = currency.toUpperCase() as AccountCurrency;
  const rate = FX_TO_USD[c];
  return amount * (rate ?? 1);
}
