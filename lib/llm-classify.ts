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
};

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
}): Promise<LlmClassifyResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Pas de clé API → on n'appelle pas l'LLM, la facture restera en
    // manual. C'est intentionnel : on n'oblige personne à brancher l'API.
    return null;
  }

  // On exclut le fallback NC (Charges non classées) — réservé au tri
  // manuel — pour forcer le LLM à choisir une catégorie réelle.
  const validMappings = mappings.filter((m) => m.id !== FALLBACK_MAPPING_ID);
  if (validMappings.length === 0) return null;

  const categoriesList = validMappings
    .map((m) => `- ${m.folderCode} : ${m.folderLabel}`)
    .join("\n");

  const prompt = `Tu es un assistant comptable pour une PME suisse.
Tu dois classer une facture dans la bonne catégorie comptable en t'appuyant
sur ta connaissance du fournisseur.

Créancier : ${creditor}
Email expéditeur : ${fromEmail}
Sujet du mail : ${subject}${
    pdfTextExcerpt
      ? `\nExtrait du PDF (premiers 600 caractères) :\n${pdfTextExcerpt.slice(0, 600)}`
      : ""
  }

Catégories disponibles (code → libellé) :
${categoriesList}

Détermine la catégorie la plus appropriée. Exemples de raisonnement :
- Hetzner / OVH / DigitalOcean / AWS → hébergement / serveurs → TECH
- Stripe / PayPal / Adyen → processeur de paiement → PROC
- Helvetia / Vaudoise / AXA → assurance → ASS
- Loyer, régie immobilière, SIG → locaux → LOC
- Meta Ads, Google Ads, LinkedIn Ads → marketing → MKT
- Notion, Slack, GitHub, Figma, Linear → outils SaaS dev → TECH

Réponds UNIQUEMENT avec un objet JSON, rien d'autre :
{"code": "<CODE_OU_NULL>", "confidence": <0.0-1.0>, "reasoning": "<phrase courte>"}

Si tu n'es pas raisonnablement sûr (confidence < 0.6), réponds
{"code": null, "confidence": 0, "reasoning": "raison"}.`;

  try {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });

    const block = response.content[0];
    if (!block || block.type !== "text") return null;
    const text = block.text;

    // Extraction du premier objet JSON dans la réponse (Claude peut
    // parfois ajouter du texte autour malgré l'instruction).
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      code: string | null;
      confidence: number;
      reasoning: string;
    };

    if (!parsed.code) return null;
    if (typeof parsed.confidence !== "number" || parsed.confidence < 0.6) {
      return null;
    }

    const mapping = validMappings.find(
      (m) => m.folderCode.toLowerCase() === String(parsed.code).toLowerCase(),
    );
    if (!mapping) return null;

    return {
      mappingId: mapping.id,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning ?? "",
    };
  } catch (e) {
    console.error("LLM classify failed", (e as Error).message);
    return null;
  }
}
