import type { AccountCurrency } from "@/lib/types";

// « octobre - EUR - 185.pdf » → { month: "2026-10", currency: "EUR", row: 185 }.
// Partagé entre la page Ajout manuel (aperçu immédiat) et le serveur.

export type DirectFileTarget = {
  month: string;
  currency: AccountCurrency;
  row: number;
};

export type DirectFileParse =
  | ({ ok: true } & DirectFileTarget)
  | { ok: false; reason: string };

const MONTHS: [number, string[]][] = [
  [1, ["janvier", "janv", "jan", "january"]],
  [2, ["fevrier", "fevr", "fev", "feb", "february"]],
  [3, ["mars", "mar", "march"]],
  [4, ["avril", "avr", "apr", "april"]],
  [5, ["mai", "may"]],
  [6, ["juin", "jun", "june"]],
  [7, ["juillet", "juil", "jul", "july"]],
  [8, ["aout", "aou", "aug", "august"]],
  [9, ["septembre", "sept", "sep", "september"]],
  [10, ["octobre", "oct", "october"]],
  [11, ["novembre", "nov", "november"]],
  [12, ["decembre", "dec", "december"]],
];

const CURRENCIES: [AccountCurrency, string[]][] = [
  ["EUR", ["eur", "euro", "euros", "€"]],
  ["CHF", ["chf", "franc", "francs", "fr"]],
  ["USD", ["usd", "dollar", "dollars", "$", "us"]],
];

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export function parseDirectFileName(fileName: string, today = new Date()): DirectFileParse {
  const base = fileName.replace(/\.[a-z0-9]+$/i, "");
  const parts = base
    .split(/\s*[-–—_]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 3) {
    return { ok: false, reason: "Nom attendu : « mois - devise - n° de ligne »." };
  }

  let monthNum: number | null = null;
  let year: number | null = null;
  let currency: AccountCurrency | null = null;
  let row: number | null = null;

  for (const part of parts) {
    const words = norm(part).split(/\s+/);
    for (const w of words) {
      if (monthNum == null) {
        const hit = MONTHS.find(([, names]) => names.includes(w.replace(/\.$/, "")));
        if (hit) {
          monthNum = hit[0];
          continue;
        }
      }
      if (currency == null) {
        const hit = CURRENCIES.find(([, names]) => names.includes(w));
        if (hit) {
          currency = hit[0];
          continue;
        }
      }
      if (/^(19|20)\d{2}$/.test(w) && year == null) {
        year = Number(w);
        continue;
      }
      if (/^\d{1,4}$/.test(w) && row == null) {
        row = Number(w);
      }
    }
  }

  if (monthNum == null) return { ok: false, reason: "Mois introuvable dans le nom." };
  if (currency == null) return { ok: false, reason: "Devise introuvable (EUR, CHF ou USD)." };
  if (row == null || row < 2) return { ok: false, reason: "N° de ligne introuvable dans le nom." };

  if (year == null) {
    // Le dernier mois de ce nom qui n'est pas dans le futur.
    const curY = today.getFullYear();
    const curM = today.getMonth() + 1;
    year = monthNum <= curM ? curY : curY - 1;
  }
  return {
    ok: true,
    month: `${year}-${String(monthNum).padStart(2, "0")}`,
    currency,
    row,
  };
}
