import { NextResponse } from "next/server";
import postgres from "postgres";
import { getDriveWithTokens, getInvoiceWithAttachment } from "@/lib/db";
import { getDriveAccessToken } from "@/lib/upload-to-drive";
import { deleteDriveFile, findFileByName, findFolder } from "@/lib/drive-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/invoices/unvalidate
 * Body : { id: string }
 * OU   : { month: "YYYY-MM", currency: "EUR|CHF|USD", row: 81 }
 *
 * Dévalide une facture :
 *   1. Supprime le PDF sur Drive (si drive_path)
 *   2. status='matched' → 'renamed', clear excel_row_matched + drive_path
 *
 * L'invoice reste en DB. Auth : Bearer CRON_SECRET.
 */
export async function POST(req: Request) {
  try {
    const auth = req.headers.get("authorization") ?? "";
    const secret = process.env.CRON_SECRET;
    if (!secret || auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as {
      id?: string;
      month?: string;
      currency?: string;
      row?: number;
    };

    // Résolution de l'id : soit fourni, soit lookup (month + currency + row).
    let invoiceId = body.id;
    if (!invoiceId && body.month && body.currency && body.row) {
      const sql = postgres(
        process.env.DATABASE_URL ??
          process.env.POSTGRES_URL ??
          "postgres://localhost/postgres",
        { max: 1, prepare: false, ssl: "require" },
      );
      try {
        const rows = await sql<{ id: string }[]>`
          SELECT id FROM invoices
          WHERE excel_row_matched = ${body.row}
            AND account_currency = ${body.currency}
            AND invoice_date IS NOT NULL
            AND to_char(invoice_date, 'YYYY-MM') = ${body.month}
            AND status = 'matched'
          LIMIT 1
        `;
        invoiceId = rows[0]?.id;
      } finally {
        await sql.end();
      }
    }
    if (!invoiceId) {
      return NextResponse.json(
        { error: "not_found", message: "Aucune invoice trouvée." },
        { status: 404 },
      );
    }

    const record = await getInvoiceWithAttachment(invoiceId);
    if (!record) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const inv = record.invoice;
    let driveDeleted = false;
    let driveMessage: string | null = null;

    if (inv.drivePath) {
      try {
        const token = await getDriveAccessToken();
        const cfg = await getDriveWithTokens();
        if (!token || !cfg) {
          driveMessage = "Drive non configuré (skip suppression)";
        } else {
          // drive_path = "/Comptabilité/02_Février/28.02.26 - Vendor - 6400.pdf"
          // On skip le 1er segment (nom root — utilisé pour display) et
          // on part du rootFolderId stocké en DB (peut être un shared drive
          // ou un dossier custom). Sinon findFolder("root", "Comptabilité")
          // échoue quand l'utilisateur a un rootFolder ailleurs.
          const parts = inv.drivePath.split("/").filter(Boolean);
          const filename = parts.pop();
          // Retire le 1er segment (rootFolderName) pour ne garder que les
          // sous-dossiers ; on descend depuis rootFolderId.
          if (parts[0] === cfg.rootFolderName) parts.shift();
          if (!filename) {
            driveMessage = "drive_path invalide";
          } else if (!cfg.rootFolderId) {
            driveMessage = "root_folder_id Drive non configuré";
          } else {
            let currentParent = cfg.rootFolderId;
            for (const folder of parts) {
              const found = await findFolder(token, currentParent, folder);
              if (!found) {
                driveMessage = `dossier "${folder}" introuvable sous rootFolderId ${cfg.rootFolderId}`;
                break;
              }
              currentParent = found.id;
            }
            if (!driveMessage) {
              const file = await findFileByName(token, currentParent, filename);
              if (!file) {
                driveMessage = `fichier "${filename}" introuvable dans Drive`;
              } else {
                await deleteDriveFile(token, file.id);
                driveDeleted = true;
                driveMessage = `fichier "${filename}" supprimé de Drive`;
              }
            }
          }
        }
      } catch (e) {
        driveMessage = `erreur Drive : ${(e as Error).message}`;
      }
    } else {
      driveMessage = "pas de drive_path (rien à supprimer sur Drive)";
    }

    // Unmatch en DB.
    const sql = postgres(
      process.env.DATABASE_URL ??
        process.env.POSTGRES_URL ??
        "postgres://localhost/postgres",
      { max: 1, prepare: false, ssl: "require" },
    );
    try {
      await sql`
        UPDATE invoices
        SET status = 'renamed', excel_row_matched = NULL, drive_path = NULL
        WHERE id = ${invoiceId}
      `;
    } finally {
      await sql.end();
    }

    return NextResponse.json({
      ok: true,
      invoiceId,
      creditor: inv.creditor,
      amount: inv.amount,
      previousRow: inv.excelRowMatched,
      previousDrivePath: inv.drivePath,
      driveDeleted,
      driveMessage,
    });
  } catch (e) {
    return NextResponse.json(
      { error: "unvalidate_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
