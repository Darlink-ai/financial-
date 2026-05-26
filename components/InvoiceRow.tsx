"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  ExternalLink,
  Mail,
  RefreshCw,
} from "lucide-react";
import type { Invoice } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { formatAmount, formatRelative, formatBytes, formatSwissDate } from "@/lib/format";
import { useStore } from "@/lib/store";

export function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const [open, setOpen] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const { reloadFromDb } = useStore();
  const account = invoice.accountCurrency ?? "USD";
  // Facture déjà rapprochée Excel → fond vert subtil + barre verte
  // à gauche, pour repérer en un coup d'œil ce qui est "fait".
  const isMatched = invoice.status === "matched";

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
      await reloadFromDb();
      if (data.outcome.errors.length > 0) {
        alert(
          `Re-traitement terminé avec des avertissements :\n• ${data.outcome.errors.join("\n• ")}`,
        );
      }
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`);
    } finally {
      setReprocessing(false);
    }
  };

  return (
    <div
      id={invoice.id}
      className={`border-b border-border last:border-b-0 ${
        isMatched ? "border-l-2 border-l-ok" : ""
      }`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className={`w-full px-5 py-3 flex items-center gap-4 transition-colors text-left ${
          isMatched
            ? "bg-ok/[0.07] hover:bg-ok/[0.12]"
            : "hover:bg-panel2"
        }`}
      >
        <span className="text-muted">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <FileText size={16} className="text-muted shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] truncate">{invoice.subject}</div>
          <div className="text-[11px] text-muted truncate">
            {invoice.creditor ?? "Créditeur inconnu"} ·{" "}
            {invoice.folderCode ? `${invoice.folderCode} — ${invoice.folderLabel}` : "Non classé"}
          </div>
        </div>
        <div className="w-16 text-center">
          <span
            className="inline-block font-mono text-[11px] font-medium px-2 py-0.5 rounded-md border"
            style={{
              color:
                account === "USD" ? "#60a5fa" : account === "EUR" ? "#22d3ee" : "#a78bfa",
              borderColor:
                account === "USD"
                  ? "rgba(96,165,250,0.35)"
                  : account === "EUR"
                  ? "rgba(34,211,238,0.35)"
                  : "rgba(167,139,250,0.35)",
              background:
                account === "USD"
                  ? "rgba(96,165,250,0.10)"
                  : account === "EUR"
                  ? "rgba(34,211,238,0.10)"
                  : "rgba(167,139,250,0.10)",
            }}
            title={`Compte bancaire ${account}`}
          >
            {account}
          </span>
        </div>
        <div className="text-[12px] text-muted w-28 text-right tabular-nums">
          {formatAmount(invoice.amount, invoice.currency)}
        </div>
        <div className="w-32 text-right">
          <StatusBadge status={invoice.status} />
        </div>
        <div className="text-[11px] text-muted w-24 text-right">
          {formatRelative(invoice.receivedAt)}
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 bg-panel2/30 grid grid-cols-3 gap-6 border-t border-border">
          <div>
            <FieldGroup label="Source">
              <Field icon={Mail} label="Boîte mail" value={invoice.mailbox} />
              <Field label="Expéditeur" value={invoice.fromEmail} />
              <Field label="Reçue le" value={new Date(invoice.receivedAt).toLocaleString("fr-CH")} />
            </FieldGroup>
            {invoice.attachment && (
              <FieldGroup label="Pièce jointe">
                <Field label="Fichier" value={invoice.attachment.name} mono />
                <Field
                  label="Taille"
                  value={`${formatBytes(invoice.attachment.sizeBytes)} · ${invoice.attachment.pages} p.`}
                />
              </FieldGroup>
            )}
          </div>

          <div>
            <FieldGroup label="Analyse extraite">
              <Field label="Créditeur" value={invoice.creditor ?? "—"} />
              <Field label="Date facture" value={formatSwissDate(invoice.invoiceDate)} />
              <Field label="Montant" value={formatAmount(invoice.amount, invoice.currency)} />
            </FieldGroup>
            <FieldGroup label="Classement">
              <Field
                label="Code comptable"
                value={invoice.folderCode ? `${invoice.folderCode}` : "—"}
                mono
              />
              <Field label="Dossier" value={invoice.folderLabel ?? "—"} />
            </FieldGroup>
          </div>

          <div>
            <FieldGroup label="Sortie">
              <Field label="Nom final" value={invoice.finalName ?? "—"} mono />
              <Field label="Chemin Drive" value={invoice.drivePath ?? "—"} mono small />
              <Field
                label="Ligne Excel"
                value={
                  invoice.excelRowMatched
                    ? `Ligne ${invoice.excelRowMatched} (verte ✓)`
                    : "Non rapprochée"
                }
              />
            </FieldGroup>
            <div className="flex gap-2 mt-4">
              <a
                href={`/api/invoices/${invoice.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn text-[12px]"
              >
                Aperçu PDF <ExternalLink size={12} />
              </a>
              <button
                onClick={reprocess}
                disabled={reprocessing}
                className="btn text-[12px] disabled:opacity-50"
                title="Relance extraction + classification + Drive + match Excel"
              >
                {reprocessing ? (
                  <>
                    <RefreshCw size={12} className="animate-spin" /> Re-traitement…
                  </>
                ) : (
                  <>
                    <RefreshCw size={12} /> Re-traiter
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 last:mb-0">
      <div className="text-[10px] uppercase tracking-wider text-muted mb-2">{label}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  small,
  icon: Icon,
}: {
  label: string;
  value: string;
  mono?: boolean;
  small?: boolean;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="flex gap-3 items-baseline">
      <div className="text-[11px] text-muted w-24 shrink-0 flex items-center gap-1.5">
        {Icon && <Icon size={11} />}
        {label}
      </div>
      <div
        className={`text-[12px] min-w-0 break-words ${mono ? "font-mono" : ""} ${
          small ? "text-[11px] text-muted" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
