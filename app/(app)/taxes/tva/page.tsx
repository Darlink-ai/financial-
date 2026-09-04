"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useStore, formatMonthLabel } from "@/lib/store";
import { formatAmount } from "@/lib/format";
import { getRateToChf, DEFAULT_FX_TO_CHF } from "@/lib/fx";
import type { AccountCurrency, Revenue } from "@/lib/types";
import { VAT_COUNTRIES, findVatCountry, type VatCountry } from "@/lib/vat-rates";
import { Download, FileText, Info } from "lucide-react";

/**
 * TVA MOSS / OSS — pour chaque pays UE + UK, agrège le CA réalisé sur la
 * période depuis les countryBreakdown des revenus saisis, applique le
 * taux TVA du pays et permet d'extraire une "facture" (page imprimable)
 * par pays pour justificatif comptable.
 *
 * Note : les pays hors UE + UK (US, CH, autres) sont exclus des calculs —
 * pas de TVA applicable dans ce périmètre.
 */
export default function TvaPage() {
  const { revenues } = useStore();

  const availableMonths = useMemo(() => {
    const set = new Set(revenues.map((r) => r.month));
    return [...set].sort().reverse();
  }, [revenues]);

  const [selectedMonth, setSelectedMonth] = useState<string>(
    availableMonths[0] ?? currentMonthIso(),
  );
  const [previewCountry, setPreviewCountry] = useState<VatCountry | null>(null);

  const summary = useMemo(() => {
    return computeVatByCountry(revenues, selectedMonth);
  }, [revenues, selectedMonth]);

  const totalCA = summary.rows.reduce((s, r) => s + r.amountChf, 0);
  const totalVat = summary.rows.reduce((s, r) => s + r.vatChf, 0);

  return (
    <>
      <PageHeader
        title="TVA — Déclarations par pays"
        subtitle={`Répartition du CA par pays UE + UK sur ${formatMonthLabel(selectedMonth)}, avec calcul automatique de la TVA due au taux standard de chaque pays.`}
        actions={
          <select
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="input !py-1.5 !px-3 text-[12px] !w-auto"
            title="Mois de la déclaration"
          >
            {availableMonths.length === 0 && (
              <option value={currentMonthIso()}>{formatMonthLabel(currentMonthIso())}</option>
            )}
            {availableMonths.map((m) => (
              <option key={m} value={m}>
                {formatMonthLabel(m)}
              </option>
            ))}
          </select>
        }
      />

      <div className="p-8 space-y-6">
        {summary.rows.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="text-[14px] font-medium mb-2">
              Aucun revenu ventilé par pays sur {formatMonthLabel(selectedMonth)}
            </div>
            <div className="text-[12px] text-muted max-w-md mx-auto">
              Saisis d'abord tes revenus dans <a href="/revenues" className="text-accent hover:underline">Revenus</a> et charge le
              fichier de répartition par pays pour ce mois.
            </div>
          </div>
        ) : (
          <>
            {/* Bandeau totaux */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <StatTile
                label="CA UE + UK"
                value={formatAmount(totalCA, "CHF")}
                hint={`${summary.rows.length} pays · sur ${summary.sourceCount} revenu${summary.sourceCount > 1 ? "s" : ""}`}
              />
              <StatTile
                label="TVA totale à collecter"
                value={formatAmount(totalVat, "CHF")}
                tone="warn"
                hint="Somme des TVA calculées par pays au taux standard."
              />
              <StatTile
                label="Taux effectif moyen"
                value={totalCA > 0 ? `${((totalVat / totalCA) * 100).toFixed(1)} %` : "—"}
                hint="TVA totale / CA UE + UK."
              />
            </div>

            {/* Tableau par pays */}
            <div className="card overflow-hidden">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-border bg-panel2/50">
                    <th className="text-left px-4 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">Pays</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">CA HT (CHF)</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">Taux TVA</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">TVA due (CHF)</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider">CA TTC (CHF)</th>
                    <th className="text-right px-4 py-2.5 w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {summary.rows.map((r) => (
                    <tr key={r.country.iso} className="border-b border-border/50 hover:bg-panel2/30">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-muted bg-panel2 px-1.5 py-0.5 rounded">
                            {r.country.iso}
                          </span>
                          <span className="font-medium">{r.country.name}</span>
                          {r.country.isUk && (
                            <span className="text-[9.5px] text-muted px-1.5 py-0.5 rounded border border-border">
                              hors UE
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {formatAmount(r.amountChf, "CHF")}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-accent font-medium">
                        {r.country.rate.toLocaleString("fr-CH")} %
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-warn font-semibold">
                        {formatAmount(r.vatChf, "CHF")}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums text-muted">
                        {formatAmount(r.amountChf + r.vatChf, "CHF")}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          onClick={() => setPreviewCountry(r.country)}
                          className="btn !py-1 !px-2.5 text-[11px]"
                          title={`Générer une facture (page imprimable) pour ${r.country.name}`}
                        >
                          <FileText size={11} /> Facture
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border font-semibold bg-panel2/30">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatAmount(totalCA, "CHF")}
                    </td>
                    <td className="px-4 py-3 text-right text-muted text-[11px]">—</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-warn">
                      {formatAmount(totalVat, "CHF")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatAmount(totalCA + totalVat, "CHF")}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => downloadCsv(summary.rows, selectedMonth)}
                        className="btn !py-1 !px-2.5 text-[11px]"
                        title="Exporter tout le tableau en CSV"
                      >
                        <Download size={11} /> CSV
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="text-[11px] text-muted flex items-start gap-2">
              <Info size={12} className="mt-0.5 shrink-0" />
              <div>
                Les montants CA sont convertis en CHF au taux moyen du mois via
                <span className="mx-1 font-mono">getRateToChf()</span>.
                Les taux TVA appliqués sont les <b>taux standard</b> de chaque pays
                (état 2026) — ne prennent pas en compte les taux réduits (services
                spécifiques, livres numériques, etc.).
              </div>
            </div>
          </>
        )}
      </div>

      {previewCountry && (
        <InvoiceModal
          country={previewCountry}
          month={selectedMonth}
          row={summary.rows.find((r) => r.country.iso === previewCountry.iso)!}
          onClose={() => setPreviewCountry(null)}
        />
      )}
    </>
  );
}

// ---------- Calculs ----------

type VatRow = {
  country: VatCountry;
  amountChf: number;
  vatChf: number;
  perSource: { businessId: string; processor: string; currency: string; amount: number; amountChf: number }[];
};

function computeVatByCountry(revenues: Revenue[], month: string) {
  const monthRevs = revenues.filter((r) => r.month === month);
  const rows = new Map<string, VatRow>();
  for (const rev of monthRevs) {
    for (const cb of rev.countryBreakdown) {
      const country = findVatCountry(cb.country);
      if (!country) continue; // pays hors UE+UK, on saute
      const amountChf = toChf(cb.amount, rev.currency, rev.month);
      const key = country.iso;
      const existing = rows.get(key);
      if (existing) {
        existing.amountChf += amountChf;
        existing.vatChf = (existing.amountChf * country.rate) / 100;
        existing.perSource.push({
          businessId: rev.businessId,
          processor: rev.processor,
          currency: rev.currency,
          amount: cb.amount,
          amountChf,
        });
      } else {
        rows.set(key, {
          country,
          amountChf,
          vatChf: (amountChf * country.rate) / 100,
          perSource: [{
            businessId: rev.businessId,
            processor: rev.processor,
            currency: rev.currency,
            amount: cb.amount,
            amountChf,
          }],
        });
      }
    }
  }
  return {
    rows: [...rows.values()].sort((a, b) => b.amountChf - a.amountChf),
    sourceCount: monthRevs.length,
  };
}

function toChf(amount: number, currency: string, month: string): number {
  const c = (currency || "CHF").toUpperCase();
  if (!(c in DEFAULT_FX_TO_CHF)) return amount;
  return amount * getRateToChf(month, c as AccountCurrency);
}

function currentMonthIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ---------- CSV export ----------

function downloadCsv(rows: VatRow[], month: string) {
  const lines = [
    "ISO;Pays;CA HT CHF;Taux TVA %;TVA due CHF;CA TTC CHF",
    ...rows.map((r) =>
      [
        r.country.iso,
        r.country.name,
        r.amountChf.toFixed(2),
        r.country.rate.toString(),
        r.vatChf.toFixed(2),
        (r.amountChf + r.vatChf).toFixed(2),
      ].join(";"),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tva-${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- Composants ----------

function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warn" | "ok";
}) {
  const color = tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-text";
  return (
    <div className="card p-4">
      <div className="text-[10.5px] uppercase tracking-wider text-muted font-medium mb-1">
        {label}
      </div>
      <div className={`text-[22px] font-semibold font-mono tabular-nums ${color}`}>
        {value}
      </div>
      {hint && <div className="text-[11px] text-muted mt-1">{hint}</div>}
    </div>
  );
}

/** Modal facture imprimable pour un pays. Bouton Imprimer déclenche
 *  window.print() — l'utilisateur choisit ensuite "Enregistrer en PDF"
 *  dans son navigateur (pas besoin de lib PDF côté server). */
function InvoiceModal({
  country,
  month,
  row,
  onClose,
}: {
  country: VatCountry;
  month: string;
  row: VatRow;
  onClose: () => void;
}) {
  const monthLabel = formatMonthLabel(month);
  const today = new Date().toLocaleDateString("fr-CH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const invoiceNumber = `VAT-${month.replace("-", "")}-${country.iso}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-auto"
      onClick={onClose}
    >
      <div
        className="bg-white text-black rounded-lg shadow-2xl max-w-2xl w-full my-8 print:my-0 print:shadow-none print:max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-8 print:p-6" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
          {/* Header */}
          <div className="flex justify-between items-start mb-8 pb-4 border-b border-gray-300">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Justificatif TVA
              </div>
              <div className="text-[22px] font-semibold">FameLink SA</div>
              <div className="text-[11px] text-gray-600 mt-1">Suisse · Assujettie TVA CH</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-gray-500">N° {invoiceNumber}</div>
              <div className="text-[11px] text-gray-500 mt-1">Émis le {today}</div>
            </div>
          </div>

          {/* Client / période */}
          <div className="grid grid-cols-2 gap-6 mb-8">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Territoire fiscal
              </div>
              <div className="text-[16px] font-semibold">{country.name}</div>
              <div className="text-[11px] text-gray-600 mt-1">
                Code pays : {country.iso}
                {country.isUk ? " (hors UE, régime post-Brexit)" : " (Union européenne)"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Période
              </div>
              <div className="text-[16px] font-semibold">{monthLabel}</div>
              <div className="text-[11px] text-gray-600 mt-1">
                Ventes B2C aux consommateurs {country.name.toLowerCase()}
              </div>
            </div>
          </div>

          {/* Tableau détail sources */}
          <div className="mb-6">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">
              Détail des ventes
            </div>
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="border-b border-gray-300 text-gray-600">
                  <th className="text-left py-2 font-medium">Business</th>
                  <th className="text-left py-2 font-medium">Processeur</th>
                  <th className="text-right py-2 font-medium">Montant local</th>
                  <th className="text-right py-2 font-medium">Équivalent CHF</th>
                </tr>
              </thead>
              <tbody>
                {row.perSource.map((s, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-1.5 font-mono text-[11px]">{s.businessId}</td>
                    <td className="py-1.5">{s.processor}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {s.amount.toFixed(2)} {s.currency}
                    </td>
                    <td className="py-1.5 text-right font-mono tabular-nums">
                      {s.amountChf.toFixed(2)} CHF
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Récapitulatif */}
          <div className="border-t border-gray-300 pt-4 space-y-2">
            <div className="flex justify-between text-[13px]">
              <span className="text-gray-600">Base imposable (CA HT)</span>
              <span className="font-mono tabular-nums">{row.amountChf.toFixed(2)} CHF</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-gray-600">
                Taux TVA standard {country.iso} ({country.rate}%)
              </span>
              <span className="font-mono tabular-nums text-amber-700">
                {row.vatChf.toFixed(2)} CHF
              </span>
            </div>
            <div className="flex justify-between text-[15px] pt-2 border-t border-gray-200 font-semibold">
              <span>Total TTC</span>
              <span className="font-mono tabular-nums">
                {(row.amountChf + row.vatChf).toFixed(2)} CHF
              </span>
            </div>
          </div>

          <div className="mt-8 text-[10px] text-gray-500 border-t border-gray-200 pt-3">
            Document généré automatiquement à partir du CA saisi dans le
            module Revenus. Sert de justificatif interne pour la déclaration
            TVA {country.isUk ? "UK" : "OSS UE"}. À valider par la fiduciaire
            avant transmission officielle.
          </div>
        </div>

        {/* Actions (non imprimées) */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-2 rounded-b-lg print:hidden">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[12px] font-medium text-gray-700 hover:bg-gray-100 rounded"
          >
            Fermer
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-1.5 text-[12px] font-medium bg-blue-600 text-white hover:bg-blue-700 rounded inline-flex items-center gap-1.5"
          >
            <Download size={12} /> Imprimer / PDF
          </button>
        </div>
      </div>
    </div>
  );
}
