import { NextResponse } from "next/server";
import { updateInvoice } from "@/lib/db";
import { uploadMatchedInvoiceToDrive } from "@/lib/auto-process";
import type { AccountCurrency } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/invoices/:id/assign-row
 *
 * Match manuel d'une facture à une ligne Excel précise, déclenché par
 * le bouton "Valider" dans le bandeau "Factures sans ligne correspondante"
 * de /excel.
 *
 * Body : { rowNumber: number, accountCurrency: "USD" | "EUR" | "CHF" }
 *
 * Fait :
 *  1. Update DB : excelRowMatched, status=matched, accountCurrency
 *  2. Upload Drive (puisque la facture est maintenant rapprochée — règle
 *     "pas de match = pas de drive").
 *
 * Retourne le résultat de l'upload Drive pour info.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      rowNumber?: number;
      accountCurrency?: AccountCurrency;
    };
    const row = Number(body.rowNumber);
    if (!Number.isFinite(row) || row < 2) {
      return NextResponse.json(
        {
          error: "bad_row",
          message: "rowNumber doit être un entier ≥ 2 (ligne 1 = en-tête).",
        },
        { status: 400 },
      );
    }
    const currency =
      body.accountCurrency && ["USD", "EUR", "CHF"].includes(body.accountCurrency)
        ? body.accountCurrency
        : null;

    // 1. Update DB
    await updateInvoice(id, {
      excelRowMatched: row,
      status: "matched",
      ...(currency ? { accountCurrency: currency } : {}),
    });

    // 2. Upload Drive (règle : match → drive)
    const driveResult = await uploadMatchedInvoiceToDrive(id);

    return NextResponse.json({
      ok: true,
      drive: driveResult,
    });
  } catch (e) {
    const err = e as Error;
    console.error("/api/invoices/[id]/assign-row crashed", err);
    return NextResponse.json(
      { error: "assign_failed", message: err.message },
      { status: 500 },
    );
  }
}
