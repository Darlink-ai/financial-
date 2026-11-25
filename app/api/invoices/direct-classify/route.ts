import { NextResponse } from "next/server";
import {
  findInvoicesMatchingRow,
  getAllMappings,
  getExcelSheet,
  insertIncomingInvoice,
  updateInvoice,
} from "@/lib/db";
import { classifyAgainstMappings, FALLBACK_MAPPING_ID } from "@/lib/auto-classify";
import { uploadMatchedInvoiceToDrive } from "@/lib/auto-process";
import { buildFinalName, dateInStatementMonth } from "@/lib/format";
import { parseDirectFileName } from "@/lib/direct-file-name";
import {
  rowAmount,
  rowDescription,
  sheetColumns,
  shortDescription,
} from "@/lib/excel-row-display";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

// « PAYPAL *CONTABO » → « CONTABO », « LINK.COM* OPENROUTER, » → « OPENROUTER » :
// l'intermédiaire de paiement n'est pas le fournisseur.
const INTERMEDIARIES = /^(paypal|paddle\.net|link\.com|sq|sp|fs|2co\.com|stripe)\s*\*\s*/i;
function vendorName(s: string): string {
  const v = s.replace(INTERMEDIARIES, "").replace(/[,;\s]+$/, "").trim();
  return v || s.trim();
}

/**
 * POST /api/invoices/direct-classify  (multipart : file)
 *
 * « Facture (renommée) » : le nom du fichier dit déjà où va la facture
 * (« octobre - EUR - 185.pdf »). On ne lit pas le PDF : date, montant et
 * fournisseur viennent de la ligne du relevé, le dossier comptable du
 * classement habituel sur le nom du fournisseur. La facture est rapprochée
 * de la ligne et envoyée sur Drive. Une ligne déjà rapprochée est refusée.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, message: "Fichier manquant." }, { status: 400 });
  }

  const parsed = parseDirectFileName(file.name);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, message: parsed.reason }, { status: 400 });
  }
  const { month, currency, row } = parsed;
  const monthLabel = `${MONTHS_FR[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

  try {
    const sheet = await getExcelSheet(month, currency);
    if (!sheet) {
      return NextResponse.json(
        { ok: false, message: `Pas de relevé ${currency} pour ${monthLabel}.` },
        { status: 404 },
      );
    }
    const cols = sheetColumns({ headers: sheet.headers, rows: sheet.rows });
    const idx = row - 2;
    const bankRow = sheet.rows[idx];
    if (!bankRow || idx < cols.dataStartRow) {
      return NextResponse.json(
        { ok: false, message: `La ligne ${row} n'existe pas dans le relevé ${currency} de ${monthLabel}.` },
        { status: 404 },
      );
    }

    const occupiers = await findInvoicesMatchingRow({
      excludeId: "",
      accountCurrency: currency,
      rowIndex: row,
      invoiceMonth: month,
    });
    if (occupiers.length > 0) {
      const o = occupiers[0];
      return NextResponse.json(
        { ok: false, message: `Ligne ${row} déjà rapprochée (${o.finalName ?? o.id}).` },
        { status: 409 },
      );
    }

    const creditor =
      vendorName(shortDescription(rowDescription(bankRow, cols))) || file.name;
    const amount = rowAmount(bankRow, cols);
    // Les sous-lignes d'un ordre groupé n'ont pas de date : on prend celle
    // de la ligne au-dessus qui en a une.
    let bankDate: string | null = null;
    for (let i = idx; i >= cols.dataStartRow && !bankDate; i--) {
      const v = cols.idxDate >= 0 ? sheet.rows[i]?.[cols.idxDate] : null;
      const m = v != null ? String(v).match(/^(\d{4}-\d{2}-\d{2})/) : null;
      if (m) bankDate = m[1];
    }
    bankDate ??= `${month}-01`;
    // La facture compte dans le mois du relevé (sinon elle tomberait sur la
    // même ligne d'un autre mois) ; le nom garde la vraie date du paiement.
    const invoiceDate = dateInStatementMonth(bankDate, month);

    const mappings = await getAllMappings();
    const verdict = await classifyAgainstMappings({
      mappings,
      creditor,
      subject: file.name,
      fromEmail: "",
    });
    const mapping =
      verdict.mapping ?? mappings.find((m) => m.id === FALLBACK_MAPPING_ID) ?? null;
    const folderCode = mapping?.folderCode ?? null;
    const folderLabel = mapping?.folderLabel ?? null;
    const finalName = buildFinalName(bankDate, creditor, folderCode);

    const bytes = Buffer.from(await file.arrayBuffer());
    const id = `inv-manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await insertIncomingInvoice({
      id,
      mailboxId: "manual",
      sourceMessageId: id,
      subject: file.name,
      fromEmail: "manual@local",
      mailbox: "Ajout manuel",
      receivedAt: new Date().toISOString(),
      attachmentName: file.name,
      attachmentBytes: bytes.length,
      attachmentB64: bytes.toString("base64"),
      accountCurrency: currency,
    });
    await updateInvoice(id, {
      creditor,
      invoiceDate,
      amount: amount != null ? Math.abs(amount) : null,
      currency,
      folderCode,
      folderLabel,
      finalName,
      accountCurrency: currency,
      excelRowMatched: row,
      status: "matched",
    });

    let drive: { uploaded: boolean; drivePath?: string | null; reason?: string };
    try {
      drive = await uploadMatchedInvoiceToDrive(id);
    } catch (e) {
      drive = { uploaded: false, reason: (e as Error).message };
    }

    return NextResponse.json({
      ok: true,
      id,
      month,
      currency,
      row,
      creditor,
      amount,
      invoiceDate,
      folderCode,
      folderLabel,
      finalName,
      drive,
    });
  } catch (e) {
    console.error("POST /api/invoices/direct-classify failed", e);
    return NextResponse.json(
      { ok: false, message: (e as Error).message },
      { status: 500 },
    );
  }
}
