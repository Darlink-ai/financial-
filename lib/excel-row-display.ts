import { detectColumns, type ParsedSheet } from "@/lib/excel-match";

// Règles d'affichage d'une ligne de relevé, partagées entre la page
// Rapprochement Excel et la page Tâches pour qu'elles montrent la même chose.

export type Cell = string | number | Date | null | undefined;

export type SheetColumns = ReturnType<typeof detectColumns> & {
  idxSubAmount: number;
};

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function sheetColumns(sheet: ParsedSheet): SheetColumns {
  const cols = detectColumns(sheet);
  const headerRow = cols.dataStartRow > 0 ? sheet.rows[cols.dataStartRow - 1] ?? [] : [];
  const idxSubAmount = headerRow.findIndex((h) =>
    norm(String(h ?? "")).startsWith("sous-montant"),
  );
  return { ...cols, idxSubAmount };
}

export function toNumber(v: Cell): number | null {
  if (v == null || v === "" || v instanceof Date) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = Number(String(v).replace(/['\s]/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Débit (négatif), sinon crédit (positif), sinon sous-montant (lignes de
// détail d'un ordre groupé, ex. impôts).
export function rowAmount(row: Cell[], cols: SheetColumns): number | null {
  if (cols.idxDebit >= 0) {
    const d = toNumber(row[cols.idxDebit]);
    if (d != null && d !== 0) return -Math.abs(d);
  }
  if (cols.idxCredit >= 0) {
    const c = toNumber(row[cols.idxCredit]);
    if (c != null && c !== 0) return Math.abs(c);
  }
  if (cols.idxDebit < 0 && cols.idxAmount >= 0) {
    const a = toNumber(row[cols.idxAmount]);
    if (a != null) return a;
  }
  if (cols.idxSubAmount >= 0) {
    const s = toNumber(row[cols.idxSubAmount]);
    if (s != null) return s;
  }
  return null;
}

export function formatShortDate(v: Cell): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) {
    return v.toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : String(v);
}

export function rowDescription(row: Cell[], cols: SheetColumns): string {
  return cols.idxCreditor >= 0 && row[cols.idxCreditor] != null
    ? String(row[cols.idxCreditor])
    : "";
}

// « RUNPOD.IO;08057 RUNPOD.IO » → « RUNPOD.IO » ; « Robin Koller;Les Mengartes… » → « Robin Koller ».
export function shortDescription(s: string): string {
  const first = s.split(";")[0].trim();
  return first || s.trim();
}

export function formatSignedAmount(n: number | null): string {
  if (n == null) return "";
  return new Intl.NumberFormat("fr-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(n);
}
