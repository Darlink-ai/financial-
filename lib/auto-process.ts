/**
 * Pipeline complet de traitement d'une facture fraîchement insérée :
 *   1. Extraction PDF (créancier / montant / devise / date)
 *   2. Classification contre folder_mappings
 *   3. Upload Drive (si configuré)
 *   4. Match Excel (si une feuille existe pour le mois + devise)
 *
 * Met à jour l'invoice avec le bon status final :
 *   matched   → tout OK + ligne Excel trouvée
 *   uploaded  → sur Drive mais pas de ligne Excel (sheet absent ou pas de match)
 *   classified → tout extrait mais Drive non configuré
 *   manual    → quelque chose a foiré, à traiter à la main
 */

import { extractInvoiceFromPdf } from "./pdf-extract";
import { classifyAgainstMappings, deriveBankAccount } from "./auto-classify";
import { buildFinalName } from "./format";
import {
  uploadInvoiceToDrive,
  type DriveFolderCache,
  getDriveAccessToken,
} from "./upload-to-drive";
import {
  deleteInvoice,
  findInvoicesMatchingRow,
  getAllState,
  getExcelSheet,
  getInvoiceRetryCount,
  recordInvoiceFailure,
  recordInvoiceProcessed,
  updateInvoice,
} from "./db";

/** Au-delà de ce nombre d'échecs, on abandonne et l'invoice passe en `manual`. */
const MAX_AUTO_RETRIES = 3;
import { matchInvoicesAgainstSheet } from "./excel-match";
import type {
  AccountCurrency,
  FolderMapping,
  Invoice,
  InvoiceStatus,
} from "./types";

/**
 * Ordre de priorité pour chercher une facture dans les rapprochements
 * Excel : la plupart des transactions tombent sur le compte EUR (carte
 * liée), même quand le PDF est en USD ou CHF. On cherche donc EUR
 * d'abord, puis CHF, puis USD. Le premier match gagne.
 */
const EXCEL_SEARCH_ORDER: AccountCurrency[] = ["EUR", "CHF", "USD"];

/**
 * Re-trigger le matching Excel pour toutes les invoices d'un bucket
 * (mois + devise de compte) — appelé après que l'utilisateur uploade
 * un fichier Excel.
 */
