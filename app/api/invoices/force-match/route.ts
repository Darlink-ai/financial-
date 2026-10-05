import { NextResponse } from "next/server";
import postgres from "postgres";
import { uploadMatchedInvoiceToDrive } from "@/lib/auto-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/invoices/force-match
 * Body: {
 *   id,
 *   row,
 *   currency,
 *   month?,            // force invoice_date dans ce mois (jour preservé)
 *   invoiceDate?,      // force la date complete YYYY-MM-DD (override month)
 *   amount?,           // montant HT/TTC a saisir sur la facture
 *   invoiceCurrency?,  // devise du montant (ex EUR)
 *   creditor?,
 *   folderCode?,
 *   folderLabel?,
 *   finalName?,        // nom du fichier Drive sans .pdf
 *   skipDrive?,        // skip l'upload Drive (par defaut false — upload auto)
 * }
 * Bearer CRON_SECRET.
 *
 * Passe une invoice en status='matched' + met a jour tous les champs
 * fournis + declenche l'upload Drive si une attachement_b64 existe et
 * si skipDrive != true.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    row?: number;
    currency?: string;
    month?: string;
    invoiceDate?: string;
    amount?: number;
    invoiceCurrency?: string;
    creditor?: string;
    folderCode?: string;
    folderLabel?: string;
    finalName?: string;
    skipDrive?: boolean;
  };
  if (!body.id || !body.row || !body.currency) {
    return NextResponse.json(
      { error: "missing", message: "id, row, currency requis" },
      { status: 400 },
    );
  }
  const sql = postgres(
    process.env.DATABASE_URL ??
      process.env.POSTGRES_URL ??
      "postgres://localhost/postgres",
    { max: 1, prepare: false, ssl: "require" },
  );
  try {
    // Calcule la nouvelle date : priorité invoiceDate complet > month+jour > inchangé
    let newDate: string | null = null;
    if (body.invoiceDate) {
      newDate = body.invoiceDate;
    } else if (body.month) {
      const cur = await sql<{ invoice_date: Date | null }[]>`
        SELECT invoice_date FROM invoices WHERE id = ${body.id}
      `;
      const currentDate = cur[0]?.invoice_date;
      const day = currentDate
        ? String(currentDate.getUTCDate()).padStart(2, "0")
        : "15";
      newDate = `${body.month}-${day}`;
    }

    // Build dynamic update with Postgres.js
    // On applique les non-null un par un pour rester lisible.
    await sql`
      UPDATE invoices
      SET status = 'matched',
          excel_row_matched = ${body.row},
          account_currency = ${body.currency},
          invoice_date = COALESCE(${newDate}::date, invoice_date),
          amount = COALESCE(${body.amount ?? null}, amount),
          currency = COALESCE(${body.invoiceCurrency ?? null}, currency),
          creditor = COALESCE(${body.creditor ?? null}, creditor),
          folder_code = COALESCE(${body.folderCode ?? null}, folder_code),
          folder_label = COALESCE(${body.folderLabel ?? null}, folder_label),
          final_name = COALESCE(${body.finalName ?? null}, final_name)
      WHERE id = ${body.id}
    `;

    // Upload Drive (si attachement et skipDrive != true)
    let drive: { uploaded: boolean; reason?: string } | null = null;
    if (!body.skipDrive) {
      try {
        drive = await uploadMatchedInvoiceToDrive(body.id);
      } catch (e) {
        drive = { uploaded: false, reason: (e as Error).message };
      }
    }

    const [inv] = await sql<
      {
        id: string;
        creditor: string | null;
        excel_row_matched: number;
        account_currency: string;
        invoice_date: Date | null;
        status: string;
        folder_code: string | null;
        folder_label: string | null;
        final_name: string | null;
        amount: string | null;
        currency: string | null;
        drive_path: string | null;
      }[]
    >`
      SELECT id, creditor, excel_row_matched, account_currency, invoice_date,
             status, folder_code, folder_label, final_name, amount, currency,
             drive_path
      FROM invoices WHERE id = ${body.id}
    `;
    return NextResponse.json({ ok: true, invoice: inv, drive });
  } finally {
    await sql.end();
  }
}
