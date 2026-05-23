import type { Invoice } from "./types";

export type ParsedSheet = {
  headers: string[];
  rows: (string | number | null)[][];
};

export type MatchResult = {
  rowIndex: number; // 0-based in rows[]
  invoice: Invoice;
  confidence: "high" | "medium" | "low";
  reasons: string[];
};

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

function parseAmount(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[^\d,.\-]/g, "").replace(/'/g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function parseDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    // Excel serial date
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + v * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  // dd.mm.yy or dd.mm.yyyy or dd/mm/yyyy
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y, 10) > 50 ? "19" : "20") + y;
    return `${y.padStart(4, "0")}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export function matchInvoicesAgainstSheet(
  sheet: ParsedSheet,
  invoices: Invoice[],
): MatchResult[] {
  const headerNorm = sheet.headers.map(norm);
  const colIdx = (...candidates: string[]) =>
    headerNorm.findIndex((h) => candidates.some((c) => h.includes(c)));

  const idxCreditor = colIdx("creditor", "fournisseur", "creditrice", "creanc", "vendor", "nom");
  const idxAmount = colIdx("montant", "amount", "ttc", "total");
  const idxDate = colIdx("date", "facture");
  const idxCode = colIdx("code", "compte", "categorie");

  const results: MatchResult[] = [];

  for (const inv of invoices) {
    let best: MatchResult | null = null;

    sheet.rows.forEach((row, rowIndex) => {
      const reasons: string[] = [];
      let score = 0;

      const rowCreditor = idxCreditor >= 0 ? norm(row[idxCreditor]) : "";
      const rowAmount = idxAmount >= 0 ? parseAmount(row[idxAmount]) : null;
      const rowDate = idxDate >= 0 ? parseDate(row[idxDate]) : null;
      const rowCode = idxCode >= 0 ? String(row[idxCode] ?? "").trim() : "";

      const invCreditor = norm(inv.creditor);
      if (invCreditor && rowCreditor && rowCreditor.includes(invCreditor)) {
        score += 3;
        reasons.push(`créditeur "${inv.creditor}"`);
      }
      if (inv.amount != null && rowAmount != null) {
        const diff = Math.abs(inv.amount - rowAmount);
        if (diff < 0.01) {
          score += 3;
          reasons.push("montant exact");
        } else if (diff / Math.max(inv.amount, rowAmount) < 0.02) {
          score += 1;
          reasons.push("montant proche");
        }
      }
      if (inv.invoiceDate && rowDate && inv.invoiceDate === rowDate) {
        score += 2;
        reasons.push("date facture");
      }
      if (inv.folderCode && rowCode && rowCode === inv.folderCode) {
        score += 1;
        reasons.push(`code ${inv.folderCode}`);
      }

      if (score >= 4) {
        const candidate: MatchResult = {
          rowIndex,
          invoice: inv,
          confidence: score >= 6 ? "high" : score >= 5 ? "medium" : "low",
          reasons,
        };
        if (!best || score > (best.reasons.length + (best.confidence === "high" ? 3 : best.confidence === "medium" ? 2 : 1))) {
          best = candidate;
        }
      }
    });

    if (best) results.push(best);
  }

  return results;
}
