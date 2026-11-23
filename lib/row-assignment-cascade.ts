import { detectColumns, type ParsedSheet } from "@/lib/excel-match";
import {
  getExcelSheet,
  insertAutoRowAssignmentIfAbsent,
  listExcelSheets,
  type RowAssignee,
  type StoredExcelSheet,
} from "@/lib/db";

/**
 * Normalise la description d'une ligne Excel pour servir de clé de
 * fournisseur. Aucune entrée connue → null (on ne cascade pas sur une
 * description vide ou trop générique).
 */
export function creditorKeyFromRow(
  row: (string | number | null)[],
  headers: string[],
): string | null {
  const { idxCreditor } = detectColumns({ headers, rows: [row] });
  const raw =
    idxCreditor >= 0 && row[idxCreditor] != null ? String(row[idxCreditor]) : "";
  const k = normalizeKey(raw);
  if (!k || k.length < 3) return null;
  return k;
}

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join(" ");
}

/**
 * Récupère la description normalisée pour la ligne (month, currency, row).
 * `rowNumber` est l'ID affiché dans la colonne « # » (idx+2).
 */
export async function getCreditorKeyFor(
  month: string,
  accountCurrency: string,
  rowNumber: number,
): Promise<string | null> {
  const sheet = await getExcelSheet(month, accountCurrency);
  if (!sheet) return null;
  const idx = rowNumber - 2;
  if (idx < 0 || idx >= sheet.rows.length) return null;
  return creditorKeyFromRow(sheet.rows[idx], sheet.headers);
}

/**
 * Propage une attribution à toutes les lignes des sheets ≥ `sinceMonth`
 * qui ont la même description normalisée et qui n'ont pas déjà une
 * attribution. Ne touche pas aux cibles déjà attribuées (manuelles ou
 * cascades précédentes).
 *
 * `excludeSelf` : (month, currency, row) de la ligne source, pour ne pas
 *   se marquer soi-même auto_cascaded.
 */
export async function cascadeAssignment(opts: {
  creditorKey: string;
  assignee: RowAssignee;
  assignedBy: string | null;
  sinceMonth: string;
  excludeSelf: { month: string; currency: string; row: number };
}): Promise<{ added: number; scanned: number }> {
  const sheets = await listExcelSheets({ sinceMonth: opts.sinceMonth });
  let added = 0;
  let scanned = 0;
  for (const sheet of sheets) {
    for (let i = 0; i < sheet.rows.length; i++) {
      scanned++;
      const rowNumber = i + 2;
      if (
        sheet.month === opts.excludeSelf.month &&
        sheet.accountCurrency === opts.excludeSelf.currency &&
        rowNumber === opts.excludeSelf.row
      ) {
        continue;
      }
      const key = creditorKeyFromRow(sheet.rows[i], sheet.headers);
      if (key !== opts.creditorKey) continue;
      const ok = await insertAutoRowAssignmentIfAbsent({
        month: sheet.month,
        accountCurrency: sheet.accountCurrency,
        rowNumber,
        assignee: opts.assignee,
        creditorKey: key,
        assignedBy: opts.assignedBy,
      });
      if (ok) added++;
    }
  }
  return { added, scanned };
}

/**
 * Enrichit une liste d'attributions avec, pour chaque ligne, la
 * description Excel + le montant (utile sur la page /tasks).
 */
export type RowAssignmentEnriched = {
  month: string;
  accountCurrency: string;
  rowNumber: number;
  assignee: RowAssignee;
  creditorKey: string | null;
  assignedBy: string | null;
  assignedAt: string;
  autoCascaded: boolean;
  description: string;
  amount: number | null;
  date: string | null;
};

export async function enrichAssignments(
  assignments: Array<{
    month: string;
    accountCurrency: string;
    rowNumber: number;
    assignee: RowAssignee;
    creditorKey: string | null;
    assignedBy: string | null;
    assignedAt: string;
    autoCascaded: boolean;
  }>,
): Promise<RowAssignmentEnriched[]> {
  // Cache sheets by (month, currency) pour éviter plusieurs lectures.
  const cache = new Map<string, StoredExcelSheet | null>();
  const getSheet = async (month: string, currency: string) => {
    const k = `${month}|${currency}`;
    if (!cache.has(k)) cache.set(k, await getExcelSheet(month, currency));
    return cache.get(k) ?? null;
  };
  const out: RowAssignmentEnriched[] = [];
  for (const a of assignments) {
    const sheet = await getSheet(a.month, a.accountCurrency);
    let description = "";
    let amount: number | null = null;
    let date: string | null = null;
    if (sheet) {
      const idx = a.rowNumber - 2;
      if (idx >= 0 && idx < sheet.rows.length) {
        const row = sheet.rows[idx];
        const parsed: ParsedSheet = { headers: sheet.headers, rows: [row] };
        const { idxCreditor, idxAmount, idxDebit, idxDate } =
          detectColumns(parsed);
        if (idxCreditor >= 0 && row[idxCreditor] != null) {
          description = String(row[idxCreditor]).trim();
        }
        const amtIdx = idxDebit >= 0 ? idxDebit : idxAmount;
        if (amtIdx >= 0 && row[amtIdx] != null) {
          const n = Number(
            String(row[amtIdx]).replace(/'/g, "").replace(/,/g, "."),
          );
          if (Number.isFinite(n)) amount = n;
        }
        if (idxDate >= 0 && row[idxDate] != null) {
          const v = String(row[idxDate]);
          const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
          date = m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : v;
        }
      }
    }
    out.push({ ...a, description, amount, date });
  }
  return out;
}
