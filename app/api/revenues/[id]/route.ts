import { NextResponse } from "next/server";
import { updateRevenue, deleteRevenue } from "@/lib/db";
import type { Revenue } from "@/lib/types";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as Partial<Revenue>;
  const updated = await updateRevenue(id, body);
  if (!updated) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await deleteRevenue(id);
  return NextResponse.json({ ok: true });
}
