import { NextResponse } from "next/server";
import { getAllMappings, getInvoiceWithAttachment } from "@/lib/db";
import { autoProcessInvoice } from "@/lib/auto-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/invoices/[id]/reprocess
 * Relance le pipeline complet (extract → classify → Drive → Excel)
 * sur une facture existante. Utile quand on a corrigé un mapping,
 * uploadé un fichier Excel, ou branché Drive après l'arrivée du PDF.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const row = await getInvoiceWithAttachment(id);
    if (!row) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (!row.attachmentB64) {
      return NextResponse.json(
        { error: "no_attachment", message: "Pas de PDF associé à cette facture." },
        { status: 400 },
      );
    }

    const mappings = await getAllMappings();
    const outcome = await autoProcessInvoice({
      invoiceId: id,
      fromEmail: row.fromEmail,
      subject: row.subject,
      receivedAt: row.invoice.receivedAt,
      pdfBase64: row.attachmentB64,
      mappings,
    });

    return NextResponse.json({ ok: true, outcome });
  } catch (e) {
    const err = e as Error;
    console.error("reprocess failed", id, err);
    return NextResponse.json(
      { error: "reprocess_failed", message: err.message },
      { status: 500 },
    );
  }
}
