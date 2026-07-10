import { NextResponse } from "next/server";
import postgres from "postgres";
import {
  getAllMappings,
  getExcelSheet,
  getInvoiceWithAttachment,
  getOccupiedExcelRows,
} from "@/lib/db";
import { extractInvoiceFromPdf } from "@/lib/pdf-extract";
import { classifyAgainstMappings, deriveBankAccount } from "@/lib/auto-classify";
import {
  findBestCandidate,
  matchInvoicesAgainstSheet,
} from "@/lib/excel-match";
import type { AccountCurrency, Invoice } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CURRENCIES: AccountCurrency[] = ["EUR", "CHF", "USD"];

/**
 * GET /api/invoices/debug-match?invoiceId=<id>&auth=<CRON_SECRET>
 * OU
 * GET /api/invoices/debug-match?creditor=runpod&month=2026-03&auth=<CRON_SECRET>
 *
 * Dry-run du pipeline extraction + match sur une facture existante (par id)
 * OU trouve la dernière facture matching creditor + mois et fait le dry-run.
 *
 * Renvoie : extracted, occupied rows par currency, matches par pass,
 * near-miss, ligne finale choisie + raisons + row content brut.
 *
 * Auth : ?auth=<CRON_SECRET> pour bypass middleware.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const auth = url.searchParams.get("auth") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || auth !== cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let invoiceId = url.searchParams.get("invoiceId");
  const creditor = url.searchParams.get("creditor");
  const month = url.searchParams.get("month");

  if (!invoiceId && creditor && month) {
    // Trouve la dernière facture matching le créditeur + mois (Ajout manuel).
    const sql = postgres(
      process.env.DATABASE_URL ??
        process.env.POSTGRES_URL ??
        "postgres://localhost/postgres",
      { max: 1, prepare: false, ssl: "require" },
    );
    try {
      const rows = await sql<{ id: string }[]>`
        SELECT id FROM invoices
        WHERE mailbox = 'Ajout manuel'
          AND creditor ILIKE ${"%" + creditor + "%"}
          AND invoice_date IS NOT NULL
          AND to_char(invoice_date, 'YYYY-MM') = ${month}
        ORDER BY received_at DESC
        LIMIT 1
      `;
      invoiceId = rows[0]?.id ?? null;
    } finally {
      await sql.end();
    }
  }

  if (!invoiceId) {
    return NextResponse.json(
      { error: "missing_id", message: "invoiceId requis (ou creditor+month)." },
      { status: 400 },
    );
  }

  const record = await getInvoiceWithAttachment(invoiceId);
  if (!record?.attachmentB64) {
    return NextResponse.json(
      { error: "no_attachment", invoiceId },
      { status: 404 },
    );
  }

  const pdfBuffer = Buffer.from(record.attachmentB64, "base64");
  const extracted = await extractInvoiceFromPdf({
    pdfBuffer,
    fromEmail: record.fromEmail,
  });

  const mappings = await getAllMappings();
  const classify = await classifyAgainstMappings({
    mappings,
    creditor: extracted.creditor,
    subject: record.subject,
    fromEmail: record.fromEmail,
    pdfTextExcerpt: extracted.text,
  });

  const invMonth = extracted.invoiceDate?.slice(0, 7) ?? null;
  const dummy: Invoice = {
    id: invoiceId,
    subject: record.subject,
    fromEmail: record.fromEmail,
    mailbox: "",
    receivedAt: record.invoice.receivedAt,
    creditor: extracted.creditor,
    invoiceDate: extracted.invoiceDate,
    amount: extracted.amount,
    currency: extracted.currency,
    folderCode: classify.mapping?.folderCode ?? null,
    folderLabel: classify.mapping?.folderLabel ?? null,
    finalName: null,
    drivePath: null,
    status: "classified",
    excelRowMatched: null,
    attachment: null,
    accountCurrency: deriveBankAccount(extracted.currency),
  };

  const perCurrency: Record<string, unknown> = {};
  if (invMonth) {
    for (const currency of CURRENCIES) {
      const sheet = await getExcelSheet(invMonth, currency);
      if (!sheet) {
        perCurrency[currency] = { skipped: "no sheet" };
        continue;
      }
      const occupiedRows = await getOccupiedExcelRows({
        invoiceMonth: invMonth,
        accountCurrency: currency,
        excludeInvoiceId: invoiceId,
      });

      const pass1 = matchInvoicesAgainstSheet(
        { headers: sheet.headers, rows: sheet.rows },
        [dummy],
        { excludeRowIndices: occupiedRows },
      );
      const pass1b = findBestCandidate(
        { headers: sheet.headers, rows: sheet.rows },
        dummy,
        { excludeRowIndices: occupiedRows },
      );
      const pass2 = matchInvoicesAgainstSheet(
        { headers: sheet.headers, rows: sheet.rows },
        [dummy],
      );

      // Récupère le contenu brut de la ligne actuellement matchée (excel_row_matched)
      const currentMatchedRow = record.invoice.excelRowMatched;
      const currentRowContent =
        currentMatchedRow != null
          ? sheet.rows[currentMatchedRow - 2] ?? null
          : null;

      perCurrency[currency] = {
        occupiedRows: Array.from(occupiedRows).sort((a, b) => a - b),
        pass1_result: pass1[0]
          ? {
              row: pass1[0].rowIndex + 2,
              score: null,
              reasons: pass1[0].reasons,
              excelAmount: pass1[0].excelAmount,
            }
          : null,
        pass1b_bestNearMiss: pass1b
          ? {
              row: pass1b.result.rowIndex + 2,
              score: pass1b.score,
              reasons: pass1b.result.reasons,
              excelAmount: pass1b.result.excelAmount,
            }
          : null,
        pass2_result: pass2[0]
          ? {
              row: pass2[0].rowIndex + 2,
              score: null,
              reasons: pass2[0].reasons,
              excelAmount: pass2[0].excelAmount,
            }
          : null,
        currentDbMatchedRow: currentMatchedRow,
        currentDbMatchedRowContent: currentRowContent,
      };
    }
  }

  return NextResponse.json({
    invoiceId,
    dbState: {
      creditor: record.invoice.creditor,
      amount: record.invoice.amount,
      currency: record.invoice.currency,
      invoiceDate: record.invoice.invoiceDate,
      excelRowMatched: record.invoice.excelRowMatched,
      accountCurrency: record.invoice.accountCurrency,
      status: record.invoice.status,
      lastError: record.invoice.lastError,
    },
    extracted: {
      creditor: extracted.creditor,
      amount: extracted.amount,
      currency: extracted.currency,
      invoiceDate: extracted.invoiceDate,
      textPreview: extracted.text?.slice(0, 500),
    },
    classification: {
      mapping: classify.mapping,
      via: classify.via,
      reason: classify.reason,
    },
    perCurrency,
  });
}
