"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useStore, formatMonthLabel } from "@/lib/store";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Download, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";
import {
  computeExpenseTotal,
  detectColumns,
  matchInvoicesAgainstSheet,
  type MatchResult,
  type ParsedSheet,
} from "@/lib/excel-match";
import { formatAmount } from "@/lib/format";
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
  const { updateInvoice, reloadFromDb, selectedMonth, invoices: allInvoices } =
    useStore();
  // IMPORTANT : sur /excel on filtre STRICTEMENT par invoiceDate (pas de
  // fallback sur receivedAt comme le fait useInvoicesForCurrentMonth). Sinon
  // une facture avec invoiceDate=null mais reçue en mars serait considérée
  // "March" et polluerait les rapprochements du mois affiché avec des
  // matches de créditeur+montant qui n'ont rien à voir avec mars.
  const allMonthInvoices = useMemo<Invoice[]>(
    () =>
      allInvoices.filter(
        (i) => i.invoiceDate && i.invoiceDate.slice(0, 7) === selectedMonth,
      ),
    [allInvoices, selectedMonth],
  );
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

  const matchedRows = useMemo(() => {
    const map = new Map<number, MatchResult>();
    matches.forEach((m) => map.set(m.rowIndex, m));
    return map;
  }, [matches]);

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

  const unmatchedInvoices = useMemo<Invoice[]>(() => {
    const matchedIds = new Set(matches.map((m) => m.invoice.id));
    return invoices
      .filter((i) => i.creditor && ["classified", "renamed", "uploaded"].includes(i.status))
      .filter((i) => !matchedIds.has(i.id));
  }, [matches, invoices]);

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
      <PageHeader
        title="Rapprochement Excel"
        subtitle={`Choisis d'abord la devise du fichier, puis dépose-le. Chaque devise (CHF / EUR / USD) a son propre fichier mensuel — sélectionne celui que tu veux gérer.`}
        actions={
          sheet && (
            <>
              <button onClick={applyMatchesToInvoices} className="btn btn-primary">
                <CheckCircle2 size={14} /> Appliquer ({matches.length})
              </button>
              <button onClick={downloadHighlighted} className="btn">
                <Download size={14} /> Exporter
              </button>
            </>
          )
        }
      />

      <div className="p-8 space-y-6">
        {/* Picker de devise — 3 onglets visuels CHF / EUR / USD */}
        <div className="card p-1.5 flex items-center gap-1 w-fit">
          {ACCOUNT_CURRENCIES.map((c) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              className={`px-5 py-2 rounded-md text-[13px] font-medium font-mono transition-colors ${
                currency === c
                  ? "bg-panel2 text-text border border-border shadow-[inset_0_0_0_1px_rgba(96,165,250,0.2)]"
                  : "text-muted hover:text-text border border-transparent"
              }`}
            >
              {c}
            </button>
          ))}
          <div className="text-[11px] text-muted px-3">
            Mois : <span className="text-text">{formatMonthLabel(selectedMonth)}</span>
          </div>
        </div>

        {loadingPersisted ? (
          <div className="card p-12 text-center text-muted text-[13px]">
            Chargement du fichier {currency} sauvegardé pour {formatMonthLabel(selectedMonth)}…
          </div>
        ) : !sheet ? (
          <Dropzone currency={currency} onFile={onFile} onPick={() => fileRef.current?.click()} />
        ) : (
          <>
            <div className="card p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-panel2 border border-border flex items-center justify-center">
                <FileSpreadsheet size={18} className="text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate flex items-center gap-2">
                  {fileName}
                  {persistedAt && !persistError && (
                    <span className="badge ok text-[10px]" title={`Sauvé le ${new Date(persistedAt).toLocaleString("fr-CH")}`}>
                      Sauvé en DB
                    </span>
                  )}
                  {persistError && (
                    <span className="badge err text-[10px]">Pas sauvé</span>
                  )}
                </div>
                <div className="text-[11px] text-muted">
                  {dataRowCount(sheet.rows.length)} lignes · {sheet.headers.length} colonnes · {matches.length} rapprochée(s)
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
                className="btn"
                onClick={() => fileRef.current?.click()}
                title="Remplacer par un nouveau fichier"
              >
                <Upload size={12} /> Remplacer
              </button>
              {persistedAt && (
                <button
                  className="btn !px-2"
                  onClick={removePersisted}
                  title="Supprimer le fichier sauvegardé"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>

            <div className="grid grid-cols-4 gap-3">
              <StatTile label="Lignes Excel" value={dataRowCount(sheet.rows.length)} />
              <StatTile label="Rapprochées (vertes)" value={matches.length} tone="ok" />
              <StatTile label="Factures sans match" value={unmatchedInvoices.length} tone={unmatchedInvoices.length > 0 ? "warn" : "neutral"} />
              <StatTile
                label="Total dépenses"
                value={formatAmount(expenseTotals.totalDebit, currency)}
                tone="warn"
                hint={`${expenseTotals.debitRowCount} débit${expenseTotals.debitRowCount > 1 ? "s" : ""} · ${formatAmount(expenseTotals.totalCredit, currency)} de crédits`}
              />
            </div>

            <ColumnsMini sheet={sheet} />

            <SheetTable sheet={sheet} matchedRows={matchedRows} />

            {unmatchedInvoices.length > 0 && (
              <section className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                  <AlertCircle size={14} className="text-warn" />
                  <div className="text-[13px] font-medium">Factures sans ligne correspondante</div>
                  <span className="text-[11px] text-muted ml-auto">
                    Tape le n° de la ligne Excel à droite pour rapprocher
                    manuellement, sinon elles iront dans « À traiter
                    manuellement ».
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {unmatchedInvoices.map((i) => (
                    <UnmatchedRow
                      key={i.id}
                      invoice={i}
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
 * Une ligne du bandeau "Factures sans ligne correspondante". Chaque facture
 * a son propre input local pour taper le n° de ligne Excel et un bouton
 * Valider qui appelle `onAssign(rowNumber)`. Après validation, le parent
 * recharge depuis la DB et la facture remonte automatiquement dans les
 * lignes vertes (puisque son status devient "matched").
 */
function UnmatchedRow({
  invoice,
  onAssign,
  onDelete,
}: {
  invoice: Invoice;
  onAssign: (rowNumber: number) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [row, setRow] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const n = parseInt(row.trim(), 10);
    if (!Number.isFinite(n) || n < 2) {
      alert("Entre un n° de ligne valide (≥ 2 — la ligne 1 étant l'en-tête).");
      return;
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
    <div className="card p-4">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`text-[24px] font-semibold leading-none mt-2 tabular-nums ${toneClass}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted mt-2">{hint}</div>}
    </div>
  );
}

function SheetTable({
  sheet,
  matchedRows,
}: {
  sheet: ParsedSheet;
  matchedRows: Map<number, MatchResult>;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto max-h-[60vh]">
        <table className="w-full text-[12px] border-collapse">
          <thead className="sticky top-0 bg-panel border-b border-border z-10">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted font-medium w-12">
                #
              </th>
              {sheet.headers.map((h, i) => (
                <th
                  key={i}
                  className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted font-medium whitespace-nowrap"
                >
                  {h || `Col ${i + 1}`}
                </th>
              ))}
              <th className="px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted font-medium">
                Rapprochement
              </th>
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, idx) => {
              const m = matchedRows.get(idx);
              return (
                <tr
                  key={idx}
                  className={
                    m
                      ? "bg-[rgba(34,197,94,0.12)] hover:bg-[rgba(34,197,94,0.18)] border-l-2 border-l-ok"
                      : "hover:bg-panel2 border-l-2 border-l-transparent"
                  }
                >
                  <td className="px-3 py-1.5 text-muted tabular-nums">{idx + 2}</td>
                  {sheet.headers.map((_, ci) => (
                    <td key={ci} className="px-3 py-1.5 whitespace-nowrap">
                      {formatCell(row[ci])}
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    {m ? (
                      <div className="flex items-center gap-1.5">
                        <CheckCircle2 size={12} className="text-ok" />
                        <span className="text-ok">{m.invoice.creditor}</span>
                        <span className="text-muted text-[11px]">({m.reasons.join(", ")})</span>
                      </div>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
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

function formatCell(v: string | number | Date | null): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toLocaleDateString("fr-CH");
  if (typeof v === "number") return new Intl.NumberFormat("fr-CH").format(v);
  return String(v);
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
