import * as XLSX from "xlsx";
import type { CountryRevenue } from "./types";

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

  // Detect header row: if first cell is text that looks like "pays", skip.
  const first = rows[0];
  const firstA = String(first?.[0] ?? "").trim().toLowerCase();
  const isHeader =
    /^(pays|country|country code|iso)/.test(firstA) ||
    (typeof first?.[1] === "string" &&
      /^(revenu|amount|montant|total)/i.test(String(first[1])));

  const data = isHeader ? rows.slice(1) : rows;
  const out: CountryRevenue[] = [];

  data.forEach((row, idx) => {
    const country = String(row?.[0] ?? "").trim();
    const raw = row?.[1];
    if (!country) return;
    let amount = 0;
    if (typeof raw === "number") amount = raw;
    else if (raw != null) {
      const clean = String(raw)
        .replace(/[' \s]/g, "")
        .replace(/,/g, ".")
        .replace(/[^\d.\-]/g, "");
      const n = parseFloat(clean);
      if (Number.isFinite(n)) amount = n;
      else {
        warnings.push(`Ligne ${idx + (isHeader ? 2 : 1)} : montant illisible (${raw}).`);
        return;
      }
    }
    out.push({ country: country.toUpperCase().slice(0, 32), amount });
  });

  if (out.length === 0)
    warnings.push("Aucune ligne pays/montant exploitable détectée.");

  return { rows: out, warnings };
}
