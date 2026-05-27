/**
 * Conversion de devise avec taux moyens mensuels.
 *
 * Toutes les conversions passent par le CHF comme pivot, donc on a juste
 * besoin de connaître le taux X→CHF pour chaque devise. Les autres paires
 * (USD→EUR, EUR→USD…) sont dérivées : montant × from→CHF / to→CHF.
 *
 * TODO : brancher un vrai feed FX (BNS, exchangerate.host, ECB…) pour
 * obtenir les taux moyens du mois en réel et virer ces constantes.
 */

import type { AccountCurrency } from "@/lib/types";

/**
 * Taux par défaut (1 unité de la devise = X CHF). Moyennes approximatives
 * 2024-2026. À surcharger par mois via MONTHLY_FX_TO_CHF.
 */
export const DEFAULT_FX_TO_CHF: Record<AccountCurrency, number> = {
  CHF: 1,
  USD: 0.88,
  EUR: 0.94,
};

/**
 * Overrides par mois — quand on connaît le taux moyen exact pour un
 * mois donné. Format : "YYYY-MM" → { USD?, EUR? } (CHF est toujours 1).
 */
export const MONTHLY_FX_TO_CHF: Record<
  string,
  Partial<Record<AccountCurrency, number>>
> = {
  // Exemples (à remplir avec des valeurs BNS) :
  // "2026-01": { USD: 0.87, EUR: 0.93 },
};

/** Taux pour 1 unité de `currency` → CHF, pour le mois donné. */
export function getRateToChf(month: string, currency: AccountCurrency): number {
  if (currency === "CHF") return 1;
  const override = MONTHLY_FX_TO_CHF[month]?.[currency];
  return override ?? DEFAULT_FX_TO_CHF[currency];
}

/**
 * Taux 1 unité de `from` → `to`, pour le mois donné.
 * Implémenté via le pivot CHF : (from → CHF) / (to → CHF).
 */
export function getFxRate(
  month: string,
  from: AccountCurrency,
  to: AccountCurrency,
): number {
  if (from === to) return 1;
  const fromToChf = getRateToChf(month, from);
  const toToChf = getRateToChf(month, to);
  return fromToChf / toToChf;
}

/**
 * Convertit un montant `amount` de `from` vers `to` au taux du mois donné.
 * Tolère les currency inconnues en les considérant comme `to`.
 */
export function convertAmount(
  amount: number,
  from: string,
  to: AccountCurrency,
  month: string,
): number {
  const fromCur = from.toUpperCase() as AccountCurrency;
  if (!(fromCur in DEFAULT_FX_TO_CHF)) return amount; // unknown → no-op
  return amount * getFxRate(month, fromCur, to);
}

/** True si un mois a un taux override exact (vs taux par défaut). */
export function hasMonthlyOverride(month: string): boolean {
  return MONTHLY_FX_TO_CHF[month] != null;
}
