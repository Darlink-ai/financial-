import { NextResponse } from "next/server";
import {
  getAllMappings,
  getInvoiceWithAttachment,
  getManualInvoiceIds,
  resetInvoiceRetryCount,
} from "@/lib/db";
import { autoProcessInvoice } from "@/lib/auto-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/invoices/reprocess-manual
 *
 * Bulk : reset retry_count + relance autoProcess sur TOUTES les factures
 * status="manual". Utile après une migration appliquée tardivement ou
 * un nouveau mapping comptable — redonne sa chance au pipeline.
 */
export async function POST() {
  try {
    const ids = await getManualInvoiceIds();
    if (ids.length === 0) {
      return NextResponse.json({ ok: true, total: 0, processed: 0 });
    }

    const mappings = await getAllMappings();
    let processed = 0;
    let renamedCount = 0;
    let uploadedCount = 0;
    let matchedCount = 0;
    let stillManualCount = 0;
    let failedCount = 0;

    for (const id of ids) {
      try {
        const inv = await getInvoiceWithAttachment(id);
        if (!inv?.attachmentB64) {
          stillManualCount++;
          continue;
        }
        await resetInvoiceRetryCount(id).catch(() => {});
        const outcome = await autoProcessInvoice({
          invoiceId: id,
          fromEmail: inv.fromEmail,
          subject: inv.subject,
          receivedAt: inv.invoice.receivedAt,
          pdfBase64: inv.attachmentB64,
          mappings,
        });
        if (outcome.status === "renamed") renamedCount++;
        else if (outcome.status === "uploaded") uploadedCount++;
        else if (outcome.status === "matched") matchedCount++;
        else if (outcome.status === "manual") stillManualCount++;
        processed++;
      } catch (e) {
        console.error("reprocess-manual failed for", id, e);
        failedCount++;
      }
    }

    return NextResponse.json({
      ok: true,
      total: ids.length,
      processed,
      breakdown: {
        matched: matchedCount,
        uploaded: uploadedCount,
        renamed: renamedCount,
        stillManual: stillManualCount,
        failed: failedCount,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "reprocess_manual_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
