import { NextResponse } from "next/server";
import postgres from "postgres";
import { getDriveAccessToken } from "@/lib/upload-to-drive";
import { getDriveWithTokens } from "@/lib/db";
import { deleteDriveFile, findFileByName, findFolder } from "@/lib/drive-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/admin/purge-sync   Auth : Bearer CRON_SECRET
 * Body : { since: ISO, until?: ISO, dryRun?: boolean (défaut true) }
 *
 * Retire tout ce qu'une synchro des boîtes mail a importé entre `since` et
 * `until` : les factures venues d'une boîte (pas les ajouts manuels), dont
 * l'id `inv-<ms>-…` porte l'heure d'import. Les fichiers déjà envoyés sur
 * Drive sont supprimés aussi. Sans dryRun:false, ne fait que lister.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    since?: string;
    until?: string;
    dryRun?: boolean;
  };
  const since = body.since ? new Date(body.since) : null;
  const until = body.until ? new Date(body.until) : new Date("2999-01-01");
  if (!since || Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    return NextResponse.json({ error: "bad_body", message: "since (ISO) requis" }, { status: 400 });
  }
  const dryRun = body.dryRun !== false;

  const sql = postgres(
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "postgres://localhost/postgres",
    { max: 1, prepare: false, ssl: "require" },
  );
  try {
    const runs = await sql<
      { id: string; trigger: string; started_at: Date; finished_at: Date | null; total_added: number | null }[]
    >`
      SELECT id, trigger, started_at, finished_at, total_added
      FROM sync_runs
      WHERE started_at >= ${since.toISOString()}::timestamptz - interval '1 day'
      ORDER BY started_at
    `.catch(async () =>
      sql<{ id: string; trigger: string; started_at: Date; finished_at: Date | null; total_added: number | null }[]>`
        SELECT id, trigger, started_at, NULL::timestamptz AS finished_at, NULL::int AS total_added
        FROM sync_runs
        WHERE started_at >= ${since.toISOString()}::timestamptz - interval '1 day'
        ORDER BY started_at
      `,
    );

    const invoices = await sql<
      { id: string; status: string; drive_path: string | null; mailbox: string; creditor: string | null; received_at: Date | null; excel_row_matched: number | null }[]
    >`
      SELECT id, status, drive_path, mailbox, creditor, received_at, excel_row_matched
      FROM invoices
      WHERE mailbox_id <> 'manual'
        AND id ~ '^inv-[0-9]{13}-'
        AND to_timestamp(split_part(id, '-', 2)::bigint / 1000.0)
            BETWEEN ${since.toISOString()}::timestamptz AND ${until.toISOString()}::timestamptz
      ORDER BY id
    `;

    const byStatus: Record<string, number> = {};
    for (const i of invoices) byStatus[i.status] = (byStatus[i.status] ?? 0) + 1;
    const byMailbox: Record<string, number> = {};
    for (const i of invoices) byMailbox[i.mailbox] = (byMailbox[i.mailbox] ?? 0) + 1;
    const onDrive = invoices.filter((i) => i.drive_path);

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        runs: runs.map((r) => ({
          id: r.id,
          trigger: r.trigger,
          started: r.started_at.toISOString(),
          finished: r.finished_at?.toISOString() ?? null,
          added: r.total_added,
        })),
        count: invoices.length,
        byStatus,
        byMailbox,
        onDrive: onDrive.map((i) => i.drive_path),
        matched: invoices
          .filter((i) => i.excel_row_matched != null)
          .map((i) => `${i.creditor} → ligne ${i.excel_row_matched}`),
        // Dates des mails importés : la période réellement couverte.
        receivedRange: (() => {
          const ds = invoices
            .map((i) => i.received_at?.toISOString().slice(0, 10))
            .filter((x): x is string => !!x)
            .sort();
          return ds.length ? { first: ds[0], last: ds[ds.length - 1] } : null;
        })(),
        creditors: Object.entries(
          invoices.reduce<Record<string, number>>((acc, i) => {
            const k = (i.creditor ?? "?").trim();
            acc[k] = (acc[k] ?? 0) + 1;
            return acc;
          }, {}),
        ).sort((x, y) => y[1] - x[1]),
        first: invoices[0]?.id ?? null,
        last: invoices[invoices.length - 1]?.id ?? null,
      });
    }

    // Fichiers Drive d'abord, puis les factures.
    const driveResults: string[] = [];
    if (onDrive.length > 0) {
      const token = await getDriveAccessToken();
      const cfg = await getDriveWithTokens();
      for (const inv of onDrive) {
        try {
          if (!token || !cfg?.rootFolderId) {
            driveResults.push(`skip (Drive non configuré) ${inv.drive_path}`);
            continue;
          }
          const parts = inv.drive_path!.split("/").filter(Boolean);
          const filename = parts.pop()!;
          if (parts[0] === cfg.rootFolderName) parts.shift();
          let parent = cfg.rootFolderId;
          let missing = false;
          for (const folder of parts) {
            const found = await findFolder(token, parent, folder);
            if (!found) {
              missing = true;
              break;
            }
            parent = found.id;
          }
          const file = missing ? null : await findFileByName(token, parent, filename);
          if (file) {
            await deleteDriveFile(token, file.id);
            driveResults.push(`supprimé ${inv.drive_path}`);
          } else {
            driveResults.push(`introuvable ${inv.drive_path}`);
          }
        } catch (e) {
          driveResults.push(`erreur ${inv.drive_path} : ${(e as Error).message}`);
        }
      }
    }

    const ids = invoices.map((i) => i.id);
    let deleted = 0;
    for (let k = 0; k < ids.length; k += 500) {
      const chunk = ids.slice(k, k + 500);
      const res = await sql`DELETE FROM invoices WHERE id = ANY(${chunk})`;
      deleted += res.count;
    }
    return NextResponse.json({ dryRun: false, deleted, byMailbox, drive: driveResults });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
