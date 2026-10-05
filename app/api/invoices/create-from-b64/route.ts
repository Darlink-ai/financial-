import { NextResponse } from "next/server";
import { insertIncomingInvoice } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/invoices/create-from-b64
 * Body: { fileName, fileB64, mailbox?, accountCurrency? }
 * Auth: Bearer CRON_SECRET
 *
 * Crée une invoice avec le PDF base64 fourni, status='renamed' par défaut.
 * Retourne l'id généré. Permet d'ensuite call /force-match pour la
 * valider + classer + uploader Drive, le tout en Bearer sans besoin de
 * passer par /import.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    fileName?: string;
    fileB64?: string;
    mailbox?: string;
    accountCurrency?: string;
  };
  if (!body.fileName || !body.fileB64) {
    return NextResponse.json(
      { error: "missing", message: "fileName + fileB64 requis" },
      { status: 400 },
    );
  }

  const id = `inv-manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const bytes = Buffer.from(body.fileB64, "base64").length;

  await insertIncomingInvoice({
    id,
    mailboxId: "manual",
    sourceMessageId: id,
    subject: body.fileName,
    fromEmail: "manual@local",
    mailbox: body.mailbox ?? "Ajout manuel",
    receivedAt: new Date().toISOString(),
    attachmentName: body.fileName,
    attachmentBytes: bytes,
    attachmentB64: body.fileB64,
    accountCurrency: body.accountCurrency,
  });

  return NextResponse.json({ ok: true, id, bytes });
}
