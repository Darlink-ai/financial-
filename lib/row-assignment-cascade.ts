import {
  getAllState,
  getExcelSheet,
  insertAutoRowAssignmentIfAbsent,
  listExcelSheets,
  type RowAssignee,
  type StoredExcelSheet,
} from "@/lib/db";
import {
  formatShortDate,
  rowAmount,
  rowDescription,
  sheetColumns,
  shortDescription,
  type SheetColumns,
} from "@/lib/excel-row-display";

// Les colonnes se détectent sur le relevé ENTIER (la ligne d'en-tête
// « Date de transaction… » est au milieu des rows) : jamais sur une ligne seule.
function columnsOf(sheet: StoredExcelSheet): SheetColumns {
  return sheetColumns({ headers: sheet.headers, rows: sheet.rows });
}

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Clé fournisseur = nom affiché (partie avant « ; »), normalisé.
function creditorKeyAt(
  sheet: StoredExcelSheet,
  cols: SheetColumns,
  idx: number,
): string | null {
  if (idx < cols.dataStartRow || idx >= sheet.rows.length) return null;
  const k = normalizeKey(shortDescription(rowDescription(sheet.rows[idx], cols)));
  return k.length >= 3 ? k : null;
}

/** `rowNumber` = n° affiché dans la colonne « # » (idx+2). */
export async function getCreditorKeyFor(
  month: string,
  accountCurrency: string,
  rowNumber: number,
): Promise<string | null> {
  const sheet = await getExcelSheet(month, accountCurrency);
  if (!sheet) return null;
  return creditorKeyAt(sheet, columnsOf(sheet), rowNumber - 2);
}

/**
 * Propage une attribution aux lignes des relevés ≥ `sinceMonth` qui ont le
 * même nom de fournisseur et pas encore d'attribution.
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
    const cols = columnsOf(sheet);
    for (let i = cols.dataStartRow; i < sheet.rows.length; i++) {
      scanned++;
      const rowNumber = i + 2;
      if (
        sheet.month === opts.excludeSelf.month &&
        sheet.accountCurrency === opts.excludeSelf.currency &&
        rowNumber === opts.excludeSelf.row
      ) {
        continue;
      }
      if (creditorKeyAt(sheet, cols, i) !== opts.creditorKey) continue;
      const ok = await insertAutoRowAssignmentIfAbsent({
        month: sheet.month,
        accountCurrency: sheet.accountCurrency,
        rowNumber,
        assignee: opts.assignee,
        creditorKey: opts.creditorKey,
        assignedBy: opts.assignedBy,
      });
      if (ok) added++;
    }
  }
  return { added, scanned };
}

export type RowAssignmentEnriched = {
  month: string;
  accountCurrency: string;
  rowNumber: number;
  assignee: RowAssignee;
  creditorKey: string | null;
  assignedBy: string | null;
  assignedAt: string;
  autoCascaded: boolean;
  /** Description complète du relevé (survol). */
  description: string;
  /** Nom affiché, comme dans le tableau Rapprochement Excel. */
  label: string;
  amount: number | null;
  date: string;
  matchedCreditor: string | null;
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
  if (assignments.length === 0) return [];
  const cache = new Map<string, { sheet: StoredExcelSheet; cols: SheetColumns } | null>();
  const getSheet = async (month: string, currency: string) => {
    const k = `${month}|${currency}`;
    if (!cache.has(k)) {
      const sheet = await getExcelSheet(month, currency);
      cache.set(k, sheet ? { sheet, cols: columnsOf(sheet) } : null);
    }
    return cache.get(k) ?? null;
  };

  const { invoices } = await getAllState();
  const matchedBy = new Map<string, string>();
  for (const inv of invoices) {
    if (inv.status !== "matched" || inv.excelRowMatched == null || !inv.invoiceDate) continue;
    const k = `${inv.invoiceDate.slice(0, 7)}|${inv.accountCurrency ?? "USD"}|${inv.excelRowMatched}`;
    if (!matchedBy.has(k)) matchedBy.set(k, inv.creditor ?? "");
  }

  const out: RowAssignmentEnriched[] = [];
  for (const a of assignments) {
    const s = await getSheet(a.month, a.accountCurrency);
    let description = "";
    let amount: number | null = null;
    let date = "";
    if (s) {
      const idx = a.rowNumber - 2;
      const row = s.sheet.rows[idx];
      if (row) {
        description = rowDescription(row, s.cols);
        amount = rowAmount(row, s.cols);
        date = formatShortDate(s.cols.idxDate >= 0 ? row[s.cols.idxDate] : null);
      }
    }
    out.push({
      ...a,
      description,
      label: shortDescription(description),
      amount,
      date,
      matchedCreditor: matchedBy.get(`${a.month}|${a.accountCurrency}|${a.rowNumber}`) ?? null,
    });
  }
  return out;
}
