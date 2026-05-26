"use client";

import { PageHeader } from "@/components/PageHeader";
import {
  useStore,
  useInvoicesForCurrentMonth,
  formatMonthLabel,
} from "@/lib/store";
import { FALLBACK_CATEGORY_ID } from "@/lib/mock-data";
import {
  formatAmount,
  formatRelative,
  formatSwissDate,
  formatBytes,
  buildFinalName,
} from "@/lib/format";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  FileQuestion,
  Eye,
  RefreshCw,
} from "lucide-react";
import type { Invoice, FolderMapping } from "@/lib/types";

export default function ManualPage() {
  const { mappings, updateInvoice, selectedMonth, reloadFromDb } = useStore();
  const monthInvoices = useInvoicesForCurrentMonth();

  const items = useMemo(
    () => monthInvoices.filter((i) => i.status === "manual"),
    [monthInvoices],
  );

  const normalCategories = mappings.filter((m) => m.id !== FALLBACK_CATEGORY_ID);
  const fallback = mappings.find((m) => m.id === FALLBACK_CATEGORY_ID);

  return (
    <>
      <PageHeader
        title="À traiter manuellement"
        subtitle={`Factures de ${formatMonthLabel(selectedMonth)} qui n'ont pas pu être classées : ouvre la pièce jointe, rapproche-la d'une ligne Excel, puis choisis une catégorie. Réserve « Charges non classées » au cas où aucune autre ne convient.`}
      />

      <div className="p-8 space-y-4">
        {items.length === 0 ? (
          <div className="card p-12 text-center">
            <CheckCircle2 size={28} className="text-ok mx-auto mb-3" />
            <div className="text-[15px] font-medium">Aucune facture en attente</div>
            <div className="text-[12px] text-muted mt-1">
              Toutes les factures de {formatMonthLabel(selectedMonth)} ont été classées.
            </div>
          </div>
        ) : (
          items.map((inv) => (
            <ManualCard
              key={inv.id}
              invoice={inv}
              normalCategories={normalCategories}
              fallback={fallback}
              onReload={reloadFromDb}
              onAssign={(code, label) => {
                const finalName = buildFinalName(inv.invoiceDate, inv.creditor, code);
                updateInvoice(inv.id, {
                  folderCode: code,
                  folderLabel: label,
                  finalName,
                  status: "classified",
                });
              }}
            />
          ))
        )}
      </div>
    </>
  );
}

