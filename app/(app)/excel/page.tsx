"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useStore,
  useInvoicesForCurrentMonth,
  formatMonthLabel,
} from "@/lib/store";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Download, Trash2, Search } from "lucide-react";
import * as XLSX from "xlsx";
import {
  computeExpenseTotal,
  detectColumns,
  matchInvoicesAgainstSheet,
  type MatchResult,
  type ParsedSheet,
} from "@/lib/excel-match";
import { formatAmount } from "@/lib/format";
import {
  formatShortDate,
  formatSignedAmount,
  rowAmount,
  rowDescription,
  sheetColumns,
  shortDescription,
} from "@/lib/excel-row-display";
import type { Invoice, AccountCurrency } from "@/lib/types";
import { ACCOUNT_CURRENCIES } from "@/lib/types";

// Les fichiers comptables de la banque commencent par 9 lignes d'en-tête
// (numéro de compte, IBAN, libellés, etc.) avant les vraies lignes de
// transactions. On les soustrait pour afficher le bon nombre de positions.
const HEADER_ROWS = 9;
function dataRowCount(total: number): number {
  return Math.max(0, total - HEADER_ROWS);
}

export default function ExcelPage() {
  const { updateInvoice, reloadFromDb, selectedMonth } = useStore();
  const allMonthInvoices = useInvoicesForCurrentMonth();
  const fileRef = useRef<HTMLInputElement>(null);
  // Devise locale à la page — pas de sélecteur global. L'utilisateur
  // choisit ici dans quel "bucket" (CHF / EUR / USD) il dépose son fichier.
  const [currency, setCurrency] = useState<AccountCurrency>("USD");
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [loadingPersisted, setLoadingPersisted] = useState(false);
  const [persistedAt, setPersistedAt] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);

  // Recharge depuis la DB quand le mois ou la devise sélectionnée change.
  useEffect(() => {
    let cancelled = false;
    setSheet(null);
    setFileName(null);
    setWorkbook(null);
    setSheetNames([]);
    setActiveSheet("");
    setPersistedAt(null);
    setLoadingPersisted(true);
    (async () => {
      try {
        const r = await fetch(
          `/api/excel-sheets/${selectedMonth}?currency=${currency}`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        if (!r.ok) return;
        const data = (await r.json()) as {
          sheet: {
            month: string;
            fileName: string;
            headers: string[];
            rows: (string | number | null)[][];
            uploadedAt: string;
          } | null;
        };
        if (cancelled || !data.sheet) return;
        setFileName(data.sheet.fileName);
        setSheet({ headers: data.sheet.headers, rows: data.sheet.rows });
        setPersistedAt(data.sheet.uploadedAt);
      } finally {
        if (!cancelled) setLoadingPersisted(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMonth, currency]);

  // On ne tente de rapprocher que les factures déclarées sur ce compte.
  const invoices = useMemo<Invoice[]>(
    () =>
      allMonthInvoices.filter((i) => (i.accountCurrency ?? "USD") === currency),
    [allMonthInvoices, currency],
  );

  const matches = useMemo<MatchResult[]>(() => {
    if (!sheet) return [];
    return matchInvoicesAgainstSheet(sheet, invoices);
  }, [sheet, invoices]);

  // Source de vérité pour les lignes vertes : les factures VALIDÉES en DB
  // (status='matched' + excel_row_matched non-null + accountCurrency ===
  // currency). Le matcher live sert seulement de complément pour proposer
  // des matches sur des factures pas encore validées — sinon une facture
  // validée manuellement (via /import ou /assign-row) qui ne passe pas
  // le seuil du matcher live n'apparaîtrait pas en vert alors qu'elle
  // devrait.
  const matchedRows = useMemo(() => {
    const map = new Map<number, MatchResult>();
    // Étape 1 : hydrate depuis la DB (invoices déjà matchées).
    for (const inv of invoices) {
      if (inv.status !== "matched") continue;
      if (inv.excelRowMatched == null) continue;
      // excel_row_matched est stocké en N° Excel humain (1-based avec en-tête).
      // rowIndex = N° Excel - 2 (0-based dans sheet.rows[]).
      const rowIdx = inv.excelRowMatched - 2;
      if (rowIdx < 0) continue;
      map.set(rowIdx, {
        rowIndex: rowIdx,
        invoice: inv,
        confidence: "high",
        reasons: ["validé"],
        excelAmount: null,
        excelDate: null,
      });
    }
    // Étape 2 : complète avec le matcher live pour les factures pas
    // encore matched — sans écraser les entrées DB déjà posées.
    for (const m of matches) {
      if (!map.has(m.rowIndex)) map.set(m.rowIndex, m);
    }
    return map;
  }, [matches, invoices]);

  // Totaux du fichier courant (somme des débits = dépenses du compte).
  const expenseTotals = useMemo(
    () =>
      sheet
        ? computeExpenseTotal(sheet)
        : {
            totalDebit: 0,
            totalCredit: 0,
            debitRowCount: 0,
            creditRowCount: 0,
            rowDebits: [] as number[],
          },
    [sheet],
  );

  // Liste "Factures sans ligne correspondante" : on inclut aussi les
  // factures des AUTRES devises du même mois, avec un badge visible.
  // Contexte : quand une facture est en USD mais que la ligne banque
  // correspondante est en EUR (cas conversion), la facture n'apparaissait
  // pas sur /excel EUR → impossible à valider depuis là. On l'affiche
  // maintenant, et cliquer "Valider" bascule automatiquement son
  // accountCurrency vers la devise du fichier Excel courant.
  //
  // On exclut aussi celles déjà en 'matched' (peu importe leur row/currency
  // actuels) pour ne pas les proposer une deuxième fois.
  const unmatchedInvoices = useMemo<Invoice[]>(() => {
    const matchedIds = new Set(matches.map((m) => m.invoice.id));
    return allMonthInvoices
      .filter((i) => i.creditor && ["classified", "renamed", "uploaded"].includes(i.status))
      .filter((i) => !matchedIds.has(i.id))
      // Tri : d'abord même devise que le compte affiché, puis autres.
      .sort((a, b) => {
        const aSame = (a.accountCurrency ?? "USD") === currency;
        const bSame = (b.accountCurrency ?? "USD") === currency;
        if (aSame !== bSame) return aSame ? -1 : 1;
        return 0;
      });
  }, [matches, allMonthInvoices, currency]);

  // Factures archivées ("fichier 0") pour ce mois — toutes devises confondues.
  // Elles sortent de la vue "à traiter" mais restent en DB, restaurables.
  const archivedInvoices = useMemo<Invoice[]>(() => {
    return allMonthInvoices.filter((i) => i.status === "archived");
  }, [allMonthInvoices]);

  const loadSheet = (wb: XLSX.WorkBook, name: string) => {
    const ws = wb.Sheets[name];
    const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: null,
      raw: true,
    }) as (string | number | null)[][];
    if (rows.length === 0) {
      setSheet({ headers: [], rows: [] });
      return;
    }
    const headers = rows[0].map((v) => String(v ?? ""));
    setSheet({ headers, rows: rows.slice(1) });
  };

  const persistSheet = async (
    parsed: ParsedSheet,
    name: string,
  ): Promise<void> => {
    // Convertit les Date du parsing xlsx en chaîne ISO pour pouvoir
    // sérialiser en JSONB et les ré-afficher au prochain chargement.
    const safeRows: (string | number | null)[][] = parsed.rows.map((row) =>
      row.map((c) => {
        if (c == null) return null;
        const anyC = c as unknown;
        if (anyC instanceof Date) return (anyC as Date).toISOString();
        if (typeof c === "number") return c;
        return String(c);
      }),
    );
    setPersistError(null);
    try {
      const r = await fetch(
        `/api/excel-sheets/${selectedMonth}?currency=${currency}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: name,
            headers: parsed.headers,
            rows: safeRows,
          }),
        },
      );
      if (r.ok) {
        setPersistedAt(new Date().toISOString());
      } else {
        const txt = await r.text();
        setPersistError(
          `Sauvegarde DB échouée (HTTP ${r.status}). ${txt.slice(0, 200)}`,
        );
      }
    } catch (e) {
      setPersistError(`Sauvegarde DB échouée : ${(e as Error).message}`);
    }
  };

  const onFile = async (f: File) => {
    setFileName(f.name);
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { cellDates: true });
    setWorkbook(wb);
    setSheetNames(wb.SheetNames);
    const first = wb.SheetNames[0];
    setActiveSheet(first);
    // loadSheet met `sheet` à jour ET on persiste en parallèle.
    const ws = wb.Sheets[first];
    const rows: (string | number | null)[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: null,
      raw: true,
    }) as (string | number | null)[][];
    const headers =
      rows.length === 0 ? [] : rows[0].map((v) => String(v ?? ""));
    const parsed: ParsedSheet = {
      headers,
      rows: rows.length === 0 ? [] : rows.slice(1),
    };
    setSheet(parsed);
    void persistSheet(parsed, f.name);
  };

  const removePersisted = async () => {
    if (
      !confirm(
        `Supprimer le fichier Excel ${currency} pour ${formatMonthLabel(selectedMonth)} ?`,
      )
    )
      return;
    await fetch(
      `/api/excel-sheets/${selectedMonth}?currency=${currency}`,
      { method: "DELETE" },
    );
    setSheet(null);
    setFileName(null);
    setWorkbook(null);
    setPersistedAt(null);
  };

  const applyMatchesToInvoices = () => {
    matches.forEach((m) => {
      updateInvoice(m.invoice.id, {
        excelRowMatched: m.rowIndex + 2, // +1 for header, +1 for 1-based
        status: "matched",
        accountCurrency: currency, // assure que la facture est bien rattachée à ce compte
      });
    });
    unmatchedInvoices.forEach((i) => {
      updateInvoice(i.id, { status: "manual" });
    });
  };

  const downloadHighlighted = async () => {
    if (!sheet) return;
    // ExcelJS supporte le styling cellule par cellule, contrairement à
    // xlsx community. On reproduit le fichier original + colonne
    // "Rapprochement" + fond vert sur les lignes matchées.
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Rapprochement");

    // Row 1 : headers
    const headerRow = ws.addRow([...sheet.headers, "Rapprochement"]);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE6E8EB" }, // gris clair
    };

    // Data rows
    sheet.rows.forEach((row, idx) => {
      const m = matchedRows.get(idx);
      const cells = [
        ...row.map((c) => {
          // Convertit les dates ISO en objet Date pour qu'Excel les
          // reconnaisse comme dates et pas comme texte.
          if (typeof c === "string" && /^\d{4}-\d{2}-\d{2}T/.test(c)) {
            const d = new Date(c);
            if (!Number.isNaN(d.getTime())) return d;
          }
          return c;
        }),
        m ? `✓ ${m.invoice.creditor} (${m.confidence})` : "",
      ];
      const xRow = ws.addRow(cells);
      if (m) {
        // Vert clair sur toute la ligne — pareil que le code de couleur
        // de l'UI (bg-ok/0.07).
        xRow.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFD4F1DC" }, // vert très clair
          };
        });
      }
    });

    // Auto-fit colonnes (largeur max 50 char, min 10)
    ws.columns.forEach((col) => {
      let max = 10;
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        const len =
          v == null
            ? 0
            : typeof v === "string"
            ? v.length
            : typeof v === "number"
            ? String(v).length
            : 10;
        if (len > max) max = len;
      });
      col.width = Math.min(50, max + 2);
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(fileName ?? "rapprochement").replace(/\.[^.]+$/, "")}-matched.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="px-8 pt-5 pb-8 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Picker de devise — 3 onglets visuels CHF / EUR / USD */}
          <div className="card !rounded-full p-1.5 flex items-center gap-1 w-fit">
            {ACCOUNT_CURRENCIES.map((c) => (
              <button
                key={c}
                onClick={() => setCurrency(c)}
                className={`px-5 py-2 rounded-full text-[13px] font-semibold transition-colors ${
                  currency === c
                    ? "bg-accent text-white shadow-[0_10px_22px_-12px_hsl(var(--accent)/0.8)]"
                    : "text-muted hover:text-text hover:bg-panel2"
                }`}
              >
                {c}
              </button>
            ))}
            <div className="text-[11px] text-muted px-3">
              Mois : <span className="text-text">{formatMonthLabel(selectedMonth)}</span>
            </div>
          </div>
          {sheet && (
            <div className="ml-auto flex items-center gap-3">
              <button onClick={applyMatchesToInvoices} className="btn btn-primary">
                <CheckCircle2 size={14} /> Appliquer ({matches.length})
              </button>
              <button onClick={downloadHighlighted} className="btn">
                <Download size={14} /> Exporter
              </button>
            </div>
          )}
        </div>

        {loadingPersisted ? (
          <div className="card p-12 text-center text-muted text-[13px]">
            Chargement du fichier {currency} sauvegardé pour {formatMonthLabel(selectedMonth)}…
          </div>
        ) : !sheet ? (
          <Dropzone currency={currency} onFile={onFile} onPick={() => fileRef.current?.click()} />
        ) : (
          <>
            <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 items-stretch">
            <div className="card px-3 py-2 flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-panel2 border border-border flex items-center justify-center shrink-0">
                <FileSpreadsheet size={15} className="text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium flex items-center gap-2 min-w-0">
                  <span className="truncate">{fileName}</span>
                  {persistedAt && !persistError && (
                    <span className="badge ok text-[10px] shrink-0" title={`Sauvé le ${new Date(persistedAt).toLocaleString("fr-CH")}`}>
                      Sauvé en DB
                    </span>
                  )}
                  {persistError && (
                    <span className="badge err text-[10px] shrink-0">Pas sauvé</span>
                  )}
                </div>
                {persistError && (
                  <div className="text-[11px] text-err mt-1">{persistError}</div>
                )}
              </div>
              {sheetNames.length > 1 && (
                <select
                  className="input !w-44"
                  value={activeSheet}
                  onChange={(e) => {
                    if (!workbook) return;
                    setActiveSheet(e.target.value);
                    loadSheet(workbook, e.target.value);
                  }}
                >
                  {sheetNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
              <button
                className="btn !py-1"
                onClick={() => fileRef.current?.click()}
                title="Remplacer par un nouveau fichier"
              >
                <Upload size={12} /> Remplacer
              </button>
              {persistedAt && (
                <button
                  className="btn !px-2 !py-1"
                  onClick={removePersisted}
                  title="Supprimer le fichier sauvegardé"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>

              <div className="card px-4 py-2 flex items-center justify-between gap-3">
                <div className="text-[11px] text-muted">Rapprochées</div>
                <div className="text-[20px] font-semibold leading-none tabular-nums whitespace-nowrap">
                  <span className="text-ok">{matches.length}</span>
                  <span className="text-muted text-[15px]"> / {dataRowCount(sheet.rows.length)}</span>
                </div>
              </div>
              <StatTile
                label="Total dépenses"
                value={formatAmount(expenseTotals.totalDebit, currency)}
                tone="warn"
                hint={`${expenseTotals.debitRowCount} débit${expenseTotals.debitRowCount > 1 ? "s" : ""} · ${formatAmount(expenseTotals.totalCredit, currency)} de crédits`}
              />
            </div>

            <ColumnsMini sheet={sheet} />

            <SheetTable
              sheet={sheet}
              matchedRows={matchedRows}
              month={selectedMonth}
              currency={currency}
            />

            {unmatchedInvoices.length > 0 && (
              <section className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                  <AlertCircle size={14} className="text-warn" />
                  <div className="text-[13px] font-medium">Factures sans ligne correspondante</div>
                  <button
                    onClick={async () => {
                      if (
                        !confirm(
                          `Envoyer ${unmatchedInvoices.length} facture(s) non-validée(s) de ${formatMonthLabel(selectedMonth)} dans le « Fichier 0 » (archivées, sortent de cette vue) ?\n\nRéversible ligne par ligne via le bouton « Restaurer ».`,
                        )
                      )
                        return;
                      const r = await fetch(`/api/invoices/archive-unmatched`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          startMonth: selectedMonth,
                          endMonth: selectedMonth,
                        }),
                      });
                      if (!r.ok) {
                        alert(`Archivage échoué (HTTP ${r.status}).`);
                        return;
                      }
                      await reloadFromDb();
                    }}
                    className="btn !py-1 !px-2.5 text-[11px] ml-auto"
                    title={`Passer les ${unmatchedInvoices.length} factures non-validées de ce mois dans le Fichier 0.`}
                  >
                    Tout envoyer au Fichier 0
                  </button>
                  <span className="text-[11px] text-muted">
                    Tape le n° de la ligne Excel à droite pour rapprocher
                    manuellement.
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {unmatchedInvoices.map((i) => (
                    <UnmatchedRow
                      key={i.id}
                      invoice={i}
                      currentCurrency={currency}
                      onAssign={async (rowNumber) => {
                        // Match manuel → update DB + upload Drive
                        // (règle : pas de match = pas de drive).
                        const r = await fetch(
                          `/api/invoices/${i.id}/assign-row`,
                          {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              rowNumber,
                              accountCurrency: currency,
                            }),
                          },
                        );
                        if (!r.ok) {
                          const data = (await r.json().catch(() => null)) as
                            | { message?: string }
                            | null;
                          alert(
                            `Match impossible : ${data?.message ?? `HTTP ${r.status}`}`,
                          );
                          return;
                        }
                        const data = (await r.json()) as {
                          drive?: { uploaded?: boolean; reason?: string };
                        };
                        await reloadFromDb();
                        if (data.drive && !data.drive.uploaded) {
                          alert(
                            `Match enregistré, mais upload Drive non effectué (${data.drive.reason ?? "raison inconnue"}). La facture reste en DB.`,
                          );
                        }
                      }}
                      onDelete={async () => {
                        // Suppression définitive — l'utilisateur dit que
                        // ce n'est pas une vraie facture (faux positif Gmail).
                        const r = await fetch(`/api/invoices/${i.id}`, {
                          method: "DELETE",
                        });
                        if (!r.ok) {
                          alert(
                            `Impossible de supprimer (HTTP ${r.status}). Réessaie.`,
                          );
                          return;
                        }
                        await reloadFromDb();
                      }}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Section "Fichier 0" — factures archivées (non-traitables mais
                gardées en DB). Badge jaune, restaurable au clic. */}
            {archivedInvoices.length > 0 && (
              <section className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded border"
                    style={{
                      background: "rgba(234, 179, 8, 0.12)",
                      borderColor: "rgba(234, 179, 8, 0.4)",
                      color: "rgb(234, 179, 8)",
                    }}
                    title="Fichier 0 : dépôt des factures que l'utilisateur a mises de côté (ne correspondent à rien de traitable). Restaurable ligne par ligne."
                  >
                    Fichier 0
                  </span>
                  <div className="text-[13px] font-medium">
                    Factures archivées ({archivedInvoices.length})
                  </div>
                  <span className="text-[11px] text-muted ml-auto">
                    Sorties de la vue « à traiter ». Clique « Restaurer » pour
                    les renvoyer dans la liste normale.
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {archivedInvoices.map((i) => (
                    <ArchivedRow
                      key={i.id}
                      invoice={i}
                      onRestore={async () => {
                        const r = await fetch(`/api/invoices/unarchive`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ id: i.id }),
                        });
                        if (!r.ok) {
                          alert(`Restauration échouée (HTTP ${r.status}).`);
                          return;
                        }
                        await reloadFromDb();
                      }}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
      </div>
    </>
  );
}

/**
 * Ligne du bandeau "Fichier 0" — facture archivée (mise de côté par l'user).
 * Affichage read-only avec un bouton "Restaurer" qui la repasse en 'renamed'
 * pour la remettre dans la liste normale.
 */
function ArchivedRow({
  invoice,
  onRestore,
}: {
  invoice: Invoice;
  onRestore: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const restore = async () => {
    setBusy(true);
    try {
      await onRestore();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="px-5 py-2.5 flex items-center gap-3 text-[12px] opacity-80">
      <span className="w-1 h-4 rounded shrink-0" style={{ background: "rgb(234, 179, 8)" }} />
      <span className="font-medium truncate max-w-[180px]" title={invoice.creditor ?? undefined}>
        {invoice.creditor ?? "—"}
      </span>
      <span className="text-muted truncate flex-1 min-w-0" title={invoice.subject}>
        — {invoice.subject}
      </span>
      <span className="font-mono text-muted text-right">
        {invoice.amount != null ? `${invoice.amount} ${invoice.currency ?? ""}` : "—"}
      </span>
      <span className="text-[10px] text-muted">
        {invoice.invoiceDate?.slice(0, 10) ?? "sans date"}
      </span>
      <button
        onClick={restore}
        disabled={busy}
        className="btn !py-1 !px-2.5 text-[11px] disabled:opacity-50"
        title="Repasser la facture dans la vue « à traiter »."
      >
        {busy ? "…" : "Restaurer"}
      </button>
    </div>
  );
}

/**
 * Une ligne du bandeau "Factures sans ligne correspondante". Chaque facture
 * a son propre input local pour taper le n° de ligne Excel et un bouton
 * Valider qui appelle `onAssign(rowNumber)`. Après validation, le parent
 * recharge depuis la DB et la facture remonte automatiquement dans les
 * lignes vertes (puisque son status devient "matched").
 */
function UnmatchedRow({
  invoice,
  currentCurrency,
  onAssign,
  onDelete,
}: {
  invoice: Invoice;
  /** Devise du compte affiché sur /excel — pour détecter le cross-currency. */
  currentCurrency: AccountCurrency;
  onAssign: (rowNumber: number) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [row, setRow] = useState("");
  const [busy, setBusy] = useState(false);
  const invoiceAccount = invoice.accountCurrency ?? "USD";
  const crossCurrency = invoiceAccount !== currentCurrency;

  const submit = async () => {
    const n = parseInt(row.trim(), 10);
    if (!Number.isFinite(n) || n < 2) {
      alert("Entre un n° de ligne valide (≥ 2 — la ligne 1 étant l'en-tête).");
      return;
    }
    if (crossCurrency) {
      if (
        !confirm(
          `Cette facture est actuellement rattachée au compte ${invoiceAccount}. ` +
            `Valider ici la basculera sur le compte ${currentCurrency} ` +
            `(utile quand tu as payé une facture ${invoiceAccount} depuis ton compte ${currentCurrency}).\n\n` +
            `Continuer ?`,
        )
      ) {
        return;
      }
    }
    setBusy(true);
    try {
      await onAssign(n);
      setRow("");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !confirm(
        `Supprimer définitivement cette ligne ?\n\n${invoice.creditor ?? ""} — ${invoice.subject}\n\nC'est pour quand un mail a été détecté comme facture à tort (faux positif). L'invoice sera enlevée du système.`,
      )
    )
      return;
    setBusy(true);
    try {
      await onDelete();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-5 py-2.5 flex items-center gap-3 text-[12px]">
      <span className="font-medium truncate max-w-[180px]" title={invoice.creditor ?? undefined}>
        {invoice.creditor}
      </span>
      {crossCurrency && (
        <span
          className="text-[10px] px-1.5 py-0.5 rounded border border-warn/40 text-warn bg-warn/10 shrink-0"
          title={`Facture rattachée au compte ${invoiceAccount}. Valider ici la basculera sur ${currentCurrency}.`}
        >
          compte {invoiceAccount} → {currentCurrency}
        </span>
      )}
      <span className="text-muted truncate flex-1 min-w-0" title={invoice.subject}>
        — {invoice.subject}
      </span>
      <span className="font-mono text-muted text-right">
        {invoice.amount} {invoice.currency}
      </span>
      <div className="flex items-center gap-1.5 ml-2">
        <input
          type="number"
          min={2}
          placeholder="N° ligne"
          value={row}
          onChange={(e) => setRow(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          disabled={busy}
          className="input !py-1 !px-2 text-[11px] !w-24"
          title="N° de ligne Excel à rapprocher (colonne « # »)"
        />
        <button
          onClick={submit}
          disabled={busy || !row.trim()}
          className="btn !py-1 !px-2.5 text-[11px] disabled:opacity-50"
          title="Forcer le rapprochement à cette ligne"
        >
          {busy ? "…" : "Valider"}
        </button>
        <button
          onClick={remove}
          disabled={busy}
          className="btn !py-1 !px-2 text-[11px] disabled:opacity-50 hover:!border-err hover:text-err"
          title="Ce n'est pas une vraie facture — supprimer du système"
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

function Dropzone({
  currency,
  onFile,
  onPick,
}: {
  currency: AccountCurrency;
  onFile: (f: File) => void;
  onPick: () => void;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        onClick={onPick}
        className={`card border-dashed cursor-pointer transition-colors p-16 text-center ${
          drag ? "!border-accent2 bg-panel2" : "hover:bg-panel2"
        }`}
      >
        <div className="w-14 h-14 rounded-full bg-panel2 border border-border mx-auto mb-4 flex items-center justify-center">
          <Upload size={22} className="text-accent" />
        </div>
        <div className="text-[15px] font-medium">
          Dépose ici le fichier comptable <span className="font-mono text-accent">{currency}</span>
        </div>
        <div className="text-[12px] text-muted mt-1">
          .xlsx, .xls ou .csv — la première ligne doit contenir les en-têtes.
        </div>
        <button className="btn btn-primary mt-5">
          <Upload size={14} /> Parcourir
        </button>
      </div>
      <SampleHint />
    </>
  );
}

function SampleHint() {
  const { selectedMonth } = useStore();
  return (
    <div className="text-center text-[11px] text-muted">
      Pas de fichier sous la main ?{" "}
      <a
        href={`/api/sample-excel?month=${selectedMonth}`}
        className="text-accent hover:underline"
      >
        télécharge un exemple pour {formatMonthLabel(selectedMonth)}
      </a>{" "}
      pré-rempli avec les factures de démonstration.
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: number | string;
  tone?: "neutral" | "ok" | "warn";
  hint?: string;
}) {
  const toneClass = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-text";
  return (
    <div className="card px-4 py-2 flex items-center justify-between gap-3 min-w-0">
      <div className="min-w-0">
        <div className="text-[11px] text-muted">{label}</div>
        {hint && <div className="text-[10px] text-muted truncate">{hint}</div>}
      </div>
      <div className={`text-[20px] font-semibold leading-none tabular-nums whitespace-nowrap ${toneClass}`}>{value}</div>
    </div>
  );
}

type Assignee = "gauthier" | "robin" | "jacqueline" | "a_creer";
const ASSIGNEE_LABEL: Record<Assignee, string> = {
  gauthier: "Gauthier",
  robin: "Robin",
  jacqueline: "Maman",
  a_creer: "À créer",
};
const ASSIGNEE_TONE: Record<Assignee, string> = {
  gauthier: "text-indigo-400 border-indigo-500/40 bg-indigo-500/10",
  robin: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  jacqueline: "text-pink-400 border-pink-500/40 bg-pink-500/10",
  a_creer: "text-sky-400 border-sky-500/40 bg-sky-500/10",
};

function SheetTable({
  sheet,
  matchedRows,
  month,
  currency,
}: {
  sheet: ParsedSheet;
  matchedRows: Map<number, MatchResult>;
  month: string;
  currency: AccountCurrency;
}) {
  const [query, setQuery] = useState("");
  // Attributions chargées pour ce (mois × devise). Clé : rowNumber (idx+2).
  const [assigns, setAssigns] = useState<Map<number, Assignee>>(new Map());

  useEffect(() => {
    let cancelled = false;
    setAssigns(new Map());
    (async () => {
      try {
        const r = await fetch(
          `/api/row-assignments?month=${month}&currency=${currency}`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const data = (await r.json()) as {
          assignments: { rowNumber: number; assignee: Assignee }[];
        };
        if (cancelled) return;
        setAssigns(new Map(data.assignments.map((a) => [a.rowNumber, a.assignee])));
      } catch {
        /* silencieux */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [month, currency]);

  async function setAssignee(rowNumber: number, next: Assignee | null) {
    // Optimiste.
    setAssigns((p) => {
      const m = new Map(p);
      if (next) m.set(rowNumber, next);
      else m.delete(rowNumber);
      return m;
    });
    try {
      if (next === null) {
        await fetch(`/api/row-assignments`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ month, currency, row: rowNumber }),
        });
      } else {
        const r = await fetch(`/api/row-assignments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            month,
            currency,
            row: rowNumber,
            assignee: next,
            cascade: true,
          }),
        });
        if (r.ok) {
          const data = (await r.json()) as {
            cascade: { added: number } | null;
          };
          const added = data?.cascade?.added ?? 0;
          if (added > 0) {
            // Rafraîchit la carte pour montrer les cascades locales.
            const refresh = await fetch(
              `/api/row-assignments?month=${month}&currency=${currency}`,
              { cache: "no-store" },
            );
            if (refresh.ok) {
              const d = (await refresh.json()) as {
                assignments: { rowNumber: number; assignee: Assignee }[];
              };
              setAssigns(
                new Map(d.assignments.map((a) => [a.rowNumber, a.assignee])),
              );
            }
          }
        }
      }
    } catch {
      /* silencieux */
    }
  }

  // Normalise une string pour recherche insensible aux accents/case.
  const norm = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  const cols = useMemo(() => sheetColumns(sheet), [sheet]);

  // Seules les lignes de transactions : les en-têtes de la banque (solde,
  // IBAN…) restent stockés mais ne sont pas affichés. Le n° de ligne (idx+2)
  // ne change pas — il sert au rapprochement manuel et aux attributions.
  const filteredRows = useMemo(() => {
    const dataRows = sheet.rows
      .map((row, idx) => ({ row, idx }))
      .filter(({ row, idx }) => idx >= cols.dataStartRow && row.some((c) => c != null && c !== ""));
    if (!query.trim()) return dataRows;
    const q = norm(query.trim());
    return dataRows
      .filter(({ row, idx }) => {
        // Cherche dans toutes les cellules de la ligne + le créditeur
        // de la facture matchée si présente.
        for (const cell of row) {
          if (cell != null && norm(String(cell)).includes(q)) return true;
        }
        const m = matchedRows.get(idx);
        if (m?.invoice.creditor && norm(m.invoice.creditor).includes(q)) return true;
        return false;
      });
  }, [sheet.rows, query, matchedRows, cols.dataStartRow]);

  const dataRowTotal = sheet.rows.filter(
    (row, idx) => idx >= cols.dataStartRow && row.some((c) => c != null && c !== ""),
  ).length;
  const totalMatched = sheet.rows.filter((_, i) => matchedRows.has(i)).length;
  const visibleMatched = filteredRows.filter(({ idx }) => matchedRows.has(idx)).length;

  const th = "px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted font-medium whitespace-nowrap";

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[220px] max-w-md">
          <Search size={14} className="text-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un débiteur ou texte dans la ligne…"
            className="input !py-1 !px-2 text-[12px] flex-1"
            title="Filtre les lignes dont une cellule (ou le créditeur de la facture rapprochée) contient le texte saisi. Insensible aux accents et à la casse."
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="text-[11px] text-muted hover:text-text px-2"
              title="Vider la recherche"
            >
              ✕
            </button>
          )}
        </div>
        <div className="text-[11px] text-muted font-mono tabular-nums ml-auto">
          {query
            ? `${filteredRows.length} / ${dataRowTotal} ligne(s) · ${visibleMatched} rapprochée(s)`
            : `${dataRowTotal} ligne(s) · ${totalMatched} rapprochée(s)`}
        </div>
      </div>
      <div className="overflow-auto max-h-[calc(100vh-90px)] min-h-[420px]">
        <table className="w-full text-[12px] border-collapse">
          <thead className="sticky top-0 bg-panel border-b border-border z-20">
            <tr>
              <th className={`${th} w-14`}>#</th>
              <th className={`${th} w-24`}>Date</th>
              <th className={th}>Description</th>
              <th className={`${th} text-right w-32`}>Montant</th>
              <th className={th}>Facture</th>
              <th className={`${th} sticky right-0 bg-panel z-30 w-[130px] border-l border-border`}>
                Assigné à
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted italic text-[12px]">
                  {query ? `Aucune ligne ne correspond à « ${query} ».` : "Aucune opération sur ce relevé."}
                </td>
              </tr>
            )}
            {filteredRows.map(({ row, idx }) => {
              const m = matchedRows.get(idx);
              const desc = rowDescription(row, cols);
              const amount = rowAmount(row, cols);
              // Vert = facture rapprochée (prioritaire) ; jaune = tâche attribuée.
              const assigned = !m && assigns.has(idx + 2);
              const tint = m
                ? "rgba(34,197,94,0.12)"
                : assigned
                  ? "rgba(234,179,8,0.16)"
                  : null;
              return (
                <tr
                  key={idx}
                  className={
                    "border-b border-border/40 " +
                    (m
                      ? "bg-[rgba(34,197,94,0.12)] hover:bg-[rgba(34,197,94,0.18)]"
                      : assigned
                        ? "bg-[rgba(234,179,8,0.16)] hover:bg-[rgba(234,179,8,0.24)]"
                        : "hover:bg-panel2")
                  }
                >
                  <td
                    className={
                      "px-3 py-1 text-muted tabular-nums border-l-2 " +
                      (m ? "border-l-ok" : assigned ? "border-l-yellow-500" : "border-l-transparent")
                    }
                  >
                    {idx + 2}
                  </td>
                  <td className="px-3 py-1 tabular-nums whitespace-nowrap">
                    {formatShortDate(cols.idxDate >= 0 ? row[cols.idxDate] : null)}
                  </td>
                  <td className="px-3 py-1 max-w-[420px] truncate" title={desc}>
                    {shortDescription(desc)}
                  </td>
                  <td
                    className={
                      "px-3 py-1 text-right tabular-nums whitespace-nowrap font-medium " +
                      (amount != null && amount > 0 ? "text-ok" : "")
                    }
                  >
                    {formatSignedAmount(amount)}
                  </td>
                  <td className="px-3 py-1 max-w-[220px] truncate">
                    {m ? (
                      <span
                        className="inline-flex items-center gap-1.5 text-ok"
                        title={`${m.invoice.creditor ?? ""} (${m.reasons.join(", ")})`}
                      >
                        <CheckCircle2 size={12} className="shrink-0" />
                        <span className="truncate">{m.invoice.creditor}</span>
                      </span>
                    ) : null}
                  </td>
                  <td
                    className="px-3 py-1 sticky right-0 z-10 border-l border-border"
                    style={{
                      background: tint
                        ? `linear-gradient(${tint}, ${tint}), hsl(var(--panel))`
                        : "hsl(var(--panel))",
                    }}
                  >
                    <AssigneePicker
                      value={assigns.get(idx + 2) ?? null}
                      onChange={(next) => setAssignee(idx + 2, next)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Récap minimaliste : une ligne avec les colonnes que l'algo a identifiées
 * (numéro + nom lu dans le fichier). Sert à vérifier d'un coup d'œil que
 * mon parsing est correct quand on upload un nouveau fichier.
 */
function ColumnsMini({ sheet }: { sheet: ParsedSheet }) {
  const cols = detectColumns(sheet);
  const headerRow =
    cols.dataStartRow > 0
      ? sheet.rows[cols.dataStartRow - 1] ?? sheet.headers
      : (sheet.headers as unknown as (string | number | null)[]);

  const label = (idx: number) => {
    if (idx < 0) return null;
    const v = headerRow[idx];
    return v == null || v === "" ? `col ${idx + 1}` : String(v);
  };

  const items: { key: string; value: string | null }[] = [
    { key: "Date", value: label(cols.idxDate) },
    { key: "Description", value: label(cols.idxCreditor) },
    { key: "Débit", value: label(cols.idxDebit) },
    { key: "Crédit", value: label(cols.idxCredit) },
  ];

  return (
    <div className="text-[11px] text-muted flex flex-wrap items-center gap-x-4 gap-y-1 px-1">
      {items.map((it) => (
        <span key={it.key}>
          <span className="text-muted">{it.key} : </span>
          {it.value ? (
            <span className="text-text font-mono">{it.value}</span>
          ) : (
            <span className="text-err">—</span>
          )}
        </span>
      ))}
    </div>
  );
}

function AssigneePicker({
  value,
  onChange,
}: {
  value: Assignee | null;
  onChange: (next: Assignee | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : (v as Assignee));
      }}
      className={
        "input !py-1 !px-2 text-[11px] !w-[110px] " +
        (value ? ASSIGNEE_TONE[value] : "text-muted")
      }
      title={value ? ASSIGNEE_LABEL[value] : "Attribuer cette ligne"}
    >
      <option value="">—</option>
      <option value="gauthier">Gauthier</option>
      <option value="robin">Robin</option>
      <option value="jacqueline">Maman</option>
      <option value="a_creer">À créer</option>
    </select>
  );
}
