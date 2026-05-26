import { NextResponse } from "next/server";
import { getAllMappings, insertIncomingInvoice } from "@/lib/db";
import { autoProcessInvoice } from "@/lib/auto-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * POST /api/invoices/upload
 *
 * Upload manuel d'une facture PDF (file en multipart/form-data, clé "file").
 * Crée une row invoices avec une mailbox synthétique "manual" puis lance
 * le pipeline autoProcessInvoice complet (extraction → classification →
 * Drive → match Excel).
 *
 * Le client envoie 1 fichier par appel pour avoir un feedback progressif
 * et éviter les body size limits côté Vercel.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "no_file", message: "Aucun fichier reçu (clé multipart 'file' attendue)." },
        { status: 400 },
      );
    }
    if (!/\.pdf$/i.test(file.name)) {
      return NextResponse.json(
        {
          error: "not_pdf",
          message: `${file.name} : seuls les fichiers PDF sont acceptés.`,
        },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const invoiceId = `inv-manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const receivedAt = new Date().toISOString();

    await insertIncomingInvoice({
      id: invoiceId,
      mailboxId: "manual",
      sourceMessageId: invoiceId, // unique par construction
      subject: file.name,
      fromEmail: "ajout-manuel@factura",
      mailbox: "Ajout manuel",
      receivedAt,
      attachmentName: file.name,
      attachmentBytes: file.size,
      attachmentB64: base64,
    });

    const mappings = await getAllMappings();
    const outcome = await autoProcessInvoice({
      invoiceId,
      fromEmail: "ajout-manuel@factura",
      subject: file.name,
      receivedAt,
      pdfBase64: base64,
      mappings,
    });

    return NextResponse.json({
      ok: true,
      invoiceId,
      outcome,
      fileName: file.name,
    });
  } catch (e) {
    const err = e as Error;
    console.error("/api/invoices/upload crashed", err);
    return NextResponse.json(
      { error: "upload_failed", message: err.message },
      { status: 500 },
    );
  }
}
