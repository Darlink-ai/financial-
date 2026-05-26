"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  TrendingUp,
  BarChart3,
  Coins,
  Activity,
  Repeat,
  LineChart,
  ChevronDown,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { SidebarMonthSelector } from "./SidebarMonthSelector";

type NavLeaf = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  badge?: "manual";
};

type NavGroup = {
  id: string;
  label: string;
  items: NavLeaf[];
};

const TOP_LEAF: NavLeaf = {
  href: "/",
  label: "Tableau de bord",
  icon: LayoutDashboard,
};

const GROUPS: NavGroup[] = [
  {
    id: "encaissements",
    label: "Encaissements",
    items: [{ href: "/revenues", label: "Revenus", icon: Banknote }],
  },
  {
    id: "depenses",
    label: "Dépenses",
    items: [
      { href: "/invoices", label: "Factures", icon: FileText },
      { href: "/manual", label: "À traiter manuellement", icon: AlertCircle, badge: "manual" },
      { href: "/excel", label: "Rapprochement Excel", icon: FileSpreadsheet },
    ],
  },
  {
    id: "analyse",
    label: "Analyse financière",
    items: [
      { href: "/analyse/ca", label: "Chiffre d'affaires", icon: TrendingUp },
      { href: "/analyse/benefice-brut", label: "Bénéfice brut", icon: BarChart3 },
      { href: "/analyse/benefice-net", label: "Bénéfice net", icon: Coins },
      { href: "/analyse/ebitda", label: "EBITDA", icon: Activity },
      { href: "/analyse/recurrents", label: "Factures récurrentes", icon: Repeat },
    ],
  },
  {
    id: "configuration",
    label: "Configuration",
    items: [
      { href: "/mappings", label: "Classement comptable", icon: FolderTree },
      { href: "/connectors", label: "Connexions", icon: Mail },
    ],
  },
];

const LS_COLLAPSED = "sidebar.collapsed";
const LS_OPEN_GROUPS = "sidebar.openGroups";

function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function Sidebar({
  manualCount = 0,
  userEmail = null,
}: {
  manualCount?: number;
  userEmail?: string | null;
}) {
  const pathname = usePathname();
  const onAnalysePage = pathname.startsWith("/analyse");

  const [collapsed, setCollapsed] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    encaissements: true,
    depenses: true,
    analyse: true,
    configuration: true,
  });
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage (avoid SSR mismatch).
  useEffect(() => {
    setCollapsed(readJSON<boolean>(LS_COLLAPSED, false));
    const stored = readJSON<Record<string, boolean>>(LS_OPEN_GROUPS, {});
    setOpenGroups((prev) => ({ ...prev, ...stored }));
    setHydrated(true);
  }, []);

  // Persist.
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(LS_COLLAPSED, JSON.stringify(collapsed));
  }, [collapsed, hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(LS_OPEN_GROUPS, JSON.stringify(openGroups));
  }, [openGroups, hydrated]);

  // Quand on collapse, on garde l'état mais on n'affiche pas les labels.
  const toggleGroup = (id: string) =>
    setOpenGroups((p) => ({ ...p, [id]: !p[id] }));

  return (
    <aside
      className={cn(
        "shrink-0 border-r border-border bg-panel min-h-screen flex flex-col sticky top-0 h-screen transition-[width] duration-200 ease-out",
        collapsed ? "w-[64px]" : "w-64",
      )}
    >
      {/* En-tête : titre + bouton collapse */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 pt-4 pb-3 border-b border-border",
          collapsed && "justify-center",
        )}
      >
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold tracking-tight">Factura</div>
            <div className="text-[10px] text-muted -mt-0.5">Famelink Finance</div>
          </div>
        )}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="btn !px-1.5 !py-1.5"
          title={collapsed ? "Déplier la sidebar" : "Replier la sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
        </button>
      </div>

      {/* Sélecteur de période (caché en mode collapsed) */}
      {!collapsed && <SidebarMonthSelector disabled={onAnalysePage} />}

      <nav className="flex-1 px-2 py-3 space-y-1 overflow-y-auto">
        {/* Tableau de bord — top-level */}
        <NavItem
          leaf={TOP_LEAF}
          active={pathname === TOP_LEAF.href}
          collapsed={collapsed}
          manualCount={manualCount}
        />

        {GROUPS.map((g) => {
          const isOpen = openGroups[g.id] ?? true;
          const groupHasActive = g.items.some((it) => pathname === it.href);
          return (
            <div key={g.id} className="pt-2">
              {!collapsed ? (
                <button
                  onClick={() => toggleGroup(g.id)}
                  className={cn(
                    "w-full flex items-center gap-2 px-2 py-1 rounded-md text-[10px] uppercase tracking-wider transition-colors",
                    groupHasActive ? "text-accent" : "text-muted hover:text-text",
                  )}
                >
                  <ChevronDown
                    size={11}
                    className={cn(
                      "transition-transform duration-150",
                      isOpen ? "rotate-0" : "-rotate-90",
                    )}
                  />
                  <span className="flex-1 text-left">{g.label}</span>
                </button>
              ) : (
                <div className="h-px bg-border/60 mx-3 my-2" />
              )}
              {(isOpen || collapsed) &&
                g.items.map((leaf) => (
                  <NavItem
                    key={leaf.href}
                    leaf={leaf}
                    active={pathname === leaf.href}
                    collapsed={collapsed}
                    manualCount={manualCount}
                  />
                ))}
            </div>
          );
        })}
      </nav>

      {userEmail && (
        <div className="p-3 border-t border-border">
          {!collapsed ? (
            <div className="card p-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-panel2 border border-border flex items-center justify-center shrink-0">
                  <User size={13} className="text-accent" />
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
          ) : (
            <form action="/api/auth/signout" method="post" className="flex justify-center">
              <button
                type="submit"
                className="btn !px-2 !py-2"
                title={`Se déconnecter (${userEmail})`}
              >
                <LogOut size={14} />
              </button>
            </form>
          )}
        </div>
      )}
    </aside>
  );
}

function NavItem({
  leaf,
  active,
  collapsed,
  manualCount,
}: {
  leaf: NavLeaf;
  active: boolean;
  collapsed: boolean;
  manualCount: number;
}) {
  const Icon = leaf.icon;
  return (
    <Link
      href={leaf.href}
      className={cn(
        "group flex items-center gap-3 rounded-lg text-[13px] transition-colors",
        collapsed ? "px-2 py-2 justify-center" : "px-3 py-2",
        active
          ? "bg-panel2 text-text border border-border shadow-[inset_0_0_0_1px_rgba(96,165,250,0.15)]"
          : "text-muted hover:text-text hover:bg-panel2 border border-transparent",
      )}
      title={collapsed ? leaf.label : undefined}
    >
      <Icon
        size={16}
        className={cn(
          "shrink-0 transition-colors",
          active ? "text-accent" : "text-muted group-hover:text-text",
        )}
      />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{leaf.label}</span>
          {leaf.badge === "manual" && manualCount > 0 && (
            <span className="badge warn">{manualCount}</span>
          )}
        </>
      )}
      {collapsed && leaf.badge === "manual" && manualCount > 0 && (
        <span className="absolute -translate-y-3 translate-x-3 w-1.5 h-1.5 rounded-full bg-warn" />
      )}
    </Link>
  );
}
