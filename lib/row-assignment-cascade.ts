import {
  getAllState,
  getExcelSheet,
  insertAutoRowAssignmentIfAbsent,
  listAllRowAssignments,
  listExcelSheets,
  reassignRow,
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

/**
 * Renvoie à `to` toutes les lignes du même fournisseur que la ligne source
 * qui appartiennent à la même personne qu'elle, puis attribue à `to` les
 * lignes de ce fournisseur encore libres (mois source et suivants).
 */
export async function reassignSameCreditor(opts: {
  month: string;
  currency: string;
  row: number;
  to: RowAssignee;
  assignedBy: string | null;
}): Promise<{ moved: number; added: number }> {
  const all = await listAllRowAssignments({});
  const source = all.find(
    (a) => a.month === opts.month && a.accountCurrency === opts.currency && a.rowNumber === opts.row,
  );
  const key = await getCreditorKeyFor(opts.month, opts.currency, opts.row);
  if (!source || !key) return { moved: 0, added: 0 };

  const cache = new Map<string, { sheet: StoredExcelSheet; cols: SheetColumns } | null>();
  let moved = 0;
  for (const a of all) {
    if (a.assignee !== source.assignee) continue;
    const k = `${a.month}|${a.accountCurrency}`;
    if (!cache.has(k)) {
      const sheet = await getExcelSheet(a.month, a.accountCurrency);
      cache.set(k, sheet ? { sheet, cols: columnsOf(sheet) } : null);
    }
    const s = cache.get(k);
    if (!s || creditorKeyAt(s.sheet, s.cols, a.rowNumber - 2) !== key) continue;
    await reassignRow({
      month: a.month,
      accountCurrency: a.accountCurrency,
      rowNumber: a.rowNumber,
      assignee: opts.to,
      assignedBy: opts.assignedBy,
    });
    moved++;
  }
  const { added } = await cascadeAssignment({
    creditorKey: key,
    assignee: opts.to,
    assignedBy: opts.assignedBy,
    sinceMonth: opts.month,
    excludeSelf: { month: opts.month, currency: opts.currency, row: opts.row },
  });
  return { moved, added };
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
      // Seulement les débits : une entrée d'argent du même nom n'est pas une tâche.
      const amount = rowAmount(sheet.rows[i], cols);
      if (amount == null || amount >= 0) continue;
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
  problem: boolean;
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
    problem: boolean;
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
