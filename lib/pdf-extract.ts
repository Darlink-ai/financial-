/**
 * Extraction heuristique du contenu d'une facture PDF.
 *
 * Pas d'OCR : on lit le texte natif du PDF (pdf-parse). Si le PDF est
 * scanné (image-only), on retourne un résultat partiel — le pipeline
 * downstream marquera l'invoice comme `manual`.
 *
 * Tout est best-effort : on n'invente rien, on ne renvoie que ce qu'on
 * a effectivement matché.
 */

// `unpdf` est un fork serverless-friendly de pdfjs : pas de native deps,
// pas de polyfill DOM requis, fonctionne tel quel sur Vercel.
import { extractText, getDocumentProxy } from "unpdf";

export type ExtractedInvoice = {
  text: string;               // texte brut, pour debug/log
  creditor: string | null;    // nom du créancier
  amount: number | null;      // montant total (le plus gros candidate)
  currency: "CHF" | "EUR" | "USD" | null;
  invoiceDate: string | null; // ISO YYYY-MM-DD
};

const CURRENCY_BY_SYMBOL: Record<string, ExtractedInvoice["currency"]> = {
  CHF: "CHF",
  "FR.": "CHF",
  FR: "CHF",
  EUR: "EUR",
  "€": "EUR",
  USD: "USD",
  $: "USD",
};

const MONTHS_MAP: Record<string, number> = {
  jan: 1, janv: 1, january: 1, janvier: 1,
  feb: 2, fev: 2, févr: 2, february: 2, février: 2,
  mar: 3, mars: 3, march: 3,
  apr: 4, avr: 4, april: 4, avril: 4,
  may: 5, mai: 5,
  jun: 6, juin: 6, june: 6,
  jul: 7, juil: 7, july: 7, juillet: 7,
  aug: 8, aout: 8, août: 8, august: 8,
  sep: 9, sept: 9, september: 9, septembre: 9,
  oct: 10, october: 10, octobre: 10,
  nov: 11, november: 11, novembre: 11,
  dec: 12, déc: 12, december: 12, décembre: 12,
};

/**
 * Parse une string "1'234.56" / "1,234.56" / "1234,56" / "1 234,56" en nombre.
 */
