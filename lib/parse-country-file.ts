import * as XLSX from "xlsx";
import { EMPTY_TX_COUNTS } from "./types";
import type { CountryRevenue, TxCounts } from "./types";

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
  /^(pays|country|code|iso|nation|currency|amount|revenu|montant|total|prix|price|gross|net|sales|statut|status|state|outcome)/i;

/**
 * Classe un statut en un bucket de TxCounts.
 * Renvoie la clé du bucket ou null si inconnu.
 */
function classifyStatus(s: string): keyof TxCounts | null {
  const n = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
  if (!n) return null;
  if (/(captured|capture|approved|success|succeeded|paid|settled|completed|ok|valid)\b/.test(n)) return "captured";
  if (/(authoriz|authorisa|^auth$|preauth)/.test(n)) return "authorized";
  if (/(declin|refus|fail|reject|error)/.test(n)) return "declined";
  if (/(refund|remboursement|reimburs)/.test(n)) return "refund";
  if (/(chargeback|dispute|^cb$)/.test(n)) return "chargeback";
  if (/(retrieval|retrival)/.test(n)) return "retrievalRequest";
  if (/(pre-?arb|prearbitration|pre arbitrage)/.test(n)) return "preArbitration";
  return null;
}

export type ParseResult = {
  rows: CountryRevenue[];
  txCounts: TxCounts;
  totalCaptured: number;
  warnings: string[];
};

/**
 * Parse un fichier transactions. Formats supportés :
 *  - 3 colonnes : statut | pays | montant (ordre auto-détecté)
 *  - 2 colonnes : pays | montant ou montant | pays (legacy)
 *
 * Les transactions sont :
 *   - comptées par statut (auth, capture, declined, refund, chargeback…)
 *   - sommées par pays (uniquement celles "captured" ; les refund/chargeback
 *     sont déduits — refund et chargeback réduisent le revenu réel)
 */
export async function parseCountryFile(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  });

  const warnings: string[] = [];
  const txCounts: TxCounts = { ...EMPTY_TX_COUNTS };

  if (rows.length === 0) {
    warnings.push("Fichier vide.");
    return { rows: [], txCounts, totalCaptured: 0, warnings };
  }

  // Détecte présence d'un header sur la 1ʳᵉ ligne.
  const first = rows[0];
  const firstCells = [0, 1, 2].map((i) => String(first?.[i] ?? "").trim());
  const isHeader = firstCells.some(
    (c) => HEADER_RE.test(c) && !isNumericish(c),
  );

  const data = isHeader ? rows.slice(1) : rows;
  if (data.length === 0) {
    warnings.push("Aucune donnée après l'en-tête.");
    return { rows: [], txCounts, totalCaptured: 0, warnings };
  }

  // Combien de colonnes utiles (max 3) ?
  const maxCols = Math.max(
    ...data.slice(0, 50).map((r) => (r ? r.length : 0)),
  );
  const useStatusCol = maxCols >= 3;

  // Auto-détecte la colonne montant parmi les colonnes restantes.
  const candidateCols = useStatusCol ? [1, 2] : [0, 1];
  const numericCount: Record<number, number> = {};
  data.slice(0, Math.min(20, data.length)).forEach((row) => {
    candidateCols.forEach((c) => {
      if (isNumericish(row?.[c])) numericCount[c] = (numericCount[c] ?? 0) + 1;
    });
  });
  const amountCol = candidateCols.reduce((best, c) =>
    (numericCount[c] ?? 0) > (numericCount[best] ?? 0) ? c : best,
  );
  const countryCol = candidateCols.find((c) => c !== amountCol)!;
  const statusCol = useStatusCol ? 0 : -1;

  const byCountry = new Map<string, number>();
  let totalCaptured = 0;

  data.forEach((row, idx) => {
    const rawAmount = row?.[amountCol];
    const rawCountry = row?.[countryCol];
    const rawStatus = statusCol >= 0 ? row?.[statusCol] : null;
    const country = String(rawCountry ?? "").trim();
    const amount = parseAmount(rawAmount);

    // Classement du statut.
    let bucket: keyof TxCounts | null = null;
    if (statusCol >= 0) {
      const s = String(rawStatus ?? "").trim();
      if (s) {
        bucket = classifyStatus(s);
        if (!bucket) {
          warnings.push(
            `Ligne ${idx + (isHeader ? 2 : 1)} : statut inconnu (${s}) — ignoré pour les compteurs.`,
          );
        } else {
          txCounts[bucket] += 1;
        }
      }
    } else {
      // Pas de colonne statut → toutes considérées comme capturées.
      bucket = "captured";
      txCounts.captured += 1;
    }

    if (amount == null) {
      if (rawAmount !== null && rawAmount !== "") {
        warnings.push(
          `Ligne ${idx + (isHeader ? 2 : 1)} : montant illisible (${rawAmount}).`,
        );
      }
      return;
    }

    if (!country) return;
    const code = country.slice(0, 64);

    // Pour la répartition par pays : on n'ajoute que les transactions captured.
    // Refund / chargeback sont retirés du capturé.
    if (bucket === "captured") {
      byCountry.set(code, (byCountry.get(code) ?? 0) + amount);
      totalCaptured += amount;
    } else if (bucket === "refund" || bucket === "chargeback") {
      byCountry.set(code, (byCountry.get(code) ?? 0) - amount);
      totalCaptured -= amount;
    }
  });

  const out: CountryRevenue[] = Array.from(byCountry.entries())
    .map(([country, amount]) => ({
      country,
      amount: Math.round(amount * 100) / 100,
    }))
    .sort((a, b) => b.amount - a.amount);

  if (out.length === 0) {
    warnings.push("Aucune ligne pays/montant exploitable détectée.");
  }

  return {
    rows: out,
    txCounts,
    totalCaptured: Math.round(totalCaptured * 100) / 100,
    warnings,
  };
}
