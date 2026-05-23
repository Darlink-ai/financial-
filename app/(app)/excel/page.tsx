"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import {
  useStore,
  useInvoicesForCurrentMonth,
  formatMonthLabel,
} from "@/lib/store";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Download, Trash2 } from "lucide-react";
import * as XLSX from "xlsx";
import {
  matchInvoicesAgainstSheet,
  type MatchResult,
  type ParsedSheet,
} from "@/lib/excel-match";
import type { Invoice } from "@/lib/types";

export default function ExcelPage() {
  const { updateInvoice, selectedMonth } = useStore();
  const invoices = useInvoicesForCurrentMonth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [loadingPersisted, setLoadingPersisted] = useState(false);
  const [persistedAt, setPersistedAt] = useState<string | null>(null);

  // Recharge depuis la DB quand le mois sélectionné change.
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
        const r = await fetch(`/api/excel-sheets/${selectedMonth}`, {
          cache: "no-store",
        });
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
  }, [selectedMonth]);

  const matches = useMemo<MatchResult[]>(() => {
    if (!sheet) return [];
    return matchInvoicesAgainstSheet(sheet, invoices);
  }, [sheet, invoices]);

  const matchedRows = useMemo(() => {
    const map = new Map<number, MatchResult>();
    matches.forEach((m) => map.set(m.rowIndex, m));
    return map;
  }, [matches]);

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
    try {
      const r = await fetch(`/api/excel-sheets/${selectedMonth}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: name,
          headers: parsed.headers,
          rows: safeRows,
        }),
      });
      if (r.ok) {
        setPersistedAt(new Date().toISOString());
      }
    } catch {
      // Erreur silencieuse : la sheet reste en mémoire, juste pas persistée.
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
    if (!confirm(`Supprimer le fichier Excel pour ${formatMonthLabel(selectedMonth)} ?`)) return;
    await fetch(`/api/excel-sheets/${selectedMonth}`, { method: "DELETE" });
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
      });
    });
    unmatchedInvoices.forEach((i) => {
      updateInvoice(i.id, { status: "manual" });
    });
  };

  const downloadHighlighted = () => {
    if (!workbook || !sheet) return;
    const ws = workbook.Sheets[activeSheet];
    // xlsx (community) doesn't support cell styling on write — we export a CSV with a marker column.
    const out: (string | number | null)[][] = [
      [...sheet.headers, "Rapprochement"],
      ...sheet.rows.map((row, idx) => {
        const m = matchedRows.get(idx);
        return [...row, m ? `✓ ${m.invoice.creditor} (${m.confidence})` : ""];
      }),
    ];
    const newWs = XLSX.utils.aoa_to_sheet(out);
    const newWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWb, newWs, "Rapprochement");
    XLSX.writeFile(newWb, `${(fileName ?? "rapprochement").replace(/\.[^.]+$/, "")}-matched.xlsx`);
  };

  return (
    <>
      <PageHeader
        title="Rapprochement Excel"
        subtitle={`Charge ton fichier comptable du mois ${formatMonthLabel(selectedMonth)}. Les lignes qui correspondent à une facture passent en vert ; les factures sans ligne basculent dans « À traiter manuellement ».`}
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
        {loadingPersisted ? (
          <div className="card p-12 text-center text-muted text-[13px]">
            Chargement du fichier sauvegardé pour {formatMonthLabel(selectedMonth)}…
          </div>
        ) : !sheet ? (
          <Dropzone onFile={onFile} onPick={() => fileRef.current?.click()} />
        ) : (
          <>
            <div className="card p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-lg bg-panel2 border border-border flex items-center justify-center">
                <FileSpreadsheet size={18} className="text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate flex items-center gap-2">
                  {fileName}
                  {persistedAt && (
                    <span className="badge ok text-[10px]" title={`Sauvé le ${new Date(persistedAt).toLocaleString("fr-CH")}`}>
                      Sauvé en DB
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-muted">
                  {sheet.rows.length} lignes · {sheet.headers.length} colonnes · {matches.length} rapprochée(s)
                </div>
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

            <div className="grid grid-cols-3 gap-3">
              <StatTile label="Lignes Excel" value={sheet.rows.length} />
              <StatTile label="Rapprochées (vertes)" value={matches.length} tone="ok" />
              <StatTile label="Factures sans match" value={unmatchedInvoices.length} tone={unmatchedInvoices.length > 0 ? "warn" : "neutral"} />
            </div>

            <SheetTable sheet={sheet} matchedRows={matchedRows} />

            {unmatchedInvoices.length > 0 && (
              <section className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-border flex items-center gap-2">
                  <AlertCircle size={14} className="text-warn" />
                  <div className="text-[13px] font-medium">Factures sans ligne correspondante</div>
                  <span className="text-[11px] text-muted ml-auto">
                    Elles iront dans l'onglet « À traiter manuellement ».
                  </span>
                </div>
                <div className="divide-y divide-border">
                  {unmatchedInvoices.map((i) => (
                    <div key={i.id} className="px-5 py-2.5 flex items-center gap-3 text-[12px]">
                      <span className="font-medium">{i.creditor}</span>
                      <span className="text-muted">— {i.subject}</span>
                      <span className="ml-auto font-mono text-muted">
                        {i.amount} {i.currency}
                      </span>
                    </div>
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

function Dropzone({ onFile, onPick }: { onFile: (f: File) => void; onPick: () => void }) {
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
        <div className="text-[15px] font-medium">Glisse ton fichier Excel ici</div>
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
}: {
  label: string;
  value: number;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClass = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-text";
  return (
    <div className="card p-4">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`text-[24px] font-semibold leading-none mt-2 ${toneClass}`}>{value}</div>
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
