/**
 * Auto-classification d'une facture — pipeline hybride :
 *   1. Regex statique sur folder_mappings (rapide, gratuit)
 *   2. Cache DB (creditor_classifications) — fournisseurs déjà résolus
 *   3. Fallback Claude API si tout le reste a échoué
 *
 * On exclut explicitement le mapping fallback (NC / Charges non
 * classées) qui doit rester réservé au tri manuel par l'utilisateur.
 */

import type { AccountCurrency, FolderMapping } from "./types";
import {
  getCreditorClassification,
  saveCreditorClassification,
} from "./db";
import { classifyWithLLM } from "./llm-classify";

export const FALLBACK_MAPPING_ID = "fm-nc";

/** Test regex pur (étape 1). */
function matchByRegex(
  mappings: FolderMapping[],
  haystack: string,
): FolderMapping | null {
  if (!haystack.trim()) return null;
  for (const m of mappings) {
    if (m.id === FALLBACK_MAPPING_ID) continue;
    if (!m.creditorPattern) continue;
    let re: RegExp;
    try {
      re = new RegExp(m.creditorPattern, "i");
    } catch {
      continue;
    }
    if (re.test(haystack)) return m;
  }
  return null;
}

export async function classifyAgainstMappings({
  mappings,
  creditor,
  subject,
  fromEmail,
  pdfTextExcerpt,
}: {
  mappings: FolderMapping[];
  creditor: string | null;
  subject: string;
  fromEmail: string;
  /** Extrait du texte du PDF pour donner du contexte au LLM si appelé. */
  pdfTextExcerpt?: string;
}): Promise<FolderMapping | null> {
  // ---- 1. Regex statique sur les mappings utilisateur ----
  const haystack = [creditor ?? "", subject, fromEmail]
    .filter(Boolean)
    .join(" ");
  const regexHit = matchByRegex(mappings, haystack);
  if (regexHit) return regexHit;

  // ---- 2. Cache DB ----
  // Si la table n'existe pas (migration pas encore appliquée) on log
  // et on continue avec le LLM, sans crasher tout le pipeline.
  if (creditor) {
    try {
      const cached = await getCreditorClassification(creditor);
      if (cached) {
        const mapping = mappings.find((m) => m.id === cached.mappingId);
        if (mapping) return mapping;
      }
    } catch (e) {
      console.warn(
        "[classify] cache lookup failed (creditor_classifications migration ?)",
        (e as Error).message,
      );
    }
  }

  // ---- 3. Fallback LLM (Claude) ----
  if (creditor) {
    const llm = await classifyWithLLM({
      creditor,
      subject,
      fromEmail,
      pdfTextExcerpt,
      mappings,
    });
    if (llm) {
      const mapping = mappings.find((m) => m.id === llm.mappingId);
      if (mapping) {
        // On grave la décision dans le cache pour éviter de re-appeler
        // l'API sur la prochaine facture du même fournisseur.
        // Si la table n'existe pas, on log + on continue (le LLM tournera
        // à nouveau pour la prochaine facture du même fournisseur, c'est
        // acceptable comme dégradation).
        try {
          await saveCreditorClassification({
            creditor,
            mappingId: mapping.id,
            classifiedBy: "llm",
            confidence: llm.confidence,
            reasoning: llm.reasoning,
          });
        } catch (e) {
          console.warn(
            "[classify] cache save failed (creditor_classifications migration ?)",
            (e as Error).message,
          );
        }
        return mapping;
      }
    }
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
