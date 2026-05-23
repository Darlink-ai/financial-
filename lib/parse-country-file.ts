import * as XLSX from "xlsx";
import type { CountryRevenue } from "./types";

function parseAmount(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const clean = String(v)
    .replace(/[' \s]/g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.\-]/g, "");
  if (!clean) return null;
  const n = parseFloat(clean);
  return Number.isFinite(n) ? n : null;
}

function isNumericish(v: unknown): boolean {
  return parseAmount(v) != null;
}

const HEADER_RE =
  /^(pays|country|code|iso|nation|currency|amount|revenu|montant|total|prix|price|gross|net|sales)/i;

export async function parseCountryFile(
  file: File,
): Promise<{ rows: CountryRevenue[]; warnings: string[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  });

  const warnings: string[] = [];
  if (rows.length === 0) {
    warnings.push("Fichier vide.");
    return { rows: [], warnings };
  }

  // Détecte si la première ligne est un header.
  const first = rows[0];
  const firstA = String(first?.[0] ?? "").trim();
  const firstB = String(first?.[1] ?? "").trim();
  const isHeader =
    (HEADER_RE.test(firstA) && !isNumericish(firstA)) ||
    (HEADER_RE.test(firstB) && !isNumericish(firstB));

  const data = isHeader ? rows.slice(1) : rows;
  if (data.length === 0) {
    warnings.push("Aucune donnée après l'en-tête.");
    return { rows: [], warnings };
  }

  // Auto-détecte quelle colonne est numérique. On compte sur les 20
  // premières lignes pour deviner.
  const sample = data.slice(0, Math.min(20, data.length));
  let colANumeric = 0;
  let colBNumeric = 0;
  sample.forEach((row) => {
    if (isNumericish(row?.[0])) colANumeric++;
    if (isNumericish(row?.[1])) colBNumeric++;
  });

  const amountCol: 0 | 1 = colANumeric > colBNumeric ? 0 : 1;
  const countryCol: 0 | 1 = amountCol === 0 ? 1 : 0;

  // Groupe par pays + somme les montants.
  const map = new Map<string, number>();
  data.forEach((row, idx) => {
    const rawCountry = row?.[countryCol];
    const rawAmount = row?.[amountCol];
    const country = String(rawCountry ?? "").trim();
    if (!country) return;
    const amount = parseAmount(rawAmount);
    if (amount == null) {
      warnings.push(
        `Ligne ${idx + (isHeader ? 2 : 1)} : montant illisible (${rawAmount}).`,
      );
      return;
    }
    const code = country.slice(0, 64);
    map.set(code, (map.get(code) ?? 0) + amount);
  });

  const out: CountryRevenue[] = Array.from(map.entries())
    .map(([country, amount]) => ({
      country,
      amount: Math.round(amount * 100) / 100,
    }))
    .sort((a, b) => b.amount - a.amount);

  if (out.length === 0) warnings.push("Aucune ligne pays/montant exploitable détectée.");

  return { rows: out, warnings };
}
