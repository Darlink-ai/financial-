import { NextResponse } from "next/server";
import postgres from "postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint de diagnostic : retourne les colonnes effectivement présentes
// sur la table mailboxes. Permet de vérifier si une migration manque.
export async function GET() {
  const connectionString =
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL ??
    "postgres://postgres:postgres@127.0.0.1:54322/postgres";
  const sql = postgres(connectionString, {
    max: 2,
    prepare: false,
    ssl: connectionString.includes("127.0.0.1") || connectionString.includes("localhost")
      ? false
      : "require",
  });
  try {
    const cols = await sql<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'mailboxes'
      ORDER BY ordinal_position
    `;
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    const requiredMailboxCols = [
      "id",
      "email",
      "provider",
      "connected",
      "invoices_found",
      "last_sync",
      "oauth_client_id",
      "oauth_client_secret",
      "oauth_refresh_token",
      "oauth_access_token",
      "oauth_expires_at",
      "oauth_scope",
      "oauth_user_email",
    ];
    const presentCols = cols.map((c) => c.column_name);
    const missing = requiredMailboxCols.filter(
      (c) => !presentCols.includes(c),
    );
    return NextResponse.json({
      tables: tables.map((t) => t.table_name),
      mailboxes_columns: cols,
      missing_columns_on_mailboxes: missing,
      ok: missing.length === 0,
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 500 },
    );
  } finally {
    await sql.end({ timeout: 1 });
  }
}
