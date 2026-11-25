import { NextResponse } from "next/server";
import { deleteInvoice, getInvoiceStatus, updateInvoice } from "@/lib/db";
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

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  // Une facture rapprochée d'une ligne ne se supprime pas d'un clic : une
  // page restée ouverte peut encore l'afficher comme brouillon. On la
  // dévalide d'abord (ou ?force=1 pour un usage d'administration).
  if (new URL(req.url).searchParams.get("force") !== "1") {
    const status = await getInvoiceStatus(id);
    if (status === "matched") {
      return NextResponse.json(
        {
          error: "matched",
          message: "Facture déjà rapprochée d'une ligne du relevé : elle n'a pas été supprimée.",
        },
        { status: 409 },
      );
    }
  }
  const ok = await deleteInvoice(id);
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
