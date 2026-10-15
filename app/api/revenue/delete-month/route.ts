import { NextResponse } from "next/server";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/revenue/delete-month
 * Body: { month: "YYYY-MM", dryRun?: boolean }
 * Auth: Bearer CRON_SECRET
 *
 * dryRun=true (défaut) : LISTE les revenus du mois sans supprimer.
 * dryRun=false         : SUPPRIME tous les revenus du mois.
 *
 * Toujours safe : on retourne la liste des IDs touchés.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    month?: string;
    dryRun?: boolean;
  };
  if (!body.month || !/^\d{4}-\d{2}$/.test(body.month)) {
    return NextResponse.json(
      { error: "bad_params", message: "month YYYY-MM requis" },
      { status: 400 },
    );
  }
  const dryRun = body.dryRun !== false; // défaut true

  const sql = postgres(
    process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "postgres://localhost/postgres",
    { max: 1, prepare: false, ssl: "require" },
  );
  try {
    const rows = await sql<{
      id: string;
      business_id: string;
      processor: string;
      currency: string;
      captured_amount: string;
    }[]>`
      SELECT id, business_id, processor, currency, captured_amount
      FROM revenues
      WHERE month = ${body.month}
      ORDER BY business_id, processor
    `;
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        month: body.month,
        count: rows.length,
        wouldDelete: rows.map((r) => ({
          id: r.id,
          businessId: r.business_id,
          processor: r.processor,
          currency: r.currency,
          capturedAmount: Number(r.captured_amount),
        })),
      });
    }
    // Suppression
    const deleted = await sql<{ id: string }[]>`
      DELETE FROM revenues
      WHERE month = ${body.month}
      RETURNING id
    `;
    return NextResponse.json({
      ok: true,
      dryRun: false,
      month: body.month,
      count: deleted.length,
      deletedIds: deleted.map((r) => r.id),
    });
  } finally {
    await sql.end();
  }
}
