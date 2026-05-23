"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  AlertCircle,
  FolderTree,
  Mail,
  HardDrive,
  FileSpreadsheet,
  Activity,
  Banknote,
  Database,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { DbInfo } from "@/lib/store";

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  accent?: boolean;
  section?: string;
};

const items: NavItem[] = [
  { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/revenues", label: "Revenus", icon: Banknote, section: "Encaissements" },
  { href: "/invoices", label: "Factures", icon: FileText, section: "Dépenses" },
  { href: "/manual", label: "À traiter manuellement", icon: AlertCircle, accent: true },
  { href: "/excel", label: "Rapprochement Excel", icon: FileSpreadsheet },
  { href: "/mappings", label: "Classement comptable", icon: FolderTree, section: "Configuration" },
  { href: "/connectors", label: "Connexions", icon: Mail },
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export function Sidebar({
  manualCount = 0,
  dbInfo = null,
  ready = false,
  onReset,
}: {
  manualCount?: number;
  dbInfo?: DbInfo | null;
  ready?: boolean;
  onReset?: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-panel min-h-screen flex flex-col">
      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map((item, idx) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <div key={item.href}>
              {item.section && (
                <div
                  className={cn(
                    "text-[10px] uppercase tracking-wider text-muted px-3 pb-1.5",
                    idx > 0 ? "pt-4" : "",
                  )}
                >
                  {item.section}
                </div>
              )}
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] transition-colors",
                  active
                    ? "bg-panel2 text-text border border-border"
                    : "text-muted hover:text-text hover:bg-panel2 border border-transparent",
                )}
              >
                <Icon size={16} className={cn(active ? "text-accent" : "")} />
                <span className="flex-1">{item.label}</span>
                {item.accent && manualCount > 0 && (
                  <span className="badge warn">{manualCount}</span>
                )}
              </Link>
            </div>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border space-y-2">
        <div className="card p-3">
          <div className="flex items-center gap-2 mb-1.5">
            <Database size={13} className="text-accent" />
            <div className="text-[12px] font-medium">Postgres</div>
            <span
              className={`w-1.5 h-1.5 rounded-full ml-auto ${ready ? "bg-ok" : "bg-warn"}`}
              title={ready ? "Connectée" : "En attente…"}
            />
          </div>
          {dbInfo ? (
            <>
              <div className="text-[10px] text-muted font-mono truncate" title={dbInfo.file}>
                {dbInfo.file} {dbInfo.sizeBytes > 0 && `· ${formatBytes(dbInfo.sizeBytes)}`}
              </div>
              <div className="text-[10px] text-muted mt-1 tabular-nums">
                {dbInfo.counts.revenues} rev · {dbInfo.counts.invoices} fact ·{" "}
                {dbInfo.counts.mappings} cat
              </div>
            </>
          ) : (
            <div className="text-[10px] text-muted">Connexion à la DB…</div>
          )}
          {onReset && (
            <button
              onClick={() => {
                if (
                  confirm(
                    "Réinitialiser la base : supprime tout et restaure les données de démo. Continuer ?",
                  )
                ) {
                  onReset();
                }
              }}
              className="btn text-[10px] w-full justify-center mt-2 !px-2 !py-1"
              title="Vider et re-seeder la base"
            >
              <RotateCcw size={10} /> Réinitialiser
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
