import { NextResponse } from "next/server";
import {
  countManualDraftInvoices,
  deleteManualDraftInvoices,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/invoices/bulk-manual-drafts
 * Renvoie le nombre de brouillons "Ajout manuel" actuellement éligibles
 * à un bulk-delete. Utilisé par l'UI pour afficher un compteur dans la
 * confirmation avant déclenchement.
 */
export async function GET() {
  try {
    const count = await countManualDraftInvoices();
    return NextResponse.json({ ok: true, count });
  } catch (e) {
    return NextResponse.json(
      { error: "db_error", message: (e as Error).message },
      { status: 503 },
    );
  }
}

/**
 * DELETE /api/invoices/bulk-manual-drafts
 *
 * Supprime UNIQUEMENT les brouillons saisis via "Ajout manuel" qui sont
 * encore en status renamed/manual (= non rapprochés). Filtre strict et
 * explicite sur mailbox = 'Ajout manuel' côté SQL — aucun autre statut,
 * aucune autre boîte mail (Gmail-synced ou autre) n'est touché.
 *
 * Renvoie le nombre exact de lignes effacées + leurs IDs pour audit.
 */
export async function DELETE() {
  try {
    const { count, ids } = await deleteManualDraftInvoices();
    return NextResponse.json({ ok: true, deleted: count, ids });
  } catch (e) {
    return NextResponse.json(
      { error: "db_error", message: (e as Error).message },
      { status: 503 },
    );
  }
}
