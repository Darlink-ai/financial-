import { NextResponse } from "next/server";
import { getMailboxesForSync } from "@/lib/db";
import { getValidAccessToken } from "@/lib/sync-engine";
import { getMessage, header, listMessages, type GmailMessagePart } from "@/lib/gmail-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function decode(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function findBody(part: GmailMessagePart, mime: string): string | null {
  if (part.mimeType === mime && part.body?.data) return decode(part.body.data);
  for (const p of part.parts ?? []) {
    const found = findBody(p, mime);
    if (found) return found;
  }
  return null;
}

/**
 * POST /api/admin/gmail-messages   Auth : Bearer CRON_SECRET
 * Body : { email, query, max? }
 *
 * Lecture seule : renvoie les mails d'une boîte connectée qui répondent à
 * la recherche Gmail (spams compris, corbeille exclue), avec leurs en-têtes
 * et leur corps HTML d'origine. Sert à archiver en PDF les reçus envoyés
 * sans pièce jointe (ex. RunPod).
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { email?: string; query?: string; max?: number };
  if (!body.email || !body.query) {
    return NextResponse.json({ error: "bad_body", message: "email et query requis" }, { status: 400 });
  }
  const mailboxes = await getMailboxesForSync();
  const mb = mailboxes.find((m) => m.email.toLowerCase() === body.email!.toLowerCase());
  if (!mb) {
    return NextResponse.json({ error: "mailbox_not_found", available: mailboxes.map((m) => m.email) }, { status: 404 });
  }
  const token = await getValidAccessToken(mb);
  const ids = await listMessages(token, `${body.query} -in:trash`, Math.min(500, body.max ?? 5), true);
  const messages = [];
  for (const id of ids.slice(0, Math.min(500, body.max ?? 5))) {
    const msg = await getMessage(token, id);
    messages.push({
      id,
      mailboxId: mb.id,
      subject: header(msg, "Subject"),
      from: header(msg, "From"),
      to: header(msg, "To"),
      date: header(msg, "Date"),
      internalDate: new Date(Number(msg.internalDate)).toISOString(),
      html: findBody(msg.payload, "text/html"),
      text: findBody(msg.payload, "text/plain"),
    });
  }
  return NextResponse.json({ ok: true, mailbox: mb.email, count: ids.length, messages });
}
