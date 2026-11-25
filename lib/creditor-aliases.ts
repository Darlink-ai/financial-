/**
 * Table d'alias créditeur — noms différents pour la MÊME entité. Utile
 * parce que la banque affiche souvent l'entité légale (ex. "Sendinblue")
 * alors que la facture PDF montre le nom commercial (ex. "Brevo"). Sans
 * cette table, le matcher signalerait un mismatch créditeur alors que
 * c'est bien la même boîte.
 *
 * Module partagé entre serveur (auto-process) et client (/import UI).
 */

export const CREDITOR_ALIASES: string[][] = [
  ["sendinblue", "brevo"],
  ["facebook", "meta", "instagram", "whatsapp"],
  ["google", "alphabet", "gcp"],
  ["twitter", "x corp"],
  ["novita", "novita.ai"],
  ["elevenlabs", "eleven labs"],
];

// Mots trop génériques pour prouver qu'un fournisseur est sur une ligne
// (« Atlas Cloud » ne doit pas coller avec « Google CLOUD »), plus le
// vocabulaire des relevés UBS (« Paiement carte de debit »…).
const STOPWORDS = new Set([
  "cloud", "services", "service", "technologies", "technology", "tech", "limited",
  "gmbh", "sarl", "corp", "corporation", "company", "group", "holding", "holdings",
  "international", "global", "solutions", "systems", "software", "digital", "online",
  "media", "studio", "labs", "team", "plan", "subscription", "subscr", "invoice",
  "receipt", "payment", "payments", "paiement", "carte", "debit", "credit",
  "transaction", "montant", "exchange", "rate", "couts", "commerce", "ordre",
  "banking", "compte", "account", "reference", "motif", "inc", "llc", "ltd",
  "this", "paying", "statement", "generated", "order", "from", "with", "your",
  "pour", "facture", "recu", "solde", "frais", "suisse", "switzerland",
]);

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Retourne true si le créditeur PDF (ou un de ses alias) apparaît dans
 * le texte de la row Excel.
 */
export function creditorMatchesRow(
  pdfCreditor: string | null,
  excelRowText: string | null,
): boolean {
  if (!pdfCreditor || !excelRowText) return false;
  const invNorm = normalize(pdfCreditor);
  const excelNorm = normalize(excelRowText);
  if (!invNorm || !excelNorm) return false;

  // Match direct : n'importe quel mot ≥ 4 chars du créditeur PDF trouvé
  // dans la row bancaire.
  const tokens = invNorm.split(" ").filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  if (tokens.some((t) => excelNorm.includes(t))) return true;

  // Noms courts (« AWS », « UBS », « X.AI ») : le nom collé, sans les mots
  // génériques, doit apparaître tel quel dans la ligne collée.
  if (tokens.length === 0) {
    const compact = invNorm
      .split(" ")
      .filter((t) => !STOPWORDS.has(t))
      .join("");
    if (compact.length >= 3 && excelNorm.replace(/ /g, "").includes(compact)) return true;
  }

  // Match via alias : cherche si le créditeur PDF est dans un groupe
  // d'alias, puis vérifie si un des autres noms du groupe est dans la
  // row bancaire.
  for (const group of CREDITOR_ALIASES) {
    const invInGroup = group.some((alias) => invNorm.includes(alias));
    if (!invInGroup) continue;
    const excelInGroup = group.some((alias) => excelNorm.includes(alias));
    if (excelInGroup) return true;
  }
  return false;
}
