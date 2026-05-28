import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import { parseEmpStatement } from "@/lib/parse-emp-statement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/revenues/parse-emp-statement
 *
 * Reçoit un PDF de billing statement EMP (multipart, clé "file"),
 * extrait le texte, parse les champs financiers et renvoie un objet
 * `ParsedEmpStatement` avec tout ce qui a été identifié.
 *
 * Le client (RevenueDetail) applique ensuite les valeurs sur le revenu
 * sélectionné, en proposant une preview avant validation.
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "no_file", message: "Pas de fichier reçu (clé 'file')." },
        { status: 400 },
      );
    }
    if (!/\.pdf$/i.test(file.name)) {
      return NextResponse.json(
        { error: "not_pdf", message: "Le fichier doit être un PDF." },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    // Copie défensive (unpdf détache l'ArrayBuffer sous-jacent).
    const uint8 = new Uint8Array(buffer.byteLength);
    uint8.set(buffer);

    let text = "";
    try {
      const doc = await getDocumentProxy(uint8);
      const result = await extractText(doc, { mergePages: true });
      text = result.text ?? "";
    } catch (e) {
      console.error("PDF extract failed", e);
      return NextResponse.json(
        {
          error: "pdf_unreadable",
          message: "PDF illisible (scanné ou corrompu ?). Essaie un autre fichier.",
        },
        { status: 422 },
      );
    }

    if (!text.trim()) {
      return NextResponse.json(
        {
          error: "empty_pdf",
          message: "PDF sans texte extractible (image scannée ?).",
        },
        { status: 422 },
      );
    }

    const parsed = parseEmpStatement(text);
    return NextResponse.json({
      ok: true,
      parsed,
      fileName: file.name,
      textPreview: text.slice(0, 500), // debug
    });
  } catch (e) {
    const err = e as Error;
    console.error("/api/revenues/parse-emp-statement crashed", err);
    return NextResponse.json(
      { error: "parse_failed", message: err.message },
      { status: 500 },
    );
  }
}
