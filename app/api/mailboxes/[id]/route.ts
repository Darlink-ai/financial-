import { NextResponse } from "next/server";
import { updateMailbox, deleteMailbox } from "@/lib/db";
import type { Mailbox } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as Partial<Mailbox>;
  const updated = await updateMailbox(id, body);
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await deleteMailbox(id);
  return NextResponse.json({ ok: true });
}
