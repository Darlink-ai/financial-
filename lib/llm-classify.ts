/**
 * Classification de créancier via Claude — fallback quand les regex
 * statiques des folder_mappings ne matchent rien.
 *
 * Le LLM connaît la plupart des fournisseurs (Hetzner = hébergement,
 * Stripe = processeur paiement, Helvetia = assurance, etc.) et peut
 * inférer la catégorie comptable. On cache son verdict par créancier
 * pour éviter de recall sur chaque facture du même fournisseur.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { FolderMapping } from "./types";
import { FALLBACK_MAPPING_ID } from "./auto-classify";

export type LlmClassifyResult = {
  mappingId: string;
  confidence: number;
  reasoning: string;
  /** Raw verdict pour debug — affiché dans last_error si on rejette. */
  rawVerdict?: string;
};

/** Verdict trop bas → on log dans last_error pour debug, mais on rejette. */
export type LlmRejected = {
  kind: "rejected";
  reason: string;
};

const CONFIDENCE_THRESHOLD = 0.5;

export async function classifyWithLLM({
  creditor,
  subject,
  fromEmail,
  pdfTextExcerpt,
  mappings,
}: {
  creditor: string;
  subject: string;
  fromEmail: string;
  pdfTextExcerpt?: string;
  mappings: FolderMapping[];
}): Promise<LlmClassifyResult | LlmRejected | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      kind: "rejected",
      reason: "ANTHROPIC_API_KEY non configurée — LLM non appelé.",
    };
  }

  // On exclut le fallback NC (Charges non classées) — réservé au tri
  // manuel — pour forcer le LLM à choisir une catégorie réelle.
  const validMappings = mappings.filter((m) => m.id !== FALLBACK_MAPPING_ID);
  if (validMappings.length === 0) return null;

  const categoriesList = validMappings
    .map((m) => `- ${m.folderCode} : ${m.folderLabel}`)
    .join("\n");

  const prompt = `Tu es un assistant comptable pour une PME tech suisse.
Tu dois classer une facture fournisseur dans la bonne catégorie comptable.

Créancier : ${creditor}
Email expéditeur : ${fromEmail}
Sujet du mail : ${subject}${
    pdfTextExcerpt
      ? `\nExtrait du PDF (premiers 600 caractères) :\n${pdfTextExcerpt.slice(0, 600)}`
      : ""
  }

Catégories disponibles (code → libellé) :
${categoriesList}

Détermine la catégorie en t'appuyant sur ta connaissance du fournisseur.

Exemples détaillés :
- Hetzner, OVH, DigitalOcean, AWS, GCP, Azure, Cloudflare, Vercel,
  Netlify, Linode → hébergement / cloud → TECH
- OpenAI, Anthropic, xAI, Mistral, Cohere, Replicate, Deep Infra,
  Hugging Face → API LLM / inference → TECH
- GitHub, GitLab, Notion, Slack, Linear, Figma, Sentry, Datadog,
  PostHog, Airtable, Zapier, Hubstaff → SaaS dev/ops → TECH
- Stripe, PayPal, Adyen, Square, SumUp, Worldline, Twint, Mollie
  → processeur de paiement → PROC
- Helvetia, Vaudoise, AXA, Mobilière, Bâloise, Zurich → assurance
  → ASS
- Régie immobilière, SIG, Romande Energie, Eau → locaux → LOC
- Meta Ads, Google Ads, LinkedIn Ads, TikTok Ads, X Ads, Mailchimp,
  Brevo, HubSpot → marketing / acquisition → MKT
- Swisscom, Sunrise, Salt, La Poste, CFF, Fiduciaire, comptable
  → administration → ADM
- Salaires, AVS, LPP, Suva, Caisse maladie → salaires & charges
  → SAL

Sois décisif. Si tu reconnais le fournisseur, donne une confidence ≥ 0.7.
Si tu hésites entre deux catégories proches, choisis la plus probable
avec confidence 0.5-0.65. Ne réponds null/0 QUE si tu ne reconnais
absolument pas le fournisseur OU si c'est clairement pas une facture
(rapport d'activité, time-tracking, newsletter).

Réponds UNIQUEMENT avec un objet JSON, rien d'autre :
{"code": "<CODE_OU_NULL>", "confidence": <0.0-1.0>, "reasoning": "<phrase courte>"}`;

  let rawText = "";
  try {
    // Timeout dur de 15s : si l'API rame, on bascule l'invoice dans la
    // queue de retry plutôt que de bloquer tout le sync.
    const client = new Anthropic({ apiKey, timeout: 15_000, maxRetries: 1 });
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const block = response.content[0];
    if (!block || block.type !== "text") {
      return { kind: "rejected", reason: "Réponse LLM vide ou non-texte." };
    }
    rawText = block.text;

    // Extraction du premier objet JSON dans la réponse (Claude peut
    // parfois ajouter du texte autour malgré l'instruction).
    const match = rawText.match(/\{[\s\S]*?\}/);
    if (!match) {
      return {
        kind: "rejected",
        reason: `Pas de JSON trouvé dans la réponse LLM : "${rawText.slice(0, 120)}"`,
      };
    }
    let parsed: { code: string | null; confidence: number; reasoning: string };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return {
        kind: "rejected",
        reason: `JSON LLM invalide : ${match[0].slice(0, 120)}`,
      };
    }

    if (!parsed.code) {
      return {
        kind: "rejected",
        reason: `LLM n'a pas trouvé de catégorie : ${parsed.reasoning ?? "(pas de raison)"}`,
      };
    }
    if (
      typeof parsed.confidence !== "number" ||
      parsed.confidence < CONFIDENCE_THRESHOLD
    ) {
      return {
        kind: "rejected",
        reason: `LLM confidence trop basse (${parsed.confidence}) : ${parsed.code} — ${parsed.reasoning ?? ""}`,
      };
    }

    const mapping = validMappings.find(
      (m) => m.folderCode.toLowerCase() === String(parsed.code).toLowerCase(),
    );
    if (!mapping) {
      return {
        kind: "rejected",
        reason: `LLM a renvoyé un code inconnu : ${parsed.code}`,
      };
    }

    return {
      mappingId: mapping.id,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning ?? "",
      rawVerdict: `${parsed.code} (${parsed.confidence}) — ${parsed.reasoning ?? ""}`,
    };
  } catch (e) {
    return {
      kind: "rejected",
      reason: `Erreur appel LLM : ${(e as Error).message}`,
    };
  }
}

export function isLlmAccepted(
  r: LlmClassifyResult | LlmRejected | null,
): r is LlmClassifyResult {
  return r !== null && !("kind" in r);
}
