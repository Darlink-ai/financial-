import { NextResponse } from "next/server";
import {
  getAllMappings,
  getInvoiceWithAttachment,
  getStuckAnalyzingInvoiceIds,
  updateInvoice,
} from "@/lib/db";
import { autoProcessInvoice } from "@/lib/auto-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/invoices/reprocess-stuck
 * Récupère toutes les factures qui sont restées en status="analyzing"
 * (typiquement après un timeout Vercel mid-sync) et relance le pipeline
 * sur chacune. Renvoie un résumé.
 */
export async function POST() {
  try {
    const stuckIds = await getStuckAnalyzingInvoiceIds();
    if (stuckIds.length === 0) {
      return NextResponse.json({ ok: true, total: 0, processed: 0 });
    }

    const mappings = await getAllMappings();
    let processed = 0;
    let manualCount = 0;
    let renamedCount = 0;
    let uploadedCount = 0;
    let matchedCount = 0;
    let failedCount = 0;

    for (const id of stuckIds) {
      try {
        const inv = await getInvoiceWithAttachment(id);
        if (!inv?.attachmentB64) {
          // Pas de PDF → on bascule en manual pour le sortir de l'état figé.
          await updateInvoice(id, { status: "manual" });
          manualCount++;
          processed++;
          continue;
        }
        const outcome = await autoProcessInvoice({
          invoiceId: id,
          fromEmail: inv.fromEmail,
          subject: inv.subject,
          receivedAt: inv.invoice.receivedAt,
          pdfBase64: inv.attachmentB64,
          mappings,
        });
        if (outcome.status === "manual") manualCount++;
        else if (outcome.status === "renamed") renamedCount++;
        else if (outcome.status === "uploaded") uploadedCount++;
        else if (outcome.status === "matched") matchedCount++;
        processed++;
      } catch (e) {
        console.error("reprocess-stuck failed for", id, e);
        failedCount++;
      }
    }

    return NextResponse.json({
      ok: true,
      total: stuckIds.length,
      processed,
      breakdown: {
        manual: manualCount,
        renamed: renamedCount,
        uploaded: uploadedCount,
        matched: matchedCount,
        failed: failedCount,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "reprocess_stuck_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
