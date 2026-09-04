import { NextResponse } from "next/server";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/invoices/unarchive
 * Body: { id: string } | { ids: string[] }
 * Auth: Bearer CRON_SECRET OU cookie Supabase (bouton UI).
 *
 * Repasse une (ou plusieurs) facture(s) archivée(s) en status='renamed'
 * pour la remettre dans la vue "à traiter".
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  const bearerOk = secret && auth === `Bearer ${secret}`;
  // cookie Supabase déjà validé par le middleware si on arrive ici sans Bearer
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    ids?: string[];
  };
  const ids = body.ids ?? (body.id ? [body.id] : []);
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "missing", message: "id ou ids requis." },
      { status: 400 },
    );
  }
  if (!bearerOk) {
    // Middleware auth doit être passée. On accepte donc — sinon on
    // aurait déjà été rejeté.
  }

  const sql = postgres(
    process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "postgres://localhost/postgres",
    { max: 1, prepare: false, ssl: "require" },
  );
  try {
    const rows = await sql<{ id: string }[]>`
      UPDATE invoices
      SET status = 'renamed'
      WHERE id IN ${sql(ids)}
        AND status = 'archived'
      RETURNING id
    `;
    return NextResponse.json({ ok: true, count: rows.length });
  } finally {
    await sql.end();
  }
}
