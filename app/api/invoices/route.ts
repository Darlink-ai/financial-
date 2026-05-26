import { NextResponse } from "next/server";
import { deleteAllInvoices } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * DELETE /api/invoices
 * Supprime TOUTES les factures (tous statuts, tous mois). Ne touche
 * pas aux mailboxes / mappings / Drive / revenues — utile pour repartir
 * sur du propre quand on a des mocks à nettoyer.
 */
export async function DELETE() {
  try {
    const deleted = await deleteAllInvoices();
    return NextResponse.json({ ok: true, deleted });
  } catch (e) {
    return NextResponse.json(
      { error: "db_error", message: (e as Error).message },
      { status: 503 },
    );
  }
}
