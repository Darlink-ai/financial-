/**
 * Calcul de la TVA due mensuelle par pays UE + UK depuis les revenus saisis.
 *
 * Sortie unique utilisée dans deux endroits :
 *   - Page /taxes/tva pour l'affichage et la facture globale
 *   - Hook useAnalyseAggregates pour deduire la TVA due des benefices
 *     (la TVA collectee est une dette, pas un revenu)
 *
 * Isolé de React pour être appelable côté serveur (endpoint provision-drive).
 */

import type { Revenue, AccountCurrency } from "@/lib/types";
import { DEFAULT_FX_TO_CHF, getRateToChf } from "@/lib/fx";
import { findVatCountry, type VatCountry } from "@/lib/vat-rates";

export type VatRow = {
  country: VatCountry;
  amountChf: number;
  vatChf: number;
  perSource: {
    businessId: string;
    processor: string;
    currency: string;
    amount: number;
    amountChf: number;
  }[];
};

export type VatMonthlySummary = {
  month: string;
  rows: VatRow[];
  totalCA: number;
  totalVat: number;
  sourceCount: number;
};

function toChf(amount: number, currency: string, month: string): number {
  const c = (currency || "CHF").toUpperCase();
  if (!(c in DEFAULT_FX_TO_CHF)) return amount;
  return amount * getRateToChf(month, c as AccountCurrency);
}

export function computeVatByCountry(
  revenues: Revenue[],
  month: string,
): VatMonthlySummary {
  const monthRevs = revenues.filter((r) => r.month === month);
  const rows = new Map<string, VatRow>();
  for (const rev of monthRevs) {
    for (const cb of rev.countryBreakdown) {
      const country = findVatCountry(cb.country);
      if (!country) continue; // pays hors UE + UK
      const amountChf = toChf(cb.amount, rev.currency, rev.month);
      const key = country.iso;
      const existing = rows.get(key);
      if (existing) {
        existing.amountChf += amountChf;
        existing.vatChf = (existing.amountChf * country.rate) / 100;
        existing.perSource.push({
          businessId: rev.businessId,
          processor: rev.processor,
          currency: rev.currency,
          amount: cb.amount,
          amountChf,
        });
      } else {
        rows.set(key, {
          country,
          amountChf,
          vatChf: (amountChf * country.rate) / 100,
          perSource: [
            {
              businessId: rev.businessId,
              processor: rev.processor,
              currency: rev.currency,
              amount: cb.amount,
              amountChf,
            },
          ],
        });
      }
    }
  }
  const sortedRows = [...rows.values()].sort((a, b) => b.amountChf - a.amountChf);
  const totalCA = sortedRows.reduce((s, r) => s + r.amountChf, 0);
  const totalVat = sortedRows.reduce((s, r) => s + r.vatChf, 0);
  return {
    month,
    rows: sortedRows,
    totalCA,
    totalVat,
    sourceCount: monthRevs.length,
  };
}

/** Raccourci : juste le montant TVA due pour un mois (en CHF). Utilisé
 *  par useAnalyseAggregates pour l'ajouter aux dépenses. */
export function computeVatDue(revenues: Revenue[], month: string): number {
  return computeVatByCountry(revenues, month).totalVat;
}
