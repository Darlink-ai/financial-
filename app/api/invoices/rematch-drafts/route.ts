import { NextResponse } from "next/server";
import {
  getAllMappings,
  getInvoiceWithAttachment,
  getManualDraftIdsBetween,
  resetInvoiceRetryCount,
} from "@/lib/db";
import { autoProcessInvoice } from "@/lib/auto-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/invoices/rematch-drafts
 * Body : { fromMonth: "2026-01", toMonth: "2026-06" }
 *
 * Bulk : re-lance autoProcess (mode draft, skipDrive=true) sur tous les
 * brouillons /import de la période. Le nouveau matcher multi-passes
 * (pass 1 strict libre → pass 1b loose libre → pass 2 fallback occupée)
 * peut proposer une meilleure ligne Excel que celle proposée à l'origine.
 *
 * Effets :
 *  - excel_row_matched mis à jour en DB pour chaque brouillon
 *  - status reste 'renamed' (draft) — pas d'upload Drive
 *  - au prochain refresh de /import, l'utilisateur voit les nouvelles
 *    propositions
 *
 * Renvoie un breakdown : combien ont bougé de ligne, combien sont restés
 * pareils, combien n'ont toujours pas de match.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      fromMonth?: string;
      toMonth?: string;
      /** Si true, ignore la plage → traite TOUS les drafts existants. */
      all?: boolean;
    };

    // Deux modes d'auth :
    //  1. Bearer CRON_SECRET dans l'header Authorization → callable from
    //     curl / scripts / cron. Middleware doit skip cet endpoint pour
    //     que le header ne soit pas court-circuité par Supabase auth.
    //  2. Session Supabase valide (via middleware qui aura filtré avant
    //     d'arriver ici) → callable depuis le bouton /import.
    // Si aucun des deux ne passe → 401.
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get("authorization") ?? "";
    const hasBearer =
      cronSecret && authHeader === `Bearer ${cronSecret}`;
    // Le middleware laisse passer cette route (elle est en PUBLIC_PATHS).
    // Si pas de Bearer, on exige que req.headers.get("cookie") contienne
    // un cookie Supabase — indirectement vérifié via le fait que le
    // browser a passé le login. Contrôle minimal pour empêcher un caller
    // 100% anonyme.
    const hasSessionCookie = (req.headers.get("cookie") ?? "").includes(
      "sb-",
    );
    if (!hasBearer && !hasSessionCookie) {
      return NextResponse.json(
        { error: "unauthorized", message: "Bearer CRON_SECRET ou session Supabase requise." },
        { status: 401 },
      );
    }
    const fromMonth = body.all ? undefined : body.fromMonth;
    const toMonth = body.all ? undefined : body.toMonth;
    if (fromMonth && !/^\d{4}-\d{2}$/.test(fromMonth)) {
      return NextResponse.json(
        { error: "bad_range", message: "fromMonth attendu au format YYYY-MM." },
        { status: 400 },
      );
    }
    if (toMonth && !/^\d{4}-\d{2}$/.test(toMonth)) {
      return NextResponse.json(
        { error: "bad_range", message: "toMonth attendu au format YYYY-MM." },
        { status: 400 },
      );
    }

    const ids = await getManualDraftIdsBetween({ fromMonth, toMonth });
    if (ids.length === 0) {
      return NextResponse.json({ ok: true, total: 0, processed: 0, breakdown: null });
    }

    const mappings = await getAllMappings();
    let processed = 0;
    let rowChanged = 0;
    let rowUnchanged = 0;
    let gotMatch = 0; // avait null, a maintenant une ligne
    let lostMatch = 0; // avait une ligne, n'a plus rien (rare)
    let stillNoMatch = 0; // toujours pas de proposition
    let failedCount = 0;

    for (const id of ids) {
      try {
        const before = await getInvoiceWithAttachment(id);
        if (!before?.attachmentB64) {
          stillNoMatch++;
          continue;
        }
        const oldRow = before.invoice.excelRowMatched;
        await resetInvoiceRetryCount(id).catch(() => {});
        const outcome = await autoProcessInvoice({
          invoiceId: id,
          fromEmail: before.fromEmail,
          subject: before.subject,
          receivedAt: before.invoice.receivedAt,
          pdfBase64: before.attachmentB64,
          mappings,
          skipDrive: true, // mode draft : on ne valide pas, on propose
        });
        const newRow = outcome.matchedExcelRow;
        if (oldRow == null && newRow == null) {
          stillNoMatch++;
        } else if (oldRow != null && newRow == null) {
          lostMatch++;
        } else if (oldRow == null && newRow != null) {
          gotMatch++;
        } else if (oldRow === newRow) {
          rowUnchanged++;
        } else {
          rowChanged++;
        }
        processed++;
      } catch (e) {
        console.error("rematch-drafts failed for", id, e);
        failedCount++;
      }
    }

    return NextResponse.json({
      ok: true,
      total: ids.length,
      processed,
      breakdown: {
        gotMatch, // n'avait pas de proposition, en a une maintenant
        rowChanged, // ligne différente (nouveau matcher a mieux fait)
        rowUnchanged, // même ligne (rien changé)
        lostMatch, // rare : avait une ligne, plus rien
        stillNoMatch, // pas de match ni avant ni après
        failed: failedCount,
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: "rematch_drafts_failed", message: (e as Error).message },
      { status: 500 },
    );
  }
}
