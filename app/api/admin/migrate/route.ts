import { NextResponse } from "next/server";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/admin/migrate
 * Auth: Bearer CRON_SECRET
 *
 * Applique les migrations idempotentes nécessaires au bon fonctionnement
 * de l'app (tables créées à la volée côté app). Appelé manuellement
 * après un déploiement — à chaque nouvelle migration on étend la liste.
 */
const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS row_assignments (
     month            TEXT        NOT NULL,
     account_currency TEXT        NOT NULL,
     row_number       INT         NOT NULL,
     assignee         TEXT        NOT NULL,
     creditor_key     TEXT,
     assigned_by      TEXT,
     assigned_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
     auto_cascaded    BOOLEAN     NOT NULL DEFAULT FALSE,
     PRIMARY KEY (month, account_currency, row_number)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_row_assignments_assignee
     ON row_assignments (assignee)`,
  `CREATE INDEX IF NOT EXISTS idx_row_assignments_creditor_key
     ON row_assignments (creditor_key)
     WHERE creditor_key IS NOT NULL`,
];

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sql = postgres(
    process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "postgres://localhost/postgres",
    { prepare: false, max: 1 },
  );
  const applied: string[] = [];
  try {
    for (const stmt of STATEMENTS) {
      await sql.unsafe(stmt);
      applied.push(stmt.split("\n")[0].trim().slice(0, 80));
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: "migration_failed",
        message: (e as Error).message,
        applied,
      },
      { status: 500 },
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
  return NextResponse.json({ ok: true, applied });
}
