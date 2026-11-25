import { NextResponse } from "next/server";
import {
  findInvoicesMatchingRow,
  getDriveWithTokens,
  insertIncomingInvoice,
  updateInvoice,
} from "@/lib/db";
import { getDriveAccessToken } from "@/lib/upload-to-drive";
import { findFileByName, findFolder } from "@/lib/drive-api";
import type { AccountCurrency } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Item = {
  drivePath: string;
  row: number;
  currency: string;
  invoiceDate: string;
  amount: number | null;
  invoiceCurrency: string | null;
  creditor: string;
  folderCode: string;
  folderLabel: string;
  finalName: string;
};

/**
 * POST /api/admin/restore-from-drive   Auth : Bearer CRON_SECRET
 * Body : { items: Item[], dryRun?: boolean }
 *
 * Recrée des factures supprimées de la base à partir de leur PDF resté sur
 * Drive : le fichier est relu (pas renvoyé), la facture est remise validée
 * sur sa ligne avec le même drive_path. Une ligne déjà occupée est sautée.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { items?: Item[]; dryRun?: boolean };
  const items = Array.isArray(body.items) ? body.items : [];
  const dryRun = body.dryRun === true;

  const token = await getDriveAccessToken();
  const cfg = await getDriveWithTokens();
  if (!token || !cfg?.rootFolderId) {
    return NextResponse.json({ error: "drive_not_configured" }, { status: 503 });
  }

  const results: { finalName: string; outcome: string; id?: string }[] = [];
  for (const it of items) {
    try {
      const occupiers = await findInvoicesMatchingRow({
        excludeId: "",
        accountCurrency: it.currency,
        rowIndex: it.row,
        invoiceMonth: it.invoiceDate.slice(0, 7),
      });
      if (occupiers.length > 0) {
        results.push({
          finalName: it.finalName,
          outcome: `sautée : ligne ${it.row} déjà prise par ${occupiers[0].finalName ?? occupiers[0].id}`,
        });
        continue;
      }

      const parts = it.drivePath.split("/").filter(Boolean);
      const filename = parts.pop()!;
      if (parts[0] === cfg.rootFolderName) parts.shift();
      let parent = cfg.rootFolderId;
      let missing: string | null = null;
      for (const folder of parts) {
        const found = await findFolder(token, parent, folder);
        if (!found) {
          missing = folder;
          break;
        }
        parent = found.id;
      }
      const file = missing ? null : await findFileByName(token, parent, filename);
      if (!file) {
        results.push({
          finalName: it.finalName,
          outcome: missing ? `dossier Drive introuvable : ${missing}` : `fichier Drive introuvable`,
        });
        continue;
      }
      if (dryRun) {
        results.push({ finalName: it.finalName, outcome: "trouvé sur Drive (à blanc)" });
        continue;
      }

      const r = await fetch(
        `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!r.ok) {
        results.push({ finalName: it.finalName, outcome: `téléchargement Drive ${r.status}` });
        continue;
      }
      const bytes = Buffer.from(await r.arrayBuffer());

      const id = `inv-manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await insertIncomingInvoice({
        id,
        mailboxId: "manual",
        sourceMessageId: id,
        subject: filename,
        fromEmail: "manual@local",
        mailbox: "Ajout manuel",
        receivedAt: new Date().toISOString(),
        attachmentName: filename,
        attachmentBytes: bytes.length,
        attachmentB64: bytes.toString("base64"),
        accountCurrency: it.currency,
      });
      await updateInvoice(id, {
        creditor: it.creditor,
        invoiceDate: it.invoiceDate,
        amount: it.amount,
        currency: it.invoiceCurrency,
        folderCode: it.folderCode,
        folderLabel: it.folderLabel,
        finalName: it.finalName,
        drivePath: it.drivePath,
        accountCurrency: it.currency as AccountCurrency,
        excelRowMatched: it.row,
        status: "matched",
      });
      results.push({ finalName: it.finalName, outcome: "recréée et validée", id });
    } catch (e) {
      results.push({ finalName: it.finalName, outcome: `erreur : ${(e as Error).message}` });
    }
  }
  return NextResponse.json({ ok: true, dryRun, results });
}
