import { NextResponse } from "next/server";
import { clearMailboxOAuth } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json()) as { mailboxId?: string };
  if (!body.mailboxId) {
    return NextResponse.json({ error: "missing_mailboxId" }, { status: 400 });
  }
  await clearMailboxOAuth(body.mailboxId);
  return NextResponse.json({ ok: true });
}
