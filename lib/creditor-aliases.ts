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
  const tokens = invNorm.split(" ").filter((t) => t.length >= 4);
  if (tokens.some((t) => excelNorm.includes(t))) return true;

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
