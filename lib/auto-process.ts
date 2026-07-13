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
  getInvoiceWithAttachment,
  getOccupiedExcelRows,
  recordInvoiceFailure,
  recordInvoiceProcessed,
  updateInvoice,
} from "./db";

/** Au-delà de ce nombre d'échecs, on abandonne et l'invoice passe en `manual`. */
const MAX_AUTO_RETRIES = 3;
import { findBestCandidate, matchInvoicesAgainstSheet } from "./excel-match";
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
  // On exige inv.invoiceDate (pas de fallback sur receivedAt) — sinon une
  // facture mal datée serait re-matchée contre le mois courant à tort.
  // Les factures sans invoiceDate restent en sas, à rapprocher manuellement.
  const candidates = state.invoices.filter((inv) => {
    if (!inv.invoiceDate) return false;
    if (inv.invoiceDate.slice(0, 7) !== opts.month) return false;
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
  // Garde trace des lignes déjà attribuées dans ce batch (par devise),
  // pour qu'une 2e facture du même créditeur/jour aille sur la ligne
  // SUIVANTE plutôt que de re-matcher la même ligne 14 (qui serait
  // ensuite dédoublonnée à tort). Le batch est traité dans l'ordre des
  // candidates — on assigne donc en greedy : 1er trouvé gagne la ligne.
  const claimedByCurrency: Partial<Record<AccountCurrency, Set<number>>> = {};
  for (const inv of candidates) {
    for (const cur of EXCEL_SEARCH_ORDER) {
      const sheet = sheetsByCurrency[cur];
      if (!sheet) continue;
      const claimed = claimedByCurrency[cur] ?? new Set<number>();
      // Pass 1 : ligne libre (n'importe pas encore prise dans ce batch).
      let matches = matchInvoicesAgainstSheet(sheet, [inv], {
        excludeRowIndices: claimed,
      });
      // Pass 2 : si rien de libre → on tolère un conflit (vrai doublon
      // facture/reçu pour la même tx bancaire). Le dédoublonnage par
      // byKey ci-dessous gardera le plus ancien.
      if (matches.length === 0 && claimed.size > 0) {
        matches = matchInvoicesAgainstSheet(sheet, [inv]);
      }
      if (matches.length > 0) {
        const rowIndex = matches[0].rowIndex;
        // rowIndex + 2 = N° Excel humain — cohérent avec excludeRowIndices.
        claimed.add(rowIndex + 2);
        claimedByCurrency[cur] = claimed;
        resolved.push({
          invoiceId: inv.id,
          receivedAt: inv.receivedAt,
          currency: cur,
          rowIndex,
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
        // Règle : un match juste trouvé déclenche l'upload Drive (si pas
        // déjà fait + Drive configuré + classification OK).
        if (!inv.drivePath) {
          try {
            await uploadMatchedInvoiceToDrive(inv.id);
          } catch (e) {
            console.error("rematch drive upload failed for", inv.id, e);
          }
        }
      }
    } else if (inv.status === "matched") {
      // Avant matchée mais plus dans aucun sheet → rétrograde.
      // (Drive : on garde le fichier en place, on ne re-télécharge pas.)
      await updateInvoice(inv.id, {
        excelRowMatched: null,
        status: inv.drivePath ? "uploaded" : "renamed",
      });
      cleared++;
    }
  }
  return { matched, cleared, dedupedDuplicates };
}

/**
 * Upload Drive standalone d'une facture déjà rapprochée. Idempotent
 * (uploadInvoiceToDrive skip si le fichier existe déjà sur Drive).
 *
 * Utilisé par :
 *  - rematchInvoicesForBucket : quand une facture passe de "renamed" à
 *    "matched" suite à l'upload Excel
 *  - /api/invoices/[id]/assign-row : match manuel via /excel
 *
 * Met à jour drivePath et status (matched) en DB.
 */
export async function uploadMatchedInvoiceToDrive(
  invoiceId: string,
): Promise<{ uploaded: boolean; drivePath: string | null; reason?: string }> {
  const data = await getInvoiceWithAttachment(invoiceId);
  if (!data) return { uploaded: false, drivePath: null, reason: "not_found" };
  const inv = data.invoice;
  if (
    !inv.finalName ||
    !inv.folderCode ||
    !inv.folderLabel ||
    !inv.invoiceDate
  ) {
    return {
      uploaded: false,
      drivePath: inv.drivePath,
      reason: "incomplete_classification",
    };
  }
  if (!data.attachmentB64) {
    return {
      uploaded: false,
      drivePath: inv.drivePath,
      reason: "no_pdf",
    };
  }
  const token = await getDriveAccessToken();
  if (!token) {
    return {
      uploaded: false,
      drivePath: inv.drivePath,
      reason: "drive_not_configured",
    };
  }
  const pdfBuffer = Buffer.from(data.attachmentB64, "base64");
  const up = await uploadInvoiceToDrive({
    pdfBuffer,
    finalName: inv.finalName,
    invoiceDateIso: inv.invoiceDate,
    folderCode: inv.folderCode,
    folderLabel: inv.folderLabel,
  });
  await updateInvoice(invoiceId, {
    drivePath: up.drivePath,
    status: "matched",
  });
  return { uploaded: true, drivePath: up.drivePath };
}

export type AutoProcessInput = {
  invoiceId: string;
  fromEmail: string;
  subject: string;
  receivedAt: string;
  pdfBase64: string;
  mappings: FolderMapping[];
  driveFolderCache?: DriveFolderCache; // partagé entre invoices du même run
  /** Mode brouillon : skip le upload Drive même si la facture est matchée.
   *  Utilisé par /import pour laisser l'utilisateur valider chaque facture
   *  manuellement avant de pousser sur Drive. */
  skipDrive?: boolean;
};

export type NearMissInfo = {
  row: number;
  currency: string;
  /** Montant + devise de la ligne Excel (peut être négatif = débit). */
  excelAmount: number | null;
  /** Date de la ligne Excel (YYYY-MM-DD). */
  excelDate: string | null;
  /** Montant extrait du PDF (facture). */
  invoiceAmount: number | null;
  /** Devise extraite du PDF. */
  invoiceCurrency: string | null;
  /** Date extraite du PDF. */
  invoiceDate: string | null;
};

export type AutoProcessOutcome = {
  status: InvoiceStatus;
  classified: boolean;
  uploadedToDrive: boolean;
  matchedExcelRow: number | null;
  errors: string[];
  /** Ligne "presque" (near-miss) proposée par le matcher quand aucun match
   *  strict n'a été trouvé. Sert à pré-remplir l'input /import + afficher
   *  les valeurs Excel vs facture côte-à-côte, avec un critère colorié en
   *  vert quand il matche. */
  nearMiss?: NearMissInfo | null;
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

  // RÈGLE : on n'uploade sur Drive QUE si la facture est rapprochée à
  // une ligne Excel. Les factures non rapprochées restent dans le sas
  // (status "renamed") en attente d'un match manuel via /excel.
  //
  // L'upload Drive est donc déplacé APRÈS le match Excel ci-dessous.
  let drivePath: string | null = null;
  let uploaded = false;

  // ---- 3. Match Excel (cross-currency) ----
  // On cherche dans les 3 sheets dans l'ordre EUR > CHF > USD parce
  // que la devise du PDF (USD/CHF/EUR) n'indique PAS sur quel compte
  // bancaire le débit a été fait — ça dépend de la carte liée. Le
  // premier match gagne, et l'accountCurrency de la facture est mis
  // à la devise du sheet matché.
  //
  // IMPORTANT : on n'utilise PAS receivedAt comme fallback si
  // invoiceDate est manquante. Sinon une facture mal datée serait
  // matchée contre les sheets du mois courant (ou de la date de
  // réception du mail) → faux match. Sans invoiceDate fiable, on
  // skip le match auto et l'utilisateur valide manuellement.
  const month = extracted.invoiceDate
    ? extracted.invoiceDate.slice(0, 7)
    : null;
  let matchedRow: number | null = null;
  let matchedCurrency: AccountCurrency | null = null;
  if (!month) {
    errors.push(
      "match: date de facture introuvable — match auto skip, à rapprocher manuellement.",
    );
  }

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

  type NearMiss = {
    currency: AccountCurrency;
    rowIndex: number;
    score: number;
    reasons: string[];
    excelAmount: number | null;
    excelDate: string | null;
  };
  let bestNearMiss: NearMiss | null = null;

  if (month) {
    for (const currency of EXCEL_SEARCH_ORDER) {
      try {
        const sheet = await getExcelSheet(month, currency);
        if (!sheet) continue;
        // Lignes déjà revendiquées dans ce mois/devise par d'autres factures
        // (matched OU drafts /import avec une ligne proposée). Sert à éviter
        // que 2 reçus Runpod du 28/01 tombent tous les deux sur la ligne 14
        // alors que la 15 existe pour la 2e transaction.
        const excludeRowIndices = await getOccupiedExcelRows({
          invoiceMonth: month,
          accountCurrency: currency,
          excludeInvoiceId: input.invoiceId,
        });

        // RÈGLE STRICTE (depuis juillet 2026, cf. demande user) :
        // match SI ET SEULEMENT SI amount ±20% ET date ±2j. Sinon → pas
        // de proposition, tri manuel côté utilisateur. Plus de créditeur
        // dans le scoring, plus de multi-passes fragiles.
        const matches = matchInvoicesAgainstSheet(
          { headers: sheet.headers, rows: sheet.rows },
          [dummy],
          { excludeRowIndices },
        );

        if (matches.length > 0) {
          matchedRow = matches[0].rowIndex + 2;
          matchedCurrency = currency;
          const excelAmount = matches[0].excelAmount;
          const excelDate = matches[0].excelDate;
          if (excelAmount != null && Number.isFinite(excelAmount)) {
            patch.amount = Math.abs(excelAmount);
          }
          // On populate bestNearMiss même en cas de match strict — c'est ce
          // que la /import affiche en bloc structuré (Excel vs facture,
          // avec critère vert quand il matche). Les 2 critères devraient
          // logiquement être verts ici (règle stricte satisfaite).
          bestNearMiss = {
            currency,
            rowIndex: matchedRow,
            score: 1,
            reasons: matches[0].reasons,
            excelAmount,
            excelDate,
          };
          break;
        } else {
          // Aucune ligne ne respecte la règle stricte → on note la ligne
          // la plus proche pour info (diagnostic seulement).
          const candidate = findBestCandidate(
            { headers: sheet.headers, rows: sheet.rows },
            dummy,
            { excludeRowIndices },
          );
          if (
            candidate &&
            (!bestNearMiss || candidate.score > bestNearMiss.score)
          ) {
            bestNearMiss = {
              currency,
              rowIndex: candidate.result.rowIndex + 2,
              score: candidate.score,
              reasons: candidate.result.reasons,
              excelAmount: candidate.result.excelAmount,
              excelDate: candidate.result.excelDate,
            };
          }
        }
      } catch (e) {
        errors.push(`excel(${currency}): ${(e as Error).message}`);
      }
    }
  }

  // Si match trouvé : l'accountCurrency vient du sheet, pas du PDF.
  // Le bloc "match avec ligne X — montant/date" est rendu côté /import
  // via NearMissDisplay à partir du champ `nearMiss` du outcome — plus
  // besoin de dupliquer en text dans errors[].
  if (matchedCurrency) {
    patch.accountCurrency = matchedCurrency;
  }

  // ---- 4b. Dédoublonnage facture / reçu ----
  // Quand un fournisseur envoie un invoice ET un receipt pour la même
  // opération bancaire, on a 2 invoices en DB qui ciblent la même ligne
  // Excel. On garde la plus ancienne (typiquement la facture, arrivée
  // avant le reçu) et on supprime les autres.
  //
  // EXCEPTION : en mode draft /import (skipDrive), on NE SUPPRIME RIEN.
  // L'utilisateur est en mode revue → il voit tous ses uploads et décide
  // lui-même quoi supprimer. Sans ça, un upload de 149 PDFs dont 18 sont
  // des doublons d'invoices déjà matched → 18 disparaissent silencieusement
  // (le user voit 131 au lieu de 149 sans comprendre pourquoi).
  let deletedAsDuplicateOf: string | null = null;
  const deletedOtherIds: string[] = [];
  if (matchedRow !== null && matchedCurrency && month && !input.skipDrive) {
    try {
      const others = await findInvoicesMatchingRow({
        excludeId: input.invoiceId,
        accountCurrency: matchedCurrency,
        rowIndex: matchedRow,
        // Scope au mois de la facture courante — la ligne #N de mars n'est
        // PAS la même que la ligne #N de janvier. Sans ce filtre, on
        // supprime à tort des factures comme doublons inter-mois.
        invoiceMonth: month,
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

  // ---- 5. Upload Drive — UNIQUEMENT si la facture est rapprochée ----
  // Règle métier : on ne classe que ce qui est validé contre la banque.
  // Sans match, le PDF reste en base mais n'est pas envoyé sur Drive.
  //
  // Mode brouillon (skipDrive=true, ex. /import) : on saute l'upload même
  // si matché. L'utilisateur valide manuellement après review, ce qui
  // déclenche l'upload via /api/invoices/[id]/assign-row.
  if (matchedRow !== null && !input.skipDrive) {
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
  }

  // ---- Status final ----
  // - matched  → ligne Excel trouvée → uploadé sur Drive si possible
  // - renamed  → pas de match Excel → reste dans le sas, pas sur Drive
  //
  // Mode brouillon (skipDrive) : status reste "renamed" tant que l'user
  // n'a pas validé. MAIS on stocke quand même excelRowMatched (la ligne
  // proposée par l'auto-match) en DB — sinon le prochain upload du même
  // créditeur/jour ne saurait pas que cette ligne est déjà revendiquée
  // et tomberait dessus en collision (cas 2 reçus Runpod 28/01).
  let finalStatus: InvoiceStatus;
  if (input.skipDrive) {
    finalStatus = "renamed";
  } else if (matchedRow !== null) {
    finalStatus = "matched";
  } else {
    finalStatus = "renamed";
  }

  const dbRowMatched = matchedRow;

  await updateInvoice(input.invoiceId, {
    ...patch,
    excelRowMatched: dbRowMatched,
    status: finalStatus,
  });

  return {
    status: finalStatus,
    classified: true,
    uploadedToDrive: uploaded,
    // On retourne TOUJOURS le match proposé pour que l'UI puisse l'afficher
    // — même en draft où il n'est pas écrit en DB.
    matchedExcelRow: matchedRow,
    // Near-miss (structured) pour que /import pré-remplisse le n° ligne
    // + colorie les critères qui matchent (date verte quand date matche etc.).
    nearMiss: bestNearMiss
      ? {
          row: bestNearMiss.rowIndex,
          currency: bestNearMiss.currency,
          excelAmount: bestNearMiss.excelAmount,
          excelDate: bestNearMiss.excelDate,
          invoiceAmount: extracted.amount,
          invoiceCurrency: extracted.currency,
          invoiceDate: extracted.invoiceDate,
        }
      : null,
    errors,
    deletedAsDuplicateOf,
    deletedOtherIds,
  };
}
