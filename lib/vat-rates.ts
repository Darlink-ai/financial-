/**
 * Taux de TVA standard par pays (ISO 3166-1 alpha-2) — état 2026.
 *
 * Uniquement les pays UE + UK (les pays hors ce périmètre sont exclus des
 * calculs de TVA MOSS / OSS de la page /taxes/tva).
 *
 * Source : commission européenne + HMRC. À réviser 1x/an, les taux
 * changent rarement mais ça arrive (ex : Finlande 25.5% depuis 09/2024,
 * Slovaquie 23% depuis 01/2025, Estonie 24% depuis 07/2025).
 */

export type VatCountry = {
  iso: string; // ISO 3166-1 alpha-2
  name: string; // Nom fr
  rate: number; // taux standard en %
  isUk: boolean;
};

export const VAT_COUNTRIES: VatCountry[] = [
  { iso: "AT", name: "Autriche", rate: 20, isUk: false },
  { iso: "BE", name: "Belgique", rate: 21, isUk: false },
  { iso: "BG", name: "Bulgarie", rate: 20, isUk: false },
  { iso: "HR", name: "Croatie", rate: 25, isUk: false },
  { iso: "CY", name: "Chypre", rate: 19, isUk: false },
  { iso: "CZ", name: "Tchéquie", rate: 21, isUk: false },
  { iso: "DK", name: "Danemark", rate: 25, isUk: false },
  { iso: "EE", name: "Estonie", rate: 24, isUk: false },
  { iso: "FI", name: "Finlande", rate: 25.5, isUk: false },
  { iso: "FR", name: "France", rate: 20, isUk: false },
  { iso: "DE", name: "Allemagne", rate: 19, isUk: false },
  { iso: "GR", name: "Grèce", rate: 24, isUk: false },
  { iso: "HU", name: "Hongrie", rate: 27, isUk: false },
  { iso: "IE", name: "Irlande", rate: 23, isUk: false },
  { iso: "IT", name: "Italie", rate: 22, isUk: false },
  { iso: "LV", name: "Lettonie", rate: 21, isUk: false },
  { iso: "LT", name: "Lituanie", rate: 21, isUk: false },
  { iso: "LU", name: "Luxembourg", rate: 17, isUk: false },
  { iso: "MT", name: "Malte", rate: 18, isUk: false },
  { iso: "NL", name: "Pays-Bas", rate: 21, isUk: false },
  { iso: "PL", name: "Pologne", rate: 23, isUk: false },
  { iso: "PT", name: "Portugal", rate: 23, isUk: false },
  { iso: "RO", name: "Roumanie", rate: 19, isUk: false },
  { iso: "SK", name: "Slovaquie", rate: 23, isUk: false },
  { iso: "SI", name: "Slovénie", rate: 22, isUk: false },
  { iso: "ES", name: "Espagne", rate: 21, isUk: false },
  { iso: "SE", name: "Suède", rate: 25, isUk: false },
  // UK ne fait plus partie de l'UE mais applique aussi la TVA sur services
  // digitaux vers UK residents (règle post-Brexit similaire à MOSS).
  { iso: "GB", name: "Royaume-Uni", rate: 20, isUk: true },
  { iso: "UK", name: "Royaume-Uni", rate: 20, isUk: true }, // alias GB
];

/**
 * Alias par nom complet (anglais + français) → code ISO. Les revenus
 * stockent souvent des noms complets ("United Kingdom", "Allemagne"…)
 * plutôt que des codes ISO2 — on résout dans les deux sens.
 */
const NAME_TO_ISO: Record<string, string> = {
  // EN
  "AUSTRIA": "AT",
  "BELGIUM": "BE",
  "BULGARIA": "BG",
  "CROATIA": "HR",
  "CYPRUS": "CY",
  "CZECHIA": "CZ", "CZECH REPUBLIC": "CZ",
  "DENMARK": "DK",
  "ESTONIA": "EE",
  "FINLAND": "FI",
  "FRANCE": "FR",
  "GERMANY": "DE",
  "GREECE": "GR",
  "HUNGARY": "HU",
  "IRELAND": "IE",
  "ITALY": "IT",
  "LATVIA": "LV",
  "LITHUANIA": "LT",
  "LUXEMBOURG": "LU",
  "MALTA": "MT",
  "NETHERLANDS": "NL", "THE NETHERLANDS": "NL",
  "POLAND": "PL",
  "PORTUGAL": "PT",
  "ROMANIA": "RO",
  "SLOVAKIA": "SK",
  "SLOVENIA": "SI",
  "SPAIN": "ES",
  "SWEDEN": "SE",
  "UNITED KINGDOM": "GB", "UK": "GB", "GREAT BRITAIN": "GB", "BRITAIN": "GB",
  // FR
  "AUTRICHE": "AT",
  "BELGIQUE": "BE",
  "BULGARIE": "BG",
  "CROATIE": "HR",
  "CHYPRE": "CY",
  "TCHÉQUIE": "CZ", "TCHEQUIE": "CZ", "RÉPUBLIQUE TCHÈQUE": "CZ",
  "DANEMARK": "DK",
  "ESTONIE": "EE",
  "FINLANDE": "FI",
  "ALLEMAGNE": "DE",
  "GRÈCE": "GR", "GRECE": "GR",
  "HONGRIE": "HU",
  "IRLANDE": "IE",
  "ITALIE": "IT",
  "LETTONIE": "LV",
  "LITUANIE": "LT",
  "MALTE": "MT",
  "PAYS-BAS": "NL", "PAYS BAS": "NL", "HOLLANDE": "NL",
  "POLOGNE": "PL",
  "ROUMANIE": "RO",
  "SLOVAQUIE": "SK",
  "SLOVÉNIE": "SI", "SLOVENIE": "SI",
  "ESPAGNE": "ES",
  "SUÈDE": "SE", "SUEDE": "SE",
  "ROYAUME-UNI": "GB", "ROYAUME UNI": "GB", "GRANDE-BRETAGNE": "GB", "GRANDE BRETAGNE": "GB",
};

const RATE_BY_ISO = new Map(
  VAT_COUNTRIES.map((c) => [c.iso.toUpperCase(), c] as const),
);

/**
 * Résout un identifiant pays (ISO2 comme "FR", nom EN comme "France" ou
 * "United Kingdom", nom FR comme "Allemagne") en VatCountry. Renvoie null
 * si pays hors UE + UK ou nom inconnu.
 */
export function findVatCountry(input: string | null | undefined): VatCountry | null {
  if (!input) return null;
  const s = input.trim().toUpperCase();
  // 1) tentative ISO direct
  const byIso = RATE_BY_ISO.get(s);
  if (byIso) return byIso;
  // 2) tentative nom complet
  const iso = NAME_TO_ISO[s];
  if (iso) return RATE_BY_ISO.get(iso) ?? null;
  return null;
}

/** True si un pays est UE ou UK (donc concerné par la déclaration TVA). */
export function isEuOrUk(input: string | null | undefined): boolean {
  return findVatCountry(input) != null;
}
