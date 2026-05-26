import { NextResponse } from "next/server";
import { getDriveWithTokens } from "@/lib/db";
import { uploadInvoiceToDrive, getDriveAccessToken } from "@/lib/upload-to-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/drive/test-upload
 *
 * Crée un petit PDF de test dans Drive pour vérifier que la connexion
 * fonctionne et identifier précisément OÙ les fichiers atterrissent
 * (compte Google, dossier racine, etc.).
 */
export async function POST() {
  try {
    const cfg = await getDriveWithTokens();
    if (!cfg) {
      return NextResponse.json(
        { error: "drive_not_connected", message: "Drive n'est pas connecté." },
        { status: 400 },
      );
    }

    const token = await getDriveAccessToken();
    if (!token) {
      return NextResponse.json(
        { error: "no_token", message: "Impossible d'obtenir un access_token Drive." },
        { status: 500 },
      );
    }

    // Mini-PDF valide (minimal PDF 1.4 content)
    const minimalPdf = Buffer.from(
      "%PDF-1.4\n1 0 obj <</Type/Catalog/Pages 2 0 R>> endobj\n" +
        "2 0 obj <</Type/Pages/Kids[3 0 R]/Count 1>> endobj\n" +
        "3 0 obj <</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R>> endobj\n" +
        "4 0 obj <</Length 44>> stream\nBT /F1 12 Tf 100 700 Td (Test Factura) Tj ET\nendstream endobj\n" +
        "xref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000053 00000 n\n0000000100 00000 n\n0000000168 00000 n\n" +
        "trailer <</Size 5/Root 1 0 R>>\nstartxref\n250\n%%EOF",
      "utf-8",
    );

    const today = new Date().toISOString().slice(0, 10);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const result = await uploadInvoiceToDrive({
      pdfBuffer: minimalPdf,
      finalName: `Factura test - ${stamp}`,
      invoiceDateIso: today,
      folderCode: "TEST",
      folderLabel: "Test diagnostic",
    });

    return NextResponse.json({
      ok: true,
      driveFileId: result.driveFileId,
      drivePath: result.drivePath,
      webViewLink: result.webViewLink,
      rootFolderId: cfg.rootFolderId,
      rootFolderUrl: cfg.rootFolderId
        ? `https://drive.google.com/drive/folders/${cfg.rootFolderId}`
        : null,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "test_upload_failed",
        message: (e as Error).message,
        stack: (e as Error).stack?.split("\n").slice(0, 5).join("\n"),
      },
      { status: 500 },
    );
  }
}