export async function rematchInvoicesForBucket(opts: {
  month: string;
  /** @deprecated — le matching est désormais cross-currency, ce param est ignoré. */
  accountCurrency?: string;
}): Promise<{ matched: number; cleared: number; dedupedDuplicates: number }> {
  // On charge les 3 sheets du mois et on essaie de matcher chaque
  // facture dans l'ordre EUR > CHF > USD. Le premier match gagne et
  // détermine l'accountCurrency de la facture.
  const sheetsByCurrency: Partial<
    Record<AccountCurrency, { headers: string[]; rows: (string | number | null)[][] }>
  > = {};
  for (const cur of EXCEL_SEARCH_ORDER) {
    const s = await getExcelSheet(opts.month, cur);
    if (s) sheetsByCurrency[cur] = { headers: s.headers, rows: s.rows };
  }

  const state = await getAllState();
  const candidates = state.invoices.filter((inv) => {
    const ref = inv.invoiceDate ?? inv.receivedAt;
    if (ref.slice(0, 7) !== opts.month) return false;
    return inv.creditor != null;
  });

  if (Object.keys(sheetsByCurrency).length === 0) {
    return { matched: 0, cleared: 0, dedupedDuplicates: 0 };
  }

  // Premier passage : pour chaque facture, trouver son best match (EUR > CHF > USD).
  type Resolved = {
    invoiceId: string;
    receivedAt: string;
    currency: AccountCurrency;
    rowIndex: number; // 0-based
    excelAmount: number | null;
  };
  const resolved: Resolved[] = [];
  for (const inv of candidates) {
    for (const cur of EXCEL_SEARCH_ORDER) {
      const sheet = sheetsByCurrency[cur];
      if (!sheet) continue;
      const matches = matchInvoicesAgainstSheet(sheet, [inv]);
      if (matches.length > 0) {
        resolved.push({
          invoiceId: inv.id,
          receivedAt: inv.receivedAt,
          currency: cur,
          rowIndex: matches[0].rowIndex,
          excelAmount: matches[0].excelAmount,
        });
        break;
      }
    }
  }

  // ---- Dédoublonnage : par (currency, rowIndex). On garde le plus ancien. ----
  const byKey = new Map<string, Resolved[]>();
  for (const r of resolved) {
    const key = `${r.currency}|${r.rowIndex}`;
    const arr = byKey.get(key) ?? [];
    arr.push(r);
    byKey.set(key, arr);
  }
  const idsToDelete = new Set<string>();
  for (const [, group] of byKey) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort(
      (a, b) =>
        new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime(),
    );
    for (const loser of sorted.slice(1)) idsToDelete.add(loser.invoiceId);
  }
  let dedupedDuplicates = 0;
  for (const id of idsToDelete) {
    try {
      await deleteInvoice(id);
      dedupedDuplicates++;
    } catch (e) {
      console.error("rematch dedup delete failed for", id, e);
    }
  }

  // ---- Application des matches ----
  const resolvedById = new Map(
    resolved
      .filter((r) => !idsToDelete.has(r.invoiceId))
      .map((r) => [r.invoiceId, r]),
  );

  let matched = 0;
  let cleared = 0;
  for (const inv of candidates) {
    if (idsToDelete.has(inv.id)) continue;
    const r = resolvedById.get(inv.id);
    if (r) {
      const rowExcel = r.rowIndex + 2;
      const authoritativeAmount =
        r.excelAmount != null && Number.isFinite(r.excelAmount)
          ? Math.abs(r.excelAmount)
          : null;

      const needsUpdate =
        inv.excelRowMatched !== rowExcel ||
        inv.status !== "matched" ||
        inv.accountCurrency !== r.currency ||
        (authoritativeAmount != null &&
          Math.abs((inv.amount ?? 0) - authoritativeAmount) > 0.01);

      if (needsUpdate) {
        await updateInvoice(inv.id, {
          excelRowMatched: rowExcel,
          accountCurrency: r.currency,
          status: "matched",
          ...(authoritativeAmount != null ? { amount: authoritativeAmount } : {}),
        });
        matched++;
      }
    } else if (inv.status === "matched") {
      // Avant matchée mais plus dans aucun sheet → rétrograde.
      await updateInvoice(inv.id, {
        excelRowMatched: null,
        status: inv.drivePath ? "uploaded" : "renamed",
      });
      cleared++;
    }
  }
  return { matched, cleared, dedupedDuplicates };
}

export type AutoProcessInput = {
  invoiceId: string;
  fromEmail: string;
  subject: string;
  receivedAt: string;
  pdfBase64: string;
  mappings: FolderMapping[];
  driveFolderCache?: DriveFolderCache; // partagé entre invoices du même run
};

export type AutoProcessOutcome = {
  status: InvoiceStatus;
  classified: boolean;
  uploadedToDrive: boolean;
  matchedExcelRow: number | null;
  errors: string[];
  /** Si la facture a été supprimée comme doublon d'une autre invoice. */
  deletedAsDuplicateOf?: string | null;
  /** Autres invoices supprimées en tant que doublons (cas où celle-ci a "gagné"). */
  deletedOtherIds?: string[];
};

