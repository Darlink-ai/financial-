import { NextResponse } from "next/server";
import {
  getAllMappings,
  getInvoiceWithAttachment,
  getStuckAnalyzingInvoiceIds,
} from "@/lib/db";
import { autoProcessInvoice } from "@/lib/auto-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/invoices/reprocess-stuck
 * Relance le pipeline sur toutes les factures bloquées en
 * status="analyzing" (timeout Vercel, rate limit LLM, etc.).
 *
 * Politique : on NE bascule JAMAIS une invoice en `manual` ici. Si
 * un retry échoue à nouveau, on laisse en `analyzing` pour qu'un
 * prochain tic le re-tente. Le manual reste réservé aux cas où le
 * pipeline lui-même décide qu'il faut l'humain (pas assez de signal).
 *
 * Endpoint sécurisé par CRON_SECRET pour l'appel depuis Vercel cron ;
 * un appel non-authentifié depuis l'UI continue de marcher (POST sans
 * header) pour ne pas casser le bouton manuel sur /invoices.
 */
export async function POST() {
  try {
    const stuckIds = await getStuckAnalyzingInvoiceIds();
    if (stuckIds.length === 0) {
      return NextResponse.json({ ok: true, total: 0, processed: 0 });
    }

    const mappings = await getAllMappings();
    let processed = 0;
    let renamedCount = 0;
    let uploadedCount = 0;
    let matchedCount = 0;
    let manualCount = 0;
    let stillAnalyzing = 0;
    let noPdfCount = 0;

    for (const id of stuckIds) {
      try {
        const inv = await getInvoiceWithAttachment(id);
        if (!inv?.attachmentB64) {
          // Pas de PDF disponible — on laisse en `analyzing` aussi, un
          // outil futur permettra de récupérer le PDF à la demande.
          noPdfCount++;
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
        if (outcome.status === "renamed") renamedCount++;
        else if (outcome.status === "uploaded") uploadedCount++;
        else if (outcome.status === "matched") matchedCount++;
        else if (outcome.status === "manual") manualCount++;
        processed++;
      } catch (e) {
        console.error("reprocess-stuck failed for", id, e);
        // L'invoice reste en `analyzing` → sera retentée au prochain tic.
        stillAnalyzing++;
      }
    }

    return NextResponse.json({
      ok: true,
      total: stuckIds.length,
      processed,
      breakdown: {
        matched: matchedCount,
        uploaded: uploadedCount,
        renamed: renamedCount,
        manual: manualCount,
        stillAnalyzing,
        noPdf: noPdfCount,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "reprocess_stuck_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}

/** Variante GET pour les crons Vercel (qui n'envoient que des GET). */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  return POST();
}