function ManualCard({
  invoice,
  normalCategories,
  fallback,
  onAssign,
  onReload,
}: {
  invoice: Invoice;
  normalCategories: FolderMapping[];
  fallback?: FolderMapping;
  onAssign: (code: string, label: string) => void;
  onReload: () => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string>("");
  const [showFallback, setShowFallback] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);

  const selected =
    normalCategories.find((m) => m.id === selectedId) ??
    (selectedId === FALLBACK_CATEGORY_ID ? fallback : undefined);

  const reprocess = async () => {
    setReprocessing(true);
    try {
      const r = await fetch(`/api/invoices/${invoice.id}/reprocess`, {
        method: "POST",
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as
          | { message?: string }
          | null;
        alert(`Échec : ${data?.message ?? `HTTP ${r.status}`}`);
        return;
      }
      const data = (await r.json()) as {
        outcome: {
          status: string;
          uploadedToDrive: boolean;
          matchedExcelRow: number | null;
          errors: string[];
        };
      };
      await onReload();
      if (data.outcome.status === "manual") {
        const why =
          data.outcome.errors.length > 0
            ? `\n\nDétails :\n• ${data.outcome.errors.join("\n• ")}`
            : "\n\nLe LLM n'a pas pu inférer une catégorie avec assez de confiance, ou la clé ANTHROPIC_API_KEY n'est pas configurée. Classe manuellement.";
        alert(`Toujours en manuel après re-traitement.${why}`);
      } else if (data.outcome.errors.length > 0) {
        alert(
          `Re-traitement terminé (${data.outcome.status}) avec des avertissements :\n• ${data.outcome.errors.join("\n• ")}`,
        );
      }
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`);
    } finally {
      setReprocessing(false);
    }
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <AlertCircle size={16} className="text-warn" />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium truncate">{invoice.subject}</div>
          <div className="text-[12px] text-muted truncate">
            {invoice.creditor ?? "Créditeur non identifié"} · {invoice.fromEmail} · {invoice.mailbox}
          </div>
        </div>
        <span className="badge warn">Manuel</span>
        <span className="text-[11px] text-muted">{formatRelative(invoice.receivedAt)}</span>
      </div>

      <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-6 px-5 py-4">
        {/* Détails facture */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted mb-2">
            Facture
          </div>
          <div className="space-y-1.5 text-[12px]">
            <Row label="Date" value={formatSwissDate(invoice.invoiceDate)} />
            <Row label="Montant" value={formatAmount(invoice.amount, invoice.currency)} />
            <Row label="PJ" value={invoice.attachment?.name ?? "—"} mono />
            <Row
              label="Taille"
              value={
                invoice.attachment
                  ? `${formatBytes(invoice.attachment.sizeBytes)} · ${invoice.attachment.pages} p.`
                  : "—"
              }
            />
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <a
              href={`/api/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn text-[11px]"
            >
              <Eye size={11} /> Ouvrir la PJ
            </a>
            <button
              onClick={reprocess}
              disabled={reprocessing}
              className="btn text-[11px] disabled:opacity-50"
              title="Relance extraction PDF + classification (essaie le LLM si la regex échoue)"
            >
              {reprocessing ? (
                <>
                  <RefreshCw size={11} className="animate-spin" /> Re-traitement…
                </>
              ) : (
                <>
                  <RefreshCw size={11} /> Re-traiter (LLM)
                </>
              )}
            </button>
          </div>
        </div>

        {/* Pourquoi en manuel */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted mb-2">
            Pourquoi en manuel ?
          </div>
          <div className="text-[12px] text-muted leading-relaxed">
            {invoice.creditor
              ? "Aucune règle ne couvre ce créditeur, ou aucune ligne du fichier Excel ne correspond au montant et à la date."
              : "L'extraction du créditeur a échoué — le PDF est peut-être scanné. Ouvre la PJ pour vérifier."}
          </div>
          <div className="text-[11px] text-muted mt-3 leading-relaxed">
            <strong className="text-text">Étapes :</strong> 1) ouvre la PJ, 2) cherche la ligne dans
            le fichier Excel du mois, 3) choisis la catégorie qui colle au contenu.
          </div>
        </div>

        {/* Classement manuel */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted mb-2">
            Choisir une catégorie
          </div>

          <div className="space-y-1">
            {normalCategories.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedId(m.id)}
                className={`w-full text-left px-3 py-1.5 rounded-lg border text-[12px] transition-colors flex items-center gap-2 ${
                  selectedId === m.id
                    ? "bg-panel2 border-accent2"
                    : "bg-transparent border-border hover:bg-panel2"
                }`}
              >
                <span className="font-mono text-[10px] text-muted w-10 shrink-0">
                  {m.folderCode}
                </span>
                <span className="truncate">{m.folderLabel}</span>
              </button>
            ))}
          </div>

          {!showFallback ? (
            <button
              onClick={() => setShowFallback(true)}
              className="mt-3 text-[11px] text-muted hover:text-text underline flex items-center gap-1.5"
            >
              <FileQuestion size={11} />
              Aucune ne convient ? Utiliser « Charges non classées »
            </button>
          ) : (
            fallback && (
              <button
                onClick={() => setSelectedId(fallback.id)}
                className={`w-full text-left px-3 py-2 mt-3 rounded-lg border-2 border-dashed text-[12px] transition-colors flex items-center gap-2 ${
                  selectedId === fallback.id
                    ? "bg-warn/10 border-warn"
                    : "border-warn/50 hover:bg-warn/5"
                }`}
              >
                <FileQuestion size={13} className="text-warn shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">Charges non classées</div>
                  <div className="text-[10px] text-muted">
                    Dernier recours — seulement si aucune catégorie ci-dessus ne convient.
                  </div>
                </div>
              </button>
            )
          )}

          <button
            disabled={!selected}
            onClick={() => selected && onAssign(selected.folderCode, selected.folderLabel)}
            className="btn btn-primary mt-3 w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileText size={12} /> Classer et renommer
            {selected && (
              <span className="font-mono text-[10px] opacity-80">
                → {invoice.invoiceDate ? formatSwissDate(invoice.invoiceDate) : "JJ.MM.AA"} -{" "}
                {invoice.creditor ?? "Créditeur"} - {selected.folderCode}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className={mono ? "font-mono text-right" : "text-right"}>{value}</span>
    </div>
  );
}
