import { NextResponse } from "next/server";
import {
  updateMailbox,
  deleteMailbox,
  setMailboxOAuthCredentials,
} from "@/lib/db";
import type { Mailbox } from "@/lib/types";

export const runtime = "nodejs";

type PatchBody = Partial<Mailbox> & {
  oauthClientId?: string | null;
  oauthClientSecret?: string | null; // si présent et non vide → remplace
};

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as PatchBody;

  // OAuth credentials gérés à part (jamais via mapMailbox, le secret est privé)
  const hasClientId = Object.prototype.hasOwnProperty.call(body, "oauthClientId");
  const hasClientSecret =
    Object.prototype.hasOwnProperty.call(body, "oauthClientSecret") &&
    typeof body.oauthClientSecret === "string" &&
    body.oauthClientSecret.length > 0;
  if (hasClientId || hasClientSecret) {
    await setMailboxOAuthCredentials(
      id,
      hasClientId ? body.oauthClientId ?? null : null,
      hasClientSecret ? (body.oauthClientSecret as string) : null,
    );
  }

  // Le reste (email, provider…) via updateMailbox standard
  const { oauthClientId, oauthClientSecret, ...mailboxPatch } = body;
  void oauthClientId;
  void oauthClientSecret;

  if (Object.keys(mailboxPatch).length > 0) {
    const updated = await updateMailbox(id, mailboxPatch as Partial<Mailbox>);
    if (!updated)
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(updated);
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await deleteMailbox(id);
  return NextResponse.json({ ok: true });
}
