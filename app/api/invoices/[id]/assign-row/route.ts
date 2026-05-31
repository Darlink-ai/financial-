import { NextResponse } from "next/server";
import {
  getAllMappings,
  saveCreditorClassification,
  updateInvoice,
} from "@/lib/db";
import { uploadMatchedInvoiceToDrive } from "@/lib/auto-process";
import { buildFinalName } from "@/lib/format";
import type { AccountCurrency, Invoice } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/invoices/:id/assign-row
 *
 * Match manuel d'une facture à une ligne Excel précise + upload Drive.
 * Utilisé par :
 *  - /excel "Valider" sur facture non rapprochée
 *  - /invoices "Valider" sur l'expansion de chaque facture
 *  - /import "Valider la facture" après review d'un draft
 *
 * Body :
 *  - rowNumber (obligatoire) : ligne Excel ≥ 2
 *  - accountCurrency (optionnel) : USD/EUR/CHF du compte bancaire
 *  - creditor (optionnel) : override du créditeur extrait
 *  - folderCode + folderLabel (optionnel) : override du dossier comptable
 *  - invoiceDate (optionnel) : override de la date (YYYY-MM-DD)
 *  - finalName (optionnel) : override du nom Drive final (sans .pdf)
 *
 * Si des overrides sont fournis :
 *  - Mise à jour de l'invoice avec les nouvelles valeurs
 *  - Si creditor + folderCode présents, on sauve aussi dans
 *    creditor_classifications pour que le prochain upload du même
 *    créditeur trouve directement (classifié "manual").
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
      creditor?: string;
      folderCode?: string;
      folderLabel?: string;
      invoiceDate?: string;
      finalName?: string;
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

    // ---- 1. Construit le patch facture, avec les overrides fournis. ----
    const patch: Partial<Invoice> = {
      excelRowMatched: row,
      status: "matched",
    };
    if (currency) patch.accountCurrency = currency;
    const creditor = body.creditor?.trim();
    const folderCode = body.folderCode?.trim();
    const folderLabel = body.folderLabel?.trim();
    const invoiceDate = body.invoiceDate?.trim();
    if (creditor) patch.creditor = creditor;
    if (folderCode) patch.folderCode = folderCode;
    if (folderLabel) patch.folderLabel = folderLabel;
    if (invoiceDate) patch.invoiceDate = invoiceDate;

    // finalName : soit l'override explicite, soit recalculé depuis les
    // overrides (date + creditor + folderCode).
    let finalName = body.finalName?.trim();
    if (!finalName && (creditor || folderCode || invoiceDate)) {
      // On a au moins un override mais pas de finalName → on tente de le
      // reconstruire. On a besoin de la valeur courante des champs non
      // overridés. updateInvoice fait un merge, mais on a besoin de
      // l'état actuel pour buildFinalName.
      // Simple : si tout est fourni dans le body, on calcule directement.
      if (creditor && folderCode && invoiceDate) {
        finalName = buildFinalName(invoiceDate, creditor, folderCode) ?? undefined;
      }
    }
    if (finalName) patch.finalName = finalName;

    await updateInvoice(id, patch);

    // ---- 2. Si on a creditor + folderCode, on sauve l'association dans
    //    le cache de classification → prochain upload du même créditeur =
    //    match instantané (pas besoin de LLM).
    if (creditor && folderCode) {
      try {
        const allMappings = await getAllMappings();
        const targetMapping = allMappings.find(
          (m) => m.folderCode === folderCode,
        );
        if (targetMapping) {
          await saveCreditorClassification({
            creditor,
            mappingId: targetMapping.id,
            classifiedBy: "manual",
          });
        }
      } catch (e) {
        // Pas bloquant — l'upload Drive doit fonctionner même si le cache
        // est down (migration pas appliquée par ex.).
        console.warn(
          "[assign-row] save creditor_classifications failed",
          (e as Error).message,
        );
      }
    }

    // ---- 3. Upload Drive (règle métier : match → drive). ----
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