export async function autoProcessInvoice(
  input: AutoProcessInput,
): Promise<AutoProcessOutcome> {
  // Compteur de retry : on tente jusqu'à MAX_AUTO_RETRIES, après quoi
  // on bascule en `manual`. Évite de boucler sur les PDFs non-factures
  // (rapports d'activité, time-tracking, etc.).
  let currentCount = 0;
  try {
    currentCount = await getInvoiceRetryCount(input.invoiceId);
  } catch (e) {
    // Si la colonne retry_count n'existe pas, on log clairement —
    // c'est probablement que la migration n'est pas appliquée.
    console.error(
      "[autoProcess] getInvoiceRetryCount failed (migration appliquée ?)",
      (e as Error).message,
    );
  }

  if (currentCount >= MAX_AUTO_RETRIES) {
    try {
      await updateInvoice(input.invoiceId, { status: "manual" });
      await recordInvoiceFailure(
        input.invoiceId,
        `Abandon après ${MAX_AUTO_RETRIES} tentatives échouées.`,
      );
    } catch {
      /* ignore */
    }
    return {
      status: "manual",
      classified: false,
      uploadedToDrive: false,
      matchedExcelRow: null,
      errors: [`Abandon après ${MAX_AUTO_RETRIES} tentatives échouées.`],
    };
  }

  try {
    const outcome = await autoProcessInvoiceInner(input);
    // Traçage de l'essai réussi. Si le pipeline a produit des warnings
    // mais a quand même réussi, on garde la trace dans last_error.
    try {
      if (outcome.errors.length > 0) {
        await recordInvoiceFailure(
          input.invoiceId,
          `[warn] ${outcome.errors.join(" | ")}`,
        );
      } else {
        await recordInvoiceProcessed(input.invoiceId);
      }
    } catch {
      /* migration pas appliquée ? on ignore le log mais l'invoice est ok */
    }
    return outcome;
  } catch (e) {
    const err = (e as Error).message ?? String(e);
    console.error("[autoProcess]", input.invoiceId, "failed:", err);
    try {
      await recordInvoiceFailure(input.invoiceId, err);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

async function autoProcessInvoiceInner(
  input: AutoProcessInput,
): Promise<AutoProcessOutcome> {
  const errors: string[] = [];

  // ---- 1. Extraction PDF ----
  const pdfBuffer = Buffer.from(input.pdfBase64, "base64");
  let extracted;
  try {
    extracted = await extractInvoiceFromPdf({
      pdfBuffer,
      fromEmail: input.fromEmail,
    });
  } catch (e) {
    errors.push(`extract: ${(e as Error).message}`);
    await updateInvoice(input.invoiceId, { status: "manual" });
    return {
      status: "manual",
      classified: false,
      uploadedToDrive: false,
      matchedExcelRow: null,
      errors,
    };
  }

  // ---- 2. Classification (regex → cache DB → LLM Claude) ----
  const classify = await classifyAgainstMappings({
    mappings: input.mappings,
    creditor: extracted.creditor,
    subject: input.subject,
    fromEmail: input.fromEmail,
    pdfTextExcerpt: extracted.text,
  });
  const mapping = classify.mapping;
  // Trace de la décision dans les logs serveur (pas dans last_error pour
  // ne pas polluer l'UI sur les classifications réussies).
  console.log(
    `[autoProcess] ${input.invoiceId} classify(${classify.via}): ${classify.reason}`,
  );
  // Seul un échec de classification pousse une raison dans errors[] —
  // sinon on aurait un faux "[warn]" sur chaque facture correctement classée.
  if (!mapping) {
    errors.push(`classify(${classify.via}): ${classify.reason}`);
  }
  const accountCurrency = deriveBankAccount(extracted.currency);
  const finalName =
    mapping && extracted.creditor && extracted.invoiceDate
      ? buildFinalName(extracted.invoiceDate, extracted.creditor, mapping.folderCode)
      : null;
  const fullyClassified = !!(
    mapping &&
    extracted.creditor &&
    extracted.amount &&
    extracted.invoiceDate &&
    finalName
  );

  const patch: Partial<Invoice> = {
    creditor: extracted.creditor,
    amount: extracted.amount,
    currency: extracted.currency,
    invoiceDate: extracted.invoiceDate,
    accountCurrency,
    folderCode: mapping?.folderCode ?? null,
    folderLabel: mapping?.folderLabel ?? null,
    finalName,
  };

  if (!fullyClassified) {
    await updateInvoice(input.invoiceId, { ...patch, status: "manual" });
    return {
      status: "manual",
      classified: false,
      uploadedToDrive: false,
      matchedExcelRow: null,
      errors,
    };
  }

  // ---- 3. Upload Drive ----
  let drivePath: string | null = null;
  let uploaded = false;
  try {
    const token = await getDriveAccessToken();
    if (token) {
      const up = await uploadInvoiceToDrive(
        {
          pdfBuffer,
          finalName: finalName!,
          invoiceDateIso: extracted.invoiceDate!,
          folderCode: mapping!.folderCode,
          folderLabel: mapping!.folderLabel,
        },
        input.driveFolderCache,
      );
      drivePath = up.drivePath;
      uploaded = true;
    }
  } catch (e) {
    errors.push(`drive: ${(e as Error).message}`);
  }

  patch.drivePath = drivePath;

  // ---- 4. Match Excel (cross-currency) ----
  // On cherche dans les 3 sheets dans l'ordre EUR > CHF > USD parce
  // que la devise du PDF (USD/CHF/EUR) n'indique PAS sur quel compte
  // bancaire le débit a été fait — ça dépend de la carte liée. Le
  // premier match gagne, et l'accountCurrency de la facture est mis
  // à la devise du sheet matché.
  const dateForMonth = extracted.invoiceDate ?? input.receivedAt;
  const month = dateForMonth.slice(0, 7);
  let matchedRow: number | null = null;
  let matchedCurrency: AccountCurrency | null = null;

  const dummy: Invoice = {
    id: input.invoiceId,
    subject: input.subject,
    fromEmail: input.fromEmail,
    mailbox: "",
    receivedAt: input.receivedAt,
    creditor: extracted.creditor,
    invoiceDate: extracted.invoiceDate,
    amount: extracted.amount,
    currency: extracted.currency,
    folderCode: mapping?.folderCode ?? null,
    folderLabel: mapping?.folderLabel ?? null,
    finalName,
    drivePath,
    status: "classified",
    excelRowMatched: null,
    attachment: null,
    accountCurrency,
  };

  for (const currency of EXCEL_SEARCH_ORDER) {
    try {
      const sheet = await getExcelSheet(month, currency);
      if (!sheet) continue;
      const matches = matchInvoicesAgainstSheet(
        { headers: sheet.headers, rows: sheet.rows },
        [dummy],
      );
      if (matches.length > 0) {
        matchedRow = matches[0].rowIndex + 2;
        matchedCurrency = currency;
        // Excel = source de vérité pour le montant.
        const excelAmount = matches[0].excelAmount;
        if (excelAmount != null && Number.isFinite(excelAmount)) {
          patch.amount = Math.abs(excelAmount);
        }
        break;
      }
    } catch (e) {
      errors.push(`excel(${currency}): ${(e as Error).message}`);
    }
  }

  // Si match trouvé : l'accountCurrency vient du sheet, pas du PDF.
  if (matchedCurrency) {
    patch.accountCurrency = matchedCurrency;
  }

  // ---- 4b. Dédoublonnage facture / reçu ----
  // Quand un fournisseur envoie un invoice ET un receipt pour la même
  // opération bancaire, on a 2 invoices en DB qui ciblent la même ligne
  // Excel. On garde la plus ancienne (typiquement la facture, arrivée
  // avant le reçu) et on supprime les autres.
  let deletedAsDuplicateOf: string | null = null;
  const deletedOtherIds: string[] = [];
  if (matchedRow !== null && matchedCurrency) {
    try {
      const others = await findInvoicesMatchingRow({
        excludeId: input.invoiceId,
        accountCurrency: matchedCurrency,
        rowIndex: matchedRow,
      });
      if (others.length > 0) {
        const currentTime = new Date(input.receivedAt).getTime();
        // Existant plus ancien que la facture courante → on est le doublon.
        const olderExisting = others.find(
          (o) => new Date(o.receivedAt).getTime() <= currentTime,
        );
        if (olderExisting) {
          // Self est le doublon : on se supprime et on sort proprement.
          await deleteInvoice(input.invoiceId);
          return {
            status: "matched", // statut conceptuel ; la row n'existe plus
            classified: true,
            uploadedToDrive: uploaded,
            matchedExcelRow: matchedRow,
            errors: [
              ...errors,
              `Doublon supprimé : la ligne Excel #${matchedRow} est déjà couverte par ${olderExisting.finalName ?? olderExisting.id}.`,
            ],
            deletedAsDuplicateOf: olderExisting.id,
          };
        } else {
          // Self est le plus ancien : on garde + on supprime les newer.
          for (const o of others) {
            try {
              await deleteInvoice(o.id);
              deletedOtherIds.push(o.id);
            } catch (e) {
              console.error("dedup delete failed for", o.id, e);
            }
          }
        }
      }
    } catch (e) {
      console.error("dedup check failed", e);
    }
  }

  // ---- Status final ----
  // - matched  → ligne Excel trouvée (top du happy path)
  // - uploaded → sur Drive mais Excel pas encore matchée
  // - renamed  → fichier renommé (finalName construit) mais Drive non
  //              configuré ou upload a échoué
  let finalStatus: InvoiceStatus;
  if (matchedRow !== null) finalStatus = "matched";
  else if (uploaded) finalStatus = "uploaded";
  else finalStatus = "renamed";

  await updateInvoice(input.invoiceId, {
    ...patch,
    excelRowMatched: matchedRow,
    status: finalStatus,
  });

  return {
    status: finalStatus,
    classified: true,
    uploadedToDrive: uploaded,
    matchedExcelRow: matchedRow,
    errors,
    deletedAsDuplicateOf,
    deletedOtherIds,
  };
}
