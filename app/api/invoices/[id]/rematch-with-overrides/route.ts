import { NextResponse } from "next/server";
import {
  getExcelSheet,
  getInvoiceWithAttachment,
  getOccupiedExcelRows,
  updateInvoice,
} from "@/lib/db";
import {
  findBestCandidate,
  matchInvoicesAgainstSheet,
} from "@/lib/excel-match";
import { creditorMatchesRow } from "@/lib/creditor-aliases";
import type { AccountCurrency, Invoice } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const CURRENCIES: AccountCurrency[] = ["EUR", "CHF", "USD"];

/**
 * POST /api/invoices/:id/rematch-with-overrides
 * Body : { creditor?, invoiceDate?, amount?, currency? }
 *
 * Sauve les overrides sur l'invoice + relance UNIQUEMENT le match Excel
 * (pas d'extraction PDF, pas de reclassification). Utile quand l'extraction
 * PDF a raté la date (ou autre champ) et que l'user édite manuellement
 * dans /import — on veut que le match auto se relance avec les nouvelles
 * valeurs sans repasser par tout le pipeline.
 *
 * Renvoie même format que /upload draft : { invoice, outcome: { matchedExcelRow, nearMiss } }.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      creditor?: string;
      invoiceDate?: string;
      amount?: number;
      currency?: string;
    };

    const record = await getInvoiceWithAttachment(id);
    if (!record) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    // Applique les overrides sur l'invoice (sans toucher au status).
    const patch: Partial<Invoice> = {};
    if (body.creditor?.trim()) patch.creditor = body.creditor.trim();
    if (body.invoiceDate?.trim()) patch.invoiceDate = body.invoiceDate.trim();
    if (body.amount != null && Number.isFinite(body.amount))
      patch.amount = Number(body.amount);
    if (body.currency && ["EUR", "CHF", "USD"].includes(body.currency)) {
      patch.currency = body.currency;
    }
    if (Object.keys(patch).length > 0) {
      await updateInvoice(id, patch);
    }

    const inv = { ...record.invoice, ...patch };
    const month = inv.invoiceDate?.slice(0, 7) ?? null;
    if (!month) {
      return NextResponse.json({
        ok: true,
        invoice: inv,
        outcome: {
          matchedExcelRow: null,
          nearMiss: null,
          errors: ["Date de facture requise pour lancer le match."],
        },
      });
    }
    if (inv.amount == null) {
      return NextResponse.json({
        ok: true,
        invoice: inv,
        outcome: {
          matchedExcelRow: null,
          nearMiss: null,
          errors: ["Montant requis pour lancer le match."],
        },
      });
    }

    // Duplicate the pool-building logic from auto-process — cherche dans
    // les 3 sheets, accumule strict + loose, retourne top + otherCandidates.
    type PooledCandidate = {
      currency: AccountCurrency;
      rowIndex: number;
      match: {
        rowIndex: number;
        reasons: string[];
        excelAmount: number | null;
        excelDate: string | null;
        excelRowText?: string;
      };
    };
    const pool: PooledCandidate[] = [];
    for (const currency of CURRENCIES) {
      try {
        const sheet = await getExcelSheet(month, currency);
        if (!sheet) continue;
        const excludeRowIndices = await getOccupiedExcelRows({
          invoiceMonth: month,
          accountCurrency: currency,
          excludeInvoiceId: id,
        });
        const strictMatches = matchInvoicesAgainstSheet(
          { headers: sheet.headers, rows: sheet.rows },
          [inv as Invoice],
          { excludeRowIndices, returnAllCandidates: true },
        );
        const looseMatches = matchInvoicesAgainstSheet(
          { headers: sheet.headers, rows: sheet.rows },
          [inv as Invoice],
          { excludeRowIndices, returnAllCandidates: true, loose: true },
        );
        const strictRowSet = new Set(strictMatches.map((m) => m.rowIndex));
        const extraLoose = looseMatches.filter(
          (m) => !strictRowSet.has(m.rowIndex),
        );
        for (const m of strictMatches)
          pool.push({ currency, rowIndex: m.rowIndex, match: m });
        for (const m of extraLoose)
          pool.push({ currency, rowIndex: m.rowIndex, match: m });
      } catch {
        /* skip currency on error */
      }
    }

    if (pool.length === 0) {
      // Aucun candidat strict ni loose → renvoie juste la closest ligne.
      for (const currency of CURRENCIES) {
        const sheet = await getExcelSheet(month, currency);
        if (!sheet) continue;
        const excludeRowIndices = await getOccupiedExcelRows({
          invoiceMonth: month,
          accountCurrency: currency,
          excludeInvoiceId: id,
        });
        const candidate = findBestCandidate(
          { headers: sheet.headers, rows: sheet.rows },
          inv as Invoice,
          { excludeRowIndices },
        );
        if (candidate) {
          return NextResponse.json({
            ok: true,
            invoice: inv,
            outcome: {
              matchedExcelRow: null,
              nearMiss: {
                row: candidate.result.rowIndex + 2,
                currency,
                excelAmount: candidate.result.excelAmount,
                excelDate: candidate.result.excelDate,
                excelRowText: candidate.result.excelRowText ?? null,
                invoiceAmount: inv.amount,
                invoiceCurrency: inv.currency,
                invoiceDate: inv.invoiceDate,
                invoiceCreditor: inv.creditor,
                otherCandidates: [],
              },
              errors: [],
            },
          });
        }
      }
      return NextResponse.json({
        ok: true,
        invoice: inv,
        outcome: {
          matchedExcelRow: null,
          nearMiss: null,
          errors: ["Aucune ligne proche trouvée dans les sheets Excel."],
        },
      });
    }

    // Priorité : premier avec créditeur match statique.
    let picked = pool.find((p) =>
      creditorMatchesRow(inv.creditor, p.match.excelRowText ?? null),
    );
    if (!picked) picked = pool[0];

    const matchedRow = picked.match.rowIndex + 2;
    const others = pool
      .filter(
        (p) =>
          !(p.rowIndex === picked!.rowIndex && p.currency === picked!.currency),
      )
      .slice(0, 10)
      .map((p) => ({
        row: p.match.rowIndex + 2,
        currency: p.currency,
        excelAmount: p.match.excelAmount,
        excelDate: p.match.excelDate,
        excelRowText: p.match.excelRowText ?? null,
      }));

    // Update DB avec le row proposé (même en draft — auto-process fait pareil).
    await updateInvoice(id, {
      excelRowMatched: matchedRow,
      accountCurrency: picked.currency,
    });

    return NextResponse.json({
      ok: true,
      invoice: { ...inv, excelRowMatched: matchedRow, accountCurrency: picked.currency },
      outcome: {
        matchedExcelRow: matchedRow,
        nearMiss: {
          row: matchedRow,
          currency: picked.currency,
          excelAmount: picked.match.excelAmount,
          excelDate: picked.match.excelDate,
          excelRowText: picked.match.excelRowText ?? null,
          invoiceAmount: inv.amount,
          invoiceCurrency: inv.currency,
          invoiceDate: inv.invoiceDate,
          invoiceCreditor: inv.creditor,
          otherCandidates: others,
        },
        errors: [],
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "rematch_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