function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[\s ']/g, "").trim();
  if (!cleaned) return null;

  // Heuristique : si on a virgule ET point, le dernier des deux = séparateur
  // décimal. Si on a seulement un des deux et qu'il a 2 chiffres après,
  // c'est probablement le séparateur décimal.
  const hasComma = cleaned.includes(",");
  const hasDot = cleaned.includes(".");

  let normalized = cleaned;
  if (hasComma && hasDot) {
    // Le dernier séparateur est décimal, l'autre est thousand.
    const lastComma = cleaned.lastIndexOf(",");
    const lastDot = cleaned.lastIndexOf(".");
    if (lastComma > lastDot) {
      normalized = cleaned.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  } else if (hasComma) {
    // Virgule seule : si exactement 2 chiffres après → décimal
    const parts = cleaned.split(",");
    if (parts.length === 2 && parts[1].length === 2) {
      normalized = cleaned.replace(",", ".");
    } else {
      normalized = cleaned.replace(/,/g, "");
    }
  }

  const n = parseFloat(normalized);
  return isFinite(n) ? n : null;
}

// Plafond raisonnable pour un montant de facture. Au-dessus, c'est presque
// certainement pas de l'argent (token count, ID de transaction, etc.).
const MAX_REASONABLE_AMOUNT = 10_000_000;

// Mots-clés qui indiquent un montant total. La proximité avec un de ces
// mots booste le score d'un candidat — typiquement le bon montant.
const TOTAL_KEYWORDS = [
  "total due",
  "amount due",
  "balance due",
  "grand total",
  "total amount",
  "net amount",
  "total ttc",
  "total ht",
  "total :",
  "total\n",
  "à payer",
  "montant total",
  "montant dû",
  "sous-total",
  "subtotal",
  "betrag",
  "gesamtbetrag",
];

/**
 * Trouve la paire (devise, montant) la plus probable dans le texte.
 *
 * Stratégie :
 *  1. Récolte tous les candidats (regex CHF/EUR/USD/€/$/Fr. + nombre)
 *  2. Filtre les valeurs absurdes (> 10M, ou > 100k sans décimale —
 *     typiquement des token counts ou IDs de Deep Infra, Stripe, etc.)
 *  3. Score chaque candidat par proximité d'un mot-clé "total"
 *  4. Retourne le meilleur score, à amount égal le plus gros
 */
function findAmountWithCurrency(
  text: string,
): { amount: number; currency: ExtractedInvoice["currency"] } | null {
  // Format "CHF 1'234.56" ou "€ 1.234,56" ou "USD 200.00"
  const prePattern =
    /(CHF|EUR|USD|€|\$|Fr\.?)\s*([0-9]{1,3}(?:[\s ',.][0-9]{3})*(?:[.,][0-9]{2})?)/gi;
  // Format "1'234.56 CHF" ou "200.00 €"
  const postPattern =
    /([0-9]{1,3}(?:[\s ',.][0-9]{3})*(?:[.,][0-9]{2})?)\s*(CHF|EUR|USD|€|\$|Fr\.?)/gi;

  type Candidate = {
    amount: number;
    currency: ExtractedInvoice["currency"];
    index: number;
    hasDecimal: boolean;
  };

  const hasExplicitDecimal = (raw: string) =>
    /[.,]\d{2}\s*$/.test(raw.trim());

  const candidates: Candidate[] = [];

  let m: RegExpExecArray | null;
  while ((m = prePattern.exec(text)) !== null) {
    const sym = m[1].toUpperCase().replace(".", "");
    const cur = CURRENCY_BY_SYMBOL[sym] ?? null;
    const amt = parseNumber(m[2]);
    if (cur && amt !== null && amt > 0) {
      candidates.push({
        amount: amt,
        currency: cur,
        index: m.index,
        hasDecimal: hasExplicitDecimal(m[2]),
      });
    }
  }
  while ((m = postPattern.exec(text)) !== null) {
    const sym = m[2].toUpperCase().replace(".", "");
    const cur = CURRENCY_BY_SYMBOL[sym] ?? null;
    const amt = parseNumber(m[1]);
    if (cur && amt !== null && amt > 0) {
      candidates.push({
        amount: amt,
        currency: cur,
        index: m.index,
        hasDecimal: hasExplicitDecimal(m[1]),
      });
    }
  }

  // ---- Filtrage des candidats déraisonnables ----
  const filtered = candidates.filter((c) => {
    if (c.amount > MAX_REASONABLE_AMOUNT) return false;
    // > 100k sans décimale → typiquement un token count ou un ID, pas un montant
    if (c.amount > 100_000 && !c.hasDecimal) return false;
    return true;
  });

  if (filtered.length === 0) return null;

  // ---- Scoring par proximité de mots-clés "total" ----
  const lower = text.toLowerCase();
  const keywordPositions: number[] = [];
  for (const kw of TOTAL_KEYWORDS) {
    let idx = 0;
    while ((idx = lower.indexOf(kw, idx)) >= 0) {
      keywordPositions.push(idx);
      idx += kw.length;
    }
  }

  const scored = filtered.map((c) => {
    let score = 0;
    // Bonus structure : un vrai montant a presque toujours 2 décimales
    if (c.hasDecimal) score += 8;
    // Bonus proximité keyword (max 20, dégressif sur 80 chars)
    if (keywordPositions.length > 0) {
      const minDist = Math.min(
        ...keywordPositions.map((kp) => Math.abs(c.index - kp)),
      );
      if (minDist <= 80) score += Math.round(20 - minDist / 4);
    }
    return { ...c, score };
  });

  // Score décroissant, puis montant décroissant en tiebreaker.
  scored.sort((a, b) => b.score - a.score || b.amount - a.amount);
  return { amount: scored[0].amount, currency: scored[0].currency };
}

/** Construit une ISO YYYY-MM-DD si tous les composants sont valides. */
function isoIfValid(year: number, month: number, day: number): string | null {
  if (year < 100) year = 2000 + year;
  if (year < 2020 || year > 2099) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normalizeMonthName(raw: string): number | null {
  const cleaned = raw.toLowerCase().replace(/[éèê]/g, "e").replace(/\.$/, "");
  return (
    MONTHS_MAP[cleaned] ??
    MONTHS_MAP[cleaned.slice(0, 4)] ??
    MONTHS_MAP[cleaned.slice(0, 3)] ??
    null
  );
}

type DateCandidate = {
  iso: string;
  index: number;  // position dans le texte
  format: "iso" | "numeric" | "dmy-text" | "mdy-text";
};

/**
 * Récolte tous les candidats de date dans le texte, dans tous les formats
 * supportés (ISO, JJ.MM.AAAA, "15 mai 2026", "January 5, 2026", "Jan 5, 2026").
 */
function collectDateCandidates(text: string): DateCandidate[] {
  const out: DateCandidate[] = [];
  let m: RegExpExecArray | null;

  // 1. ISO : 2026-05-22 (priorité haute, format non ambigu)
  const isoRe = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g;
  while ((m = isoRe.exec(text)) !== null) {
    const iso = isoIfValid(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10));
    if (iso) out.push({ iso, index: m.index, format: "iso" });
  }

  // 2. Numérique day-first : 22.05.2026, 22/05/2026, 22-05-26
  // On évite ce qui ressemble à du ISO (commence par 4 digits) déjà capté.
  const numericRe = /\b(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})\b/g;
  while ((m = numericRe.exec(text)) !== null) {
    const iso = isoIfValid(
      parseInt(m[3], 10),
      parseInt(m[2], 10),
      parseInt(m[1], 10),
    );
    if (iso) out.push({ iso, index: m.index, format: "numeric" });
  }

  // 3. Textuel day-first FR/EN : "15 mai 2026" / "15 May 2026" / "5 May, 2026"
  const dmyTextRe = /\b(\d{1,2})\s+([A-Za-zéèêûâôÉÈÊÛÂÔ]{3,12})[.,]?\s+(\d{4})\b/g;
  while ((m = dmyTextRe.exec(text)) !== null) {
    const month = normalizeMonthName(m[2]);
    if (!month) continue;
    const iso = isoIfValid(parseInt(m[3], 10), month, parseInt(m[1], 10));
    if (iso) out.push({ iso, index: m.index, format: "dmy-text" });
  }

  // 4. Textuel month-first EN : "January 5, 2026" / "Jan 5 2026"
  const mdyTextRe = /\b([A-Za-zéèêûâôÉÈÊÛÂÔ]{3,12})\s+(\d{1,2})[.,]?\s+(\d{4})\b/g;
  while ((m = mdyTextRe.exec(text)) !== null) {
    const month = normalizeMonthName(m[1]);
    if (!month) continue;
    const iso = isoIfValid(parseInt(m[3], 10), month, parseInt(m[2], 10));
    if (iso) out.push({ iso, index: m.index, format: "mdy-text" });
  }

  return out;
}

/**
 * Cherche une date dans le PDF en privilégiant celles proches d'un
 * mot-clé "invoice date", "facture du", "billed on", "rechnung", etc.
 * À défaut, retourne la première date trouvée.
 */
function findInvoiceDate(text: string): string | null {
  const candidates = collectDateCandidates(text);
  if (candidates.length === 0) return null;

  // Recherche d'un mot-clé pour scorer la proximité.
  const lower = text.toLowerCase();
  const keywords = [
    "invoice date",
    "date of invoice",
    "billing date",
    "billed on",
    "issue date",
    "issued",
    "date de facture",
    "date facture",
    "facture du",
    "facture émise",
    "rechnungsdatum",
    "datum",
  ];
  const keywordIndexes = keywords
    .map((k) => lower.indexOf(k))
    .filter((i) => i >= 0);

  if (keywordIndexes.length > 0) {
    // Pour chaque candidat, distance au keyword le plus proche. Plus c'est
    // petit, mieux c'est. On accepte jusqu'à 80 chars de distance.
    let best: { c: DateCandidate; distance: number } | null = null;
    for (const c of candidates) {
      const distance = Math.min(
        ...keywordIndexes.map((ki) => Math.abs(c.index - ki)),
      );
      if (distance > 80) continue;
      if (!best || distance < best.distance) best = { c, distance };
    }
    if (best) return best.c.iso;
  }

  // Pas de mot-clé exploitable → on prend la première candidate dans le
  // PDF (souvent en en-tête).
  return candidates[0].iso;
}

/**
 * Devine le nom du créancier — meilleure source d'abord :
 * 1. Le From Display Name de l'email (si c'est pas juste une adresse)
 * 2. Le domaine de l'email
 * 3. Les premières lignes du PDF (nom probable de l'émetteur)
 */
export function guessCreditorFromEmail(fromHeader: string): string | null {
  if (!fromHeader) return null;
  // Format typique : "OpenAI <billing@openai.com>" ou juste "billing@openai.com"
  const m = fromHeader.match(/^"?([^"<]+?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    const displayName = m[1].trim();
    if (displayName && !displayName.includes("@")) return displayName;
    const domain = m[2].split("@")[1];
    return domainToCreditor(domain);
  }
  if (fromHeader.includes("@")) {
    return domainToCreditor(fromHeader.split("@")[1]);
  }
  return null;
}

function domainToCreditor(domain: string | undefined): string | null {
  if (!domain) return null;
  const root = domain.toLowerCase().replace(/^www\./, "").split(".")[0];
  if (!root) return null;
  // Capitalisation simple ; corrige quelques cas connus.
  const fixes: Record<string, string> = {
    openai: "OpenAI",
    paypal: "PayPal",
    runpod: "Runpod",
    github: "GitHub",
    aws: "AWS",
    gcp: "GCP",
    swisscom: "Swisscom",
    helvetia: "Helvetia",
  };
  if (fixes[root]) return fixes[root];
  return root.charAt(0).toUpperCase() + root.slice(1);
}

function guessCreditorFromPdfText(text: string): string | null {
  // On prend la première ligne non vide (heuristique : c'est souvent
  // le logo ou le nom de l'émetteur). On ignore les lignes trop génériques.
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 2 && l.length < 60);
  for (const l of lines.slice(0, 10)) {
    if (/facture|invoice|reçu|receipt|client/i.test(l)) continue;
    if (/^\d+$/.test(l)) continue;
    if (l.split(" ").length > 6) continue; // trop long pour un nom
    return l;
  }
  return null;
}

/**
 * Point d'entrée principal — buffer du PDF + headers Gmail en entrée.
 */
export async function extractInvoiceFromPdf({
  pdfBuffer,
  fromEmail,
}: {
  pdfBuffer: Buffer;
  fromEmail: string;
}): Promise<ExtractedInvoice> {
  let text = "";
  try {
    const uint8 = new Uint8Array(
      pdfBuffer.buffer,
      pdfBuffer.byteOffset,
      pdfBuffer.byteLength,
    );
    const doc = await getDocumentProxy(uint8);
    const result = await extractText(doc, { mergePages: true });
    text = result.text ?? "";
  } catch {
    // PDF illisible (scanné, corrompu, etc.) — on continue avec text vide.
    text = "";
  }

  const amountInfo = findAmountWithCurrency(text);
  const invoiceDate = findInvoiceDate(text);

  // Créancier : on combine email + PDF, on garde la meilleure source.
  const fromEmailCreditor = guessCreditorFromEmail(fromEmail);
  const pdfCreditor = guessCreditorFromPdfText(text);
  // Préférence : le PDF si disponible (souvent le vrai nom légal),
  // sinon le From email.
  const creditor = pdfCreditor ?? fromEmailCreditor ?? null;

  return {
    text,
    creditor,
    amount: amountInfo?.amount ?? null,
    currency: amountInfo?.currency ?? null,
    invoiceDate,
  };
}
