/**
 * Logique partagée entre le cron et le trigger manuel : pour chaque boîte
 * autorisée, fetch les derniers mails Gmail avec PJ PDF, dédup, et crée
 * des Invoice rows pending classification.
 */

import {
  finishSyncRun,
  createSyncRun,
  getAllMappings,
  getMailboxesForSync,
  incrementMailboxInvoicesFound,
  insertIncomingInvoice,
  invoiceExistsForMessage,
  updateMailboxAccessToken,
  updateMailboxLastSync,
} from "./db";
import { refreshAccessToken } from "./google-oauth";
import {
  extractPdfAttachments,
  getAttachmentBase64,
  getMessage,
  header,
  listMessages,
} from "./gmail-api";
import { autoProcessInvoice } from "./auto-process";
import type { DriveFolderCache } from "./upload-to-drive";
import type { SyncRunResult } from "./types";

type SyncOptions = {
  /** Filtre : ne syncer que ces boîtes. Par défaut : toutes celles avec sync_enabled. */
  mailboxIds?: string[];
  /** Combien de jours en arrière (par défaut 6). Ignoré si afterDate/beforeDate posés. */
  lookbackDays?: number;
  /** Plage personnalisée (YYYY-MM-DD). Inclusive aux deux bords si renseignée. */
  afterDate?: string;
  beforeDate?: string;
};

function buildGmailQuery(opts: SyncOptions): string {
  const parts: string[] = ["has:attachment", "filename:pdf"];
  if (opts.afterDate || opts.beforeDate) {
    if (opts.afterDate) {
      parts.push(`after:${opts.afterDate.replace(/-/g, "/")}`);
    }
    if (opts.beforeDate) {
      // Gmail `before:` est strict — on ajoute 1 jour pour rendre la borne inclusive.
      const d = new Date(opts.beforeDate + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 1);
      const inclusive = d.toISOString().slice(0, 10).replace(/-/g, "/");
      parts.push(`before:${inclusive}`);
    }
  } else {
    parts.push(`newer_than:${opts.lookbackDays ?? 6}d`);
  }
  return parts.join(" ");
}

async function getValidAccessToken(mb: {
  id: string;
  oauth_access_token: string | null;
  oauth_expires_at: Date | null;
  oauth_refresh_token: string;
  oauth_client_id: string;
  oauth_client_secret: string;
}): Promise<string> {
  const now = Date.now();
  const expiresAt = mb.oauth_expires_at ? mb.oauth_expires_at.getTime() : 0;

  // Token encore valide pour > 60s → on le réutilise.
  if (mb.oauth_access_token && expiresAt > now + 60_000) {
    return mb.oauth_access_token;
  }

  const refreshed = await refreshAccessToken({
    refreshToken: mb.oauth_refresh_token,
    clientId: mb.oauth_client_id,
    clientSecret: mb.oauth_client_secret,
  });

  await updateMailboxAccessToken(mb.id, refreshed.accessToken, refreshed.expiresAt);

  return refreshed.accessToken;
}

export async function runSync(
  trigger: "cron" | "manual",
  opts: SyncOptions = {},
): Promise<{
  runId: string;
  results: SyncRunResult[];
  totalAdded: number;
  totalSkipped: number;
  query: string;
}> {
  const query = buildGmailQuery(opts);
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await createSyncRun(runId, trigger);

  const results: SyncRunResult[] = [];
  let totalAdded = 0;
  let totalSkipped = 0;
  let runError: string | null = null;

  try {
    // On charge les mappings comptables une fois pour l'ensemble du run,
    // ils servent à toute la classification auto downstream.
    const mappings = await getAllMappings();
    // Cache des dossiers Drive partagé entre toutes les invoices du run :
    // évite de re-chercher /Comptabilité/2026/05/TECH-… à chaque facture.
    const driveFolderCache: DriveFolderCache = new Map();

    const mailboxes = await getMailboxesForSync(opts.mailboxIds);

    for (const mb of mailboxes) {
      const r: SyncRunResult = {
        mailboxId: mb.id,
        mailboxEmail: mb.email,
        added: 0,
        skipped: 0,
        totalMessages: 0,
      };
      try {
        const accessToken = await getValidAccessToken(mb);

        const messageIds = await listMessages(accessToken, query, 100);
        r.totalMessages = messageIds.length;

        for (const messageId of messageIds) {
          const dup = await invoiceExistsForMessage(mb.id, messageId);
          if (dup) {
            r.skipped++;
            totalSkipped++;
            continue;
          }

          const msg = await getMessage(accessToken, messageId);
          const attachments = extractPdfAttachments(msg);
          if (attachments.length === 0) continue;

          const subject = header(msg, "Subject") ?? "(sans objet)";
          const fromEmail = header(msg, "From") ?? "";
          const dateHeader = header(msg, "Date");
          const receivedAt = dateHeader
            ? new Date(dateHeader).toISOString()
            : new Date(Number(msg.internalDate)).toISOString();

          // On stocke une row par PJ PDF (un mail peut en avoir plusieurs).
          for (const att of attachments) {
            const invoiceId = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const b64 = await getAttachmentBase64(
              accessToken,
              messageId,
              att.attachmentId,
            );
            await insertIncomingInvoice({
              id: invoiceId,
              mailboxId: mb.id,
              sourceMessageId: messageId,
              subject,
              fromEmail,
              mailbox: mb.email,
              receivedAt,
              attachmentName: att.filename,
              attachmentBytes: att.size,
              attachmentB64: b64,
            });

            // ---- Pipeline complet : extract → classify → Drive → Excel match ----
            try {
              const outcome = await autoProcessInvoice({
                invoiceId,
                fromEmail,
                subject,
                receivedAt,
                pdfBase64: b64,
                mappings,
                driveFolderCache,
              });
              if (outcome.errors.length > 0) {
                console.warn(
                  "autoProcess warnings",
                  invoiceId,
                  outcome.errors.join(" | "),
                );
              }
            } catch (e) {
              console.error("autoProcess crashed", invoiceId, e);
            }

            r.added++;
            totalAdded++;
          }
        }

        await updateMailboxLastSync(mb.id);
        if (r.added > 0) {
          await incrementMailboxInvoicesFound(mb.id, r.added);
        }
      } catch (e) {
        r.error = (e as Error).message;
      }
      results.push(r);
    }
  } catch (e) {
    runError = (e as Error).message;
  }

  await finishSyncRun(runId, results, totalAdded, totalSkipped, runError);

  return { runId, results, totalAdded, totalSkipped, query };
}
