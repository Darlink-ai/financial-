/**
 * Auto-classification d'une facture contre les folder_mappings.
 *
 * On teste le regex de chaque mapping contre une string composée des
 * signaux disponibles (créancier extrait + sujet email + adresse).
 * Le premier match gagne — et on exclut explicitement le mapping
 * fallback (NC / Charges non classées) qui doit rester réservé au tri
 * manuel par l'utilisateur.
 */

import type { FolderMapping } from "./types";
import type { AccountCurrency } from "./types";

export const FALLBACK_MAPPING_ID = "fm-nc";

export function classifyAgainstMappings({
  mappings,
  creditor,
  subject,
  fromEmail,
}: {
  mappings: FolderMapping[];
  creditor: string | null;
  subject: string;
  fromEmail: string;
}): FolderMapping | null {
  const haystack = [creditor ?? "", subject, fromEmail]
    .filter(Boolean)
    .join(" ");
  if (!haystack.trim()) return null;

  for (const m of mappings) {
    if (m.id === FALLBACK_MAPPING_ID) continue;
    if (!m.creditorPattern) continue;
    let re: RegExp;
    try {
      re = new RegExp(m.creditorPattern, "i");
    } catch {
      // Pattern invalide → on skip silencieusement.
      continue;
    }
    if (re.test(haystack)) return m;
  }
  return null;
}

/**
 * Détermine le compte bancaire (CHF / EUR / USD) sur lequel ranger
 * la facture. Si on n'a pas pu extraire la devise, USD par défaut.
 */
export function deriveBankAccount(
  currency: "CHF" | "EUR" | "USD" | null,
): AccountCurrency {
  if (currency === "CHF") return "CHF";
  if (currency === "EUR") return "EUR";
  return "USD";
}
