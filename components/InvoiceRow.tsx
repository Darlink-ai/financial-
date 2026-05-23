"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, ExternalLink, Mail } from "lucide-react";
import type { Invoice } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";
import { formatAmount, formatRelative, formatBytes, formatSwissDate } from "@/lib/format";

export function InvoiceRow({ invoice }: { invoice: Invoice }) {
  const [open, setOpen] = useState(false);

  return (
    <div id={invoice.id} className="border-b border-border last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-5 py-3 flex items-center gap-4 hover:bg-panel2 transition-colors text-left"
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
              <button className="btn text-[12px]">
                Aperçu PDF <ExternalLink size={12} />
              </button>
              <button className="btn text-[12px]">Re-traiter</button>
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
