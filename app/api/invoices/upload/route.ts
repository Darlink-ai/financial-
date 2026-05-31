import { NextResponse } from "next/server";
import {
  getAllMappings,
  getInvoiceWithAttachment,
  insertIncomingInvoice,
} from "@/lib/db";
import { autoProcessInvoice } from "@/lib/auto-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * POST /api/invoices/upload
 *
 * Upload manuel d'une facture PDF (file en multipart/form-data, clé "file").
 * Crée une row invoices avec une mailbox synthétique "manual" puis lance
 * le pipeline autoProcessInvoice (extraction → classification → match Excel).
 *
 * Mode brouillon (form field `draft=1`) : skipDrive=true côté pipeline.
 *   - Le PDF est traité (extract + classify + match proposé), mais on n'écrit
 *     pas le match en DB et on ne pousse pas sur Drive.
 *   - L'invoice retournée a status="renamed" et excelRowMatched=null.
 *   - Le match proposé est dans outcome.matchedExcelRow → l'UI l'affiche
 *     en pré-remplissage de l'input "N° ligne". L'utilisateur valide
 *     via /api/invoices/[id]/assign-row qui déclenche le match + Drive.
 *
 * Mode immédiat (sans draft) : pipeline complet, status="matched" + Drive
 *   si un match est trouvé, sinon "renamed".
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const draftFlag = form.get("draft");
    const draft = draftFlag === "1" || draftFlag === "true";

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

    // IMPORTANT : pour les uploads manuels, on passe fromEmail="" et pas
    // un faux email type "ajout-manuel@factura". Sinon le code de
    // guessCreditorFromEmail tombe sur le domaine "factura" comme fallback
    // de créditeur quand l'extraction PDF rate, ce qui pollue le rename.
    // Avec "" → fallback ignoré, on garde seulement ce que le PDF contient
    // (ou null si rien trouvé, et l'utilisateur corrige sur /import).
    await insertIncomingInvoice({
      id: invoiceId,
      mailboxId: "manual",
      sourceMessageId: invoiceId, // unique par construction
      subject: file.name,
      fromEmail: "",
      mailbox: "Ajout manuel",
      receivedAt,
      attachmentName: file.name,
      attachmentBytes: file.size,
      attachmentB64: base64,
    });

    const mappings = await getAllMappings();
    const outcome = await autoProcessInvoice({
      invoiceId,
      fromEmail: "",
      subject: file.name,
      receivedAt,
      pdfBase64: base64,
      mappings,
      skipDrive: draft,
    });

    // Récupère l'invoice fraîche en DB pour la renvoyer au client
    // (creditor, amount, date, finalName, etc. — utiles pour la preview UI).
    const withAtt = await getInvoiceWithAttachment(invoiceId);
    const invoice = withAtt?.invoice ?? null;

    return NextResponse.json({
      ok: true,
      invoiceId,
      outcome,
      invoice,
      fileName: file.name,
      draft,
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
