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
  FolderMapping,
  Invoice,
  InvoiceStatus,
} from "./types";

/**
 * Re-trigger le matching Excel pour toutes les invoices d'un bucket
 * (mois + devise de compte) — appelé après que l'utilisateur uploade
 * un fichier Excel.
 */
export async function rematchInvoicesForBucket(opts: {
  month: string;
  accountCurrency: string;
}): Promise<{ matched: number; cleared: number }> {
  const sheet = await getExcelSheet(opts.month, opts.accountCurrency);
  const state = await getAllState();

  // Candidats : factures du bon mois + compte, avec au minimum un créancier
  // identifié. Le montant peut être absent ou faux : on s'en fout puisque
  // l'Excel sera autoritaire.
  const candidates = state.invoices.filter((inv) => {
    if ((inv.accountCurrency ?? "USD") !== opts.accountCurrency) return false;
    const ref = inv.invoiceDate ?? inv.receivedAt;
    if (ref.slice(0, 7) !== opts.month) return false;
    return inv.creditor != null;
  });

  // Si pas de sheet : on ne touche rien (la sheet pourrait être en cours
  // d'upload, on n'a pas envie de casser le state existant).
  if (!sheet) return { matched: 0, cleared: 0 };

  let matched = 0;
  let cleared = 0;
  const matches = matchInvoicesAgainstSheet(
    { headers: sheet.headers, rows: sheet.rows },
    candidates,
  );
  const matchedByInvoice = new Map(matches.map((m) => [m.invoice.id, m]));

  for (const inv of candidates) {
    const m = matchedByInvoice.get(inv.id);
    if (m) {
      const rowExcel = m.rowIndex + 2;
      // Excel = source de vérité — on récupère son montant.
      const authoritativeAmount =
        m.excelAmount != null && Number.isFinite(m.excelAmount)
          ? Math.abs(m.excelAmount)
          : null;

      const needsUpdate =
        inv.excelRowMatched !== rowExcel ||
        inv.status !== "matched" ||
        (authoritativeAmount != null &&
          Math.abs((inv.amount ?? 0) - authoritativeAmount) > 0.01);

      if (needsUpdate) {
        await updateInvoice(inv.id, {
          excelRowMatched: rowExcel,
          status: "matched",
          ...(authoritativeAmount != null ? { amount: authoritativeAmount } : {}),
        });
        matched++;
      }
    } else if (inv.status === "matched") {
      // Avant matchée mais plus dans la nouvelle sheet → on rétrograde.
      await updateInvoice(inv.id, {
        excelRowMatched: null,
        status: inv.drivePath ? "uploaded" : "classified",
      });
      cleared++;
    }
  }
  return { matched, cleared };
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

  // ---- 4. Match Excel ----
  const dateForMonth = extracted.invoiceDate ?? input.receivedAt;
  const month = dateForMonth.slice(0, 7);
  let matchedRow: number | null = null;
  try {
    const sheet = await getExcelSheet(month, accountCurrency);
    if (sheet) {
      // On rebuild une "facture" minimale pour le matcher avec les valeurs extraites.
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
      const matches = matchInvoicesAgainstSheet(
        { headers: sheet.headers, rows: sheet.rows },
        [dummy],
      );
      if (matches.length > 0) {
        // +2 : +1 pour la ligne d'en-tête, +1 pour passer en 1-based (cohérent
        // avec ce qui est affiché dans la page Excel).
        matchedRow = matches[0].rowIndex + 2;
        // ---- Excel = source de vérité (relevé bancaire UBS) ----
        // On écrase le montant extrait du PDF par celui de la ligne Excel.
        // Le PDF n'est qu'un signal (et son extraction peut être bruyante :
        // token counts, IDs, etc.). Le débit bancaire est canonique.
        const excelAmount = matches[0].excelAmount;
        if (excelAmount != null && Number.isFinite(excelAmount)) {
          patch.amount = Math.abs(excelAmount);
        }
      }
    }
  } catch (e) {
    errors.push(`excel: ${(e as Error).message}`);
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
  };
}
