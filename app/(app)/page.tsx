"use client";

import { useStore, useInvoicesForCurrentMonth } from "@/lib/store";
import { FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { DashboardChart } from "@/components/DashboardChart";

export default function DashboardPage() {
  const { mailboxes, mappings } = useStore();
  const invoices = useInvoicesForCurrentMonth();

  const counts = {
    total: invoices.length,
    processed: invoices.filter((i) =>
      ["classified", "renamed", "uploaded", "matched"].includes(i.status),
    ).length,
    manual: invoices.filter((i) => i.status === "manual").length,
    matched: invoices.filter((i) => i.status === "matched").length,
  };

  const connectedMb = mailboxes.filter((m) => m.connected).length;

  return (
    <div className="p-8 space-y-6">
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

      <DashboardChart />
    </div>
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
