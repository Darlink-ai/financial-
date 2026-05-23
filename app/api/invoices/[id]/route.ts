import { NextResponse } from "next/server";
import { updateInvoice } from "@/lib/db";
import type { Invoice } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as Partial<Invoice>;
  const updated = await updateInvoice(id, body);
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(updated);
}
