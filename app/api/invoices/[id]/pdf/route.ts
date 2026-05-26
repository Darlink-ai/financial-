import { getInvoiceWithAttachment } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sert le PDF d'une facture inline pour aperçu navigateur.
 * Le PDF est stocké en base64 dans la colonne attachment_b64 — on le
 * décode et on le renvoie avec Content-Type: application/pdf.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const row = await getInvoiceWithAttachment(id);
    if (!row) {
      return new Response("not found", { status: 404 });
    }
    if (!row.attachmentB64) {
      return new Response("no attachment", { status: 404 });
    }
    const buffer = Buffer.from(row.attachmentB64, "base64");
    const filename =
      row.invoice.attachment?.name ?? `${row.invoice.id}.pdf`;
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    return new Response(`error: ${(e as Error).message}`, { status: 500 });
  }
}
