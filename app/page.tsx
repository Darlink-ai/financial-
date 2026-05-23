"use client";

import { PageHeader } from "@/components/PageHeader";
import { useStore, useInvoicesForCurrentMonth, formatMonthLabel } from "@/lib/store";
import {
  Mail,
  FileText,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  FileSpreadsheet,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { formatRelative, formatAmount } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";

export default function DashboardPage() {
  const { mailboxes, mappings, drive, selectedMonth } = useStore();
  const invoices = useInvoicesForCurrentMonth();

  const counts = {
    total: invoices.length,
    processed: invoices.filter((i) =>
      ["classified", "renamed", "uploaded", "matched"].includes(i.status),
    ).length,
    manual: invoices.filter((i) => i.status === "manual").length,
    matched: invoices.filter((i) => i.status === "matched").length,
  };

  const recent = [...invoices]
    .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
    .slice(0, 6);

  const connectedMb = mailboxes.filter((m) => m.connected).length;

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        subtitle={`Vue d'ensemble du pipeline pour ${formatMonthLabel(selectedMonth)}.`}
      />

      <div className="p-8 space-y-8">
        <section className="grid grid-cols-4 gap-4">
          <StatCard
            icon={FileText}
            label="Factures du mois"
            value={counts.total}
            hint={`${connectedMb}/${mailboxes.length} boîtes mail connectées`}
          />
          <StatCard
            icon={CheckCircle2}
            label="Traitées"
            value={counts.processed}
            hint={`dont ${counts.matched} rapprochées Excel`}
            tone="ok"
          />
          <StatCard
            icon={AlertCircle}
            label="À traiter manuellement"
            value={counts.manual}
            hint="Aucun mapping ou pas de ligne Excel"
            tone={counts.manual > 0 ? "warn" : "neutral"}
          />
          <StatCard
            icon={FolderTreeIcon}
            label="Catégories de charges"
            value={mappings.length}
            hint="Créditeur → dossier"
          />
        </section>

        <section className="grid grid-cols-3 gap-4">
          <PipelineStep
            n={1}
            title="Récupération mail"
            desc="IMAP / Gmail / Outlook. Détection des PJ factures."
            state={connectedMb > 0 ? "ready" : "todo"}
            cta={{ href: "/connectors", label: "Configurer" }}
            icon={Mail}
          />
          <PipelineStep
            n={2}
            title="Analyse + classement"
            desc="Lecture du PDF, extraction du créditeur, mapping vers une catégorie de charges."
            state="ready"
            cta={{ href: "/mappings", label: "Règles" }}
            icon={FileText}
          />
          <PipelineStep
            n={3}
            title="Renommage + Drive"
            desc="JJ.MM.AA - Créditeur - Catégorie, upload vers Google Drive."
            state={drive.connected ? "ready" : "todo"}
            cta={{ href: "/connectors", label: "Brancher Drive" }}
            icon={HardDrive}
          />
        </section>

        <section className="card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <div className="text-[15px] font-semibold">Activité récente</div>
              <div className="text-[12px] text-muted">
                Les dernières factures du mois sélectionné.
              </div>
            </div>
            <Link
              href="/invoices"
              className="text-[12px] text-accent hover:underline flex items-center gap-1"
            >
              Voir tout <ArrowRight size={12} />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {recent.length === 0 ? (
              <div className="px-5 py-10 text-center text-muted text-[13px]">
                Aucune facture pour {formatMonthLabel(selectedMonth)}.
              </div>
            ) : (
              recent.map((inv) => (
                <Link
                  key={inv.id}
                  href={`/invoices#${inv.id}`}
                  className="px-5 py-3 flex items-center gap-4 hover:bg-panel2 transition-colors"
                >
                  <FileText size={16} className="text-muted shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] truncate">{inv.subject}</div>
                    <div className="text-[11px] text-muted truncate">
                      {inv.fromEmail} · {inv.mailbox}
                    </div>
                  </div>
                  <div className="text-[12px] text-muted w-28 text-right tabular-nums">
                    {formatAmount(inv.amount, inv.currency)}
                  </div>
                  <div className="w-32 text-right">
                    <StatusBadge status={inv.status} />
                  </div>
                  <div className="text-[11px] text-muted w-24 text-right">
                    {formatRelative(inv.receivedAt)}
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="grid grid-cols-2 gap-4">
          <Link
            href="/excel"
            className="card p-5 hover:bg-panel2 transition-colors group"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-panel2 border border-border flex items-center justify-center">
                <FileSpreadsheet size={18} className="text-accent" />
              </div>
              <div>
                <div className="text-[14px] font-medium">Rapprochement Excel</div>
                <div className="text-[12px] text-muted">
                  Charge le fichier comptable du mois, on surligne en vert les lignes matchées.
                </div>
              </div>
              <ArrowRight
                size={14}
                className="ml-auto text-muted group-hover:text-text transition-colors"
              />
            </div>
          </Link>

          <Link
            href="/manual"
            className="card p-5 hover:bg-panel2 transition-colors group"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-panel2 border border-border flex items-center justify-center">
                <AlertCircle size={18} className="text-warn" />
              </div>
              <div>
                <div className="text-[14px] font-medium">
                  Factures à trier ({counts.manual})
                </div>
                <div className="text-[12px] text-muted">
                  Aucune catégorie automatique trouvée ou pas de ligne Excel correspondante.
                </div>
              </div>
              <ArrowRight
                size={14}
                className="ml-auto text-muted group-hover:text-text transition-colors"
              />
            </div>
          </Link>
        </section>
      </div>
    </>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
  hint?: string;
  tone?: "neutral" | "ok" | "warn";
}) {
  const toneClass =
    tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-text";
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[12px] text-muted">{label}</div>
        <Icon size={16} className="text-muted" />
      </div>
      <div className={`text-[28px] font-semibold leading-none ${toneClass}`}>{value}</div>
      {hint && <div className="text-[11px] text-muted mt-2">{hint}</div>}
    </div>
  );
}

function PipelineStep({
  n,
  title,
  desc,
  state,
  cta,
  icon: Icon,
}: {
  n: number;
  title: string;
  desc: string;
  state: "ready" | "todo";
  cta: { href: string; label: string };
  icon: React.ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-7 h-7 rounded-full bg-panel2 border border-border flex items-center justify-center text-[12px] font-semibold text-muted">
          {n}
        </div>
        <Icon size={16} className="text-accent" />
        <div className="text-[14px] font-semibold">{title}</div>
        <span className={`badge ${state === "ready" ? "ok" : "warn"} ml-auto`}>
          {state === "ready" ? "Prêt" : "À configurer"}
        </span>
      </div>
      <div className="text-[12px] text-muted mb-4">{desc}</div>
      <Link href={cta.href} className="btn text-[12px]">
        {cta.label} <ArrowRight size={12} />
      </Link>
    </div>
  );
}

function FolderTreeIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
      <path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
      <path d="M3 5v6a2 2 0 0 0 2 2h8" />
      <path d="M3 5h0" />
    </svg>
  );
}
