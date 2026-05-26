"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileText,
  AlertCircle,
  FolderTree,
  Mail,
  FileSpreadsheet,
  Banknote,
  LogOut,
  User,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { SidebarMonthSelector } from "./SidebarMonthSelector";
import { SidebarAccountSelector } from "./SidebarAccountSelector";

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

export function Sidebar({
  manualCount = 0,
  userEmail = null,
}: {
  manualCount?: number;
  userEmail?: string | null;
}) {
  const pathname = usePathname();

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-panel min-h-screen flex flex-col">
      <SidebarMonthSelector />
      <SidebarAccountSelector />

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

      {userEmail && (
        <div className="p-3 border-t border-border">
          <div className="card p-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-panel2 border border-border flex items-center justify-center shrink-0">
                <User size={13} className="text-muted" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-muted">Connecté</div>
                <div className="text-[12px] font-medium truncate" title={userEmail}>
                  {userEmail}
                </div>
              </div>
              <form action="/api/auth/signout" method="post">
                <button
                  type="submit"
                  className="btn !px-2 !py-1.5"
                  title="Se déconnecter"
                >
                  <LogOut size={12} />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
