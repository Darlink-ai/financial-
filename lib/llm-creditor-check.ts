/**
 * Fallback LLM pour vérifier si deux noms de créditeur désignent la même
 * entité (alias, filiale, ancien/nouveau nom, subsidiary…). Utile pour les
 * cas non couverts par la table statique CREDITOR_ALIASES côté /import,
 * genre Brevo/Sendinblue ou X Corp/Twitter.
 *
 * Prompt court + Haiku → quelques cents par appel, réponse en <2s.
 */

import Anthropic from "@anthropic-ai/sdk";

export type CreditorCheckResult = {
  same: boolean;
  reason: string;
  /** Raw output du modèle — utile pour debug. */
  rawVerdict: string;
};

/** Cache in-process (par isolation Vercel : reset au cold start).
 *  Évite de rappeler l'API pour la même paire vue plusieurs fois dans
 *  la même session serveur — cas typique quand l'user upload plusieurs
 *  factures du même créditeur en batch. */
const memoCache = new Map<string, CreditorCheckResult>();

function cacheKey(a: string, b: string): string {
  const [x, y] = [a.trim().toLowerCase(), b.trim().toLowerCase()].sort();
  return `${x}|${y}`;
}

export async function checkCreditorMatch(
  pdfCreditor: string,
  bankVendor: string,
): Promise<CreditorCheckResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!pdfCreditor.trim() || !bankVendor.trim()) return null;

  const key = cacheKey(pdfCreditor, bankVendor);
  const cached = memoCache.get(key);
  if (cached) return cached;

  const client = new Anthropic({ apiKey });
  const prompt = `On veut savoir si ces deux noms désignent la MÊME entité commerciale (même société, ou filiale/rebrand/subsidiary évidents).

Nom sur la facture PDF : "${pdfCreditor}"
Nom sur le relevé bancaire : "${bankVendor}"

Réponds STRICTEMENT au format :
VERDICT: OUI ou NON
RAISON: <une phrase courte, ex. "Brevo est le nouveau nom de Sendinblue" ou "Anthropic et Sendinblue sont des sociétés distinctes">

Ne mets rien d'autre.`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const response = await client.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 200,
        messages: [{ role: "user", content: prompt }],
      },
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    const raw = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n")
      .trim();

    const verdict = /VERDICT\s*:\s*(OUI|NON)/i.exec(raw)?.[1]?.toUpperCase();
    const reason = /RAISON\s*:\s*(.+)/i.exec(raw)?.[1]?.trim() ?? raw.slice(0, 200);
    if (!verdict) {
      const fallback: CreditorCheckResult = {
        same: false,
        reason: `LLM output non parsable : ${raw.slice(0, 100)}`,
        rawVerdict: raw,
      };
      memoCache.set(key, fallback);
      return fallback;
    }
    const result: CreditorCheckResult = {
      same: verdict === "OUI",
      reason,
      rawVerdict: raw,
    };
    memoCache.set(key, result);
    return result;
  } catch (e) {
    return {
      same: false,
      reason: `LLM erreur : ${(e as Error).message}`,
      rawVerdict: "",
    };
  }
}
