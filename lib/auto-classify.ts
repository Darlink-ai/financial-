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
import { classifyWithLLM, isLlmAccepted } from "./llm-classify";

export const FALLBACK_MAPPING_ID = "fm-nc";

/** Détails du dernier essai de classification — utile pour last_error. */
export type ClassifyDiagnostic = {
  mapping: FolderMapping | null;
  via: "regex" | "cache" | "llm" | "none";
  reason: string;
};

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
}): Promise<ClassifyDiagnostic> {
  // ---- 1. Regex statique sur les mappings utilisateur ----
  // On exclut volontairement fromEmail : beaucoup de SaaS (Deep Infra,
  // PostHog, etc.) facturent via stripe.com — l'email contiendrait
  // "stripe" et matcherait faussement le pattern PROC. Le nom du
  // créancier + le sujet sont des signaux beaucoup plus fiables.
  const creditorHit = creditor ? matchByRegex(mappings, creditor) : null;
  const subjectHit = creditorHit ?? matchByRegex(mappings, subject);
  if (subjectHit) {
    return {
      mapping: subjectHit,
      via: "regex",
      reason: `Regex "${subjectHit.creditorPattern}" → ${subjectHit.folderCode}`,
    };
  }

  // ---- 2. Cache DB ----
  if (creditor) {
    try {
      const cached = await getCreditorClassification(creditor);
      if (cached) {
        const mapping = mappings.find((m) => m.id === cached.mappingId);
        if (mapping) {
          return {
            mapping,
            via: "cache",
            reason: `Cache ${cached.classifiedBy} → ${mapping.folderCode}`,
          };
        }
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
    if (isLlmAccepted(llm)) {
      const mapping = mappings.find((m) => m.id === llm.mappingId);
      if (mapping) {
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
        return {
          mapping,
          via: "llm",
          reason: `LLM: ${llm.rawVerdict ?? mapping.folderCode}`,
        };
      }
    }
    // Rejet du LLM : on remonte la raison
    if (llm && "kind" in llm) {
      return { mapping: null, via: "llm", reason: llm.reason };
    }
  }

  return {
    mapping: null,
    via: "none",
    reason: creditor
      ? "Aucune règle, cache vide, LLM non concluant."
      : "Créditeur non extrait du PDF — impossible de classer.",
  };
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
