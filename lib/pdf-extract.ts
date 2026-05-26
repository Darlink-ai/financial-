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

/**
 * Trouve toutes les paires (devise, montant) dans le texte.
 * Retourne la plus grosse — c'est presque toujours le total TTC.
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

  const candidates: { amount: number; currency: ExtractedInvoice["currency"] }[] = [];

  let m: RegExpExecArray | null;
  while ((m = prePattern.exec(text)) !== null) {
    const sym = m[1].toUpperCase().replace(".", "");
    const cur = CURRENCY_BY_SYMBOL[sym] ?? null;
    const amt = parseNumber(m[2]);
    if (cur && amt !== null && amt > 0) candidates.push({ amount: amt, currency: cur });
  }
  while ((m = postPattern.exec(text)) !== null) {
    const sym = m[2].toUpperCase().replace(".", "");
    const cur = CURRENCY_BY_SYMBOL[sym] ?? null;
    const amt = parseNumber(m[1]);
    if (cur && amt !== null && amt > 0) candidates.push({ amount: amt, currency: cur });
  }

  if (candidates.length === 0) return null;
  // On prend le plus gros — heuristique classique pour le total TTC.
  candidates.sort((a, b) => b.amount - a.amount);
  return candidates[0];
}

/**
 * Cherche une date. Priorité aux formats numériques DD.MM.YYYY / DD/MM/YYYY,
 * puis aux dates "15 mai 2026". Retourne au format ISO YYYY-MM-DD.
 */
function findInvoiceDate(text: string): string | null {
  // 1. Date numérique : 22.05.2026, 22/05/2026, 22-05-2026, 22.05.26
  const numericRe = /\b(\d{1,2})[./\-](\d{1,2})[./\-](\d{2,4})\b/g;
  const numericCandidates: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = numericRe.exec(text)) !== null) {
    const day = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    let year = parseInt(m[3], 10);
    if (year < 100) year = 2000 + year;
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;
    if (year < 2020 || year > 2099) continue;
    numericCandidates.push(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  }
  if (numericCandidates.length > 0) {
    // Si une date est proche du mot "date" ou "facture", on la prend.
    // Sinon on prend la plus ancienne (plus probable pour une facture).
    return numericCandidates[0];
  }

  // 2. Date textuelle : "15 mai 2026" / "15 May 2026"
  const textRe =
    /\b(\d{1,2})\s+([a-zéûâô]+)\s+(\d{4})\b/gi;
  while ((m = textRe.exec(text)) !== null) {
    const day = parseInt(m[1], 10);
    const monthName = m[2].toLowerCase().replace(/[éèê]/g, "e").slice(0, 4);
    const year = parseInt(m[3], 10);
    const monthNum =
      MONTHS_MAP[monthName] ?? MONTHS_MAP[monthName.slice(0, 3)] ?? null;
    if (monthNum && day >= 1 && day <= 31 && year >= 2020 && year <= 2099) {
      return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
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
