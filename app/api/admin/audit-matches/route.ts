import { NextResponse } from "next/server";
import postgres from "postgres";
import { getExcelSheet } from "@/lib/db";
import { creditorMatchesRow } from "@/lib/creditor-aliases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/admin/audit-matches   Auth : Bearer CRON_SECRET
 * Body : { startMonth, endMonth, createdSince?: ISO, fix?: boolean }
 *
 * Contrôle les factures validées : le fournisseur de la facture se
 * retrouve-t-il dans le texte de sa ligne de relevé ? Liste celles qui ne
 * collent pas. Avec fix:true, dévalide UNIQUEMENT celles venues d'une boîte
 * mail (jamais les ajouts manuels) ; le fichier Drive reste en place.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    startMonth?: string;
    endMonth?: string;
    createdSince?: string;
    fix?: boolean;
  };
  if (!body.startMonth || !body.endMonth) {
    return NextResponse.json({ error: "bad_body", message: "startMonth et endMonth requis" }, { status: 400 });
  }
  const since = body.createdSince ? new Date(body.createdSince) : null;

  const sql = postgres(
    process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "postgres://localhost/postgres",
    { max: 1, prepare: false, ssl: "require" },
  );
  try {
    const rows = await sql<
      { id: string; creditor: string | null; final_name: string | null; mailbox: string; mailbox_id: string | null;
        account_currency: string; excel_row_matched: number; month: string; drive_path: string | null; amount: string | null; currency: string | null }[]
    >`
      SELECT id, creditor, final_name, mailbox, mailbox_id, account_currency, excel_row_matched,
             to_char(invoice_date, 'YYYY-MM') AS month, drive_path, amount, currency
      FROM invoices
      WHERE status = 'matched'
        AND excel_row_matched IS NOT NULL
        AND invoice_date IS NOT NULL
        AND to_char(invoice_date, 'YYYY-MM') BETWEEN ${body.startMonth} AND ${body.endMonth}
    `;
    const createdAt = (id: string) => {
      const ms = id.split("-").find((x) => /^\d{13}$/.test(x));
      return ms ? new Date(Number(ms)) : null;
    };
    const scoped = rows.filter((r) => !since || ((createdAt(r.id)?.getTime() ?? 0) >= since.getTime()));

    const cache = new Map<string, Awaited<ReturnType<typeof getExcelSheet>>>();
    const bad: {
      id: string; source: string; creditor: string | null; finalName: string | null;
      month: string; currency: string; row: number; rowText: string; amount: string | null;
    }[] = [];
    for (const r of scoped) {
      const k = `${r.month}|${r.account_currency}`;
      if (!cache.has(k)) cache.set(k, await getExcelSheet(r.month, r.account_currency));
      const sheet = cache.get(k);
      const row = sheet?.rows[r.excel_row_matched - 2];
      const rowText = row ? row.filter((c) => typeof c === "string").join(" ") : "";
      if (row && creditorMatchesRow(r.creditor, rowText)) continue;
      bad.push({
        id: r.id,
        source: r.mailbox === "Ajout manuel" ? "manuel" : "mail",
        creditor: r.creditor,
        finalName: r.final_name,
        month: r.month,
        currency: r.account_currency,
        row: r.excel_row_matched,
        rowText: rowText.split(";")[0].slice(0, 60) || "(ligne absente du relevé)",
        amount: r.amount ? `${r.amount} ${r.currency ?? ""}`.trim() : null,
      });
    }

    let unmatched = 0;
    if (body.fix) {
      const fromMail = bad.filter((b) => b.source === "mail").map((b) => b.id);
      for (let i = 0; i < fromMail.length; i += 500) {
        const chunk = fromMail.slice(i, i + 500);
        const res = await sql`
          UPDATE invoices
          SET excel_row_matched = NULL,
              status = CASE WHEN drive_path IS NOT NULL THEN 'uploaded' ELSE 'renamed' END
          WHERE id = ANY(${chunk}) AND status = 'matched'
        `;
        unmatched += res.count;
      }
    }

    return NextResponse.json({
      ok: true,
      checked: scoped.length,
      mismatched: bad.length,
      bySource: bad.reduce<Record<string, number>>((a, b) => ((a[b.source] = (a[b.source] ?? 0) + 1), a), {}),
      unmatched,
      items: bad,
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}
