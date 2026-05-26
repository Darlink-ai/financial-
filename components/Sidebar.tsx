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
  Repeat,
  Wallet,
  Receipt,
  Settings,
  UploadCloud,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Landmark,
  Calculator,
  Percent,
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
  icon: typeof LayoutDashboard;
  items: NavLeaf[];
};

type NavEntry =
  | { kind: "leaf"; leaf: NavLeaf }
  | { kind: "group"; group: NavGroup };

// Sidebar structure : un seul leaf top-level (Tableau de bord), tout
// le reste est en groupes repliables. Tous les items top-level se
// rendent visuellement identiquement (même hauteur, même icône, même
// padding) — seul le chevron à droite distingue un groupe d'une feuille.
const ENTRIES: NavEntry[] = [
  {
    kind: "leaf",
    leaf: { href: "/", label: "Tableau de bord", icon: LayoutDashboard },
  },
  {
    kind: "group",
    group: {
      id: "encaissements",
      label: "Encaissements",
      icon: Wallet,
      items: [{ href: "/revenues", label: "Revenus", icon: Banknote }],
    },
  },
  {
    kind: "group",
    group: {
      id: "depenses",
      label: "Dépenses",
      icon: Receipt,
      items: [
        { href: "/invoices", label: "Factures", icon: FileText },
        { href: "/manual", label: "À traiter manuellement", icon: AlertCircle, badge: "manual" },
        { href: "/import", label: "Ajout manuel", icon: UploadCloud },
        { href: "/excel", label: "Rapprochement Excel", icon: FileSpreadsheet },
      ],
    },
  },
  {
    kind: "group",
    group: {
      id: "taxes",
      label: "Taxes",
      icon: Landmark,
      items: [
        { href: "/taxes/impots", label: "Impôts", icon: Calculator },
        { href: "/taxes/tva", label: "TVA", icon: Percent },
      ],
    },
  },
  {
    kind: "group",
    group: {
      id: "analyse",
      label: "Analyse financière",
      icon: TrendingUp,
      items: [
        { href: "/analyse", label: "Vue d'ensemble", icon: TrendingUp },
        { href: "/analyse/recurrents", label: "Factures récurrentes", icon: Repeat },
      ],
    },
  },
  {
    kind: "group",
    group: {
      id: "configuration",
      label: "Configuration",
      icon: Settings,
      items: [
        { href: "/mappings", label: "Classement comptable", icon: FolderTree },
        { href: "/connectors", label: "Connexions", icon: Mail },
      ],
    },
  },
];

const LS_COLLAPSED = "sidebar.collapsed";
// v3 : refonte structure (Factures récurrentes déplacée sous Analyse,
// groupes uniformisés). Re-démarrage avec tout fermé.
const LS_OPEN_GROUPS = "sidebar.openGroups.v3";

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
  // Tous les groupes fermés par défaut — l'utilisateur ouvre ce dont il
  // a besoin. Si une page active est dans un groupe, on l'ouvre quand
  // même au montage pour qu'il puisse voir où il est.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage (avoid SSR mismatch).
  useEffect(() => {
    setCollapsed(readJSON<boolean>(LS_COLLAPSED, false));
    const stored = readJSON<Record<string, boolean>>(LS_OPEN_GROUPS, {});
    // On part de "tout fermé", puis on applique l'état sauvegardé,
    // puis on force l'ouverture du groupe contenant la page courante.
    const next: Record<string, boolean> = { ...stored };
    for (const e of ENTRIES) {
      if (e.kind === "group" && e.group.items.some((it) => pathname === it.href)) {
        next[e.group.id] = true;
      }
    }
    setOpenGroups(next);
    setHydrated(true);
  }, [pathname]);

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
      {/* Bouton flottant de repli, à cheval sur la frontière sidebar / contenu */}
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="absolute top-1/2 -translate-y-1/2 right-0 translate-x-1/2 z-40 w-6 h-10 rounded-md bg-panel2 border border-border hover:border-borderHover text-muted hover:text-text flex items-center justify-center transition-colors shadow-[0_4px_12px_-4px_rgba(0,0,0,0.6)]"
        title={collapsed ? "Déplier la sidebar" : "Replier la sidebar"}
      >
        {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
      </button>

      {/* Sélecteur de période (caché en mode collapsed) */}
      {!collapsed && <SidebarMonthSelector disabled={onAnalysePage} />}

      <nav
        className={cn(
          "flex-1 px-2 space-y-1 overflow-y-auto pb-3",
          collapsed ? "pt-4" : "pt-3",
        )}
      >
        {ENTRIES.map((entry) => {
          if (entry.kind === "leaf") {
            return (
              <NavItem
                key={entry.leaf.href}
                leaf={entry.leaf}
                active={pathname === entry.leaf.href}
                collapsed={collapsed}
                manualCount={manualCount}
              />
            );
          }

          const g = entry.group;
          const isOpen = openGroups[g.id] ?? false;
          const groupHasActive = g.items.some((it) => pathname === it.href);
          const GroupIcon = g.icon;

          // Total des badges "manual" sur les enfants — agrégé sur le header.
          const aggregateManual = g.items.reduce(
            (n, it) => n + (it.badge === "manual" ? manualCount : 0),
            0,
          );

          return (
            <div key={g.id}>
              {/* En-tête de groupe rendu au MÊME format qu'un leaf
                  (mêmes padding, icône, taille) — seul le chevron à
                  droite et la fonction click distinguent. */}
              {!collapsed ? (
                <button
                  onClick={() => toggleGroup(g.id)}
                  className={cn(
                    "group w-full flex items-center gap-3 rounded-lg text-[13px] transition-colors px-3 py-2",
                    groupHasActive
                      ? "bg-panel2/60 text-text border border-border"
                      : "text-muted hover:text-text hover:bg-panel2 border border-transparent",
                  )}
                >
                  <GroupIcon
                    size={16}
                    className={cn(
                      "shrink-0 transition-colors",
                      groupHasActive ? "text-accent" : "text-muted group-hover:text-text",
                    )}
                  />
                  <span className="flex-1 text-left truncate">{g.label}</span>
                  {aggregateManual > 0 && !isOpen && (
                    <span className="badge warn">{aggregateManual}</span>
                  )}
                  <ChevronDown
                    size={13}
                    className={cn(
                      "shrink-0 text-muted transition-transform duration-150",
                      isOpen ? "rotate-0" : "-rotate-90",
                    )}
                  />
                </button>
              ) : (
                // Mode replié : on affiche juste l'icône cliquable du groupe,
                // qui ouvre le groupe et déplie la sidebar.
                <button
                  onClick={() => {
                    setCollapsed(false);
                    setOpenGroups((p) => ({ ...p, [g.id]: true }));
                  }}
                  title={g.label}
                  className={cn(
                    "group w-full flex items-center justify-center rounded-lg px-2 py-2 transition-colors",
                    groupHasActive
                      ? "bg-panel2 text-text border border-border"
                      : "text-muted hover:text-text hover:bg-panel2 border border-transparent",
                  )}
                >
                  <GroupIcon
                    size={16}
                    className={groupHasActive ? "text-accent" : "text-muted group-hover:text-text"}
                  />
                </button>
              )}

              {/* Sous-items, indentés. Cachés en mode replié. */}
              {!collapsed && isOpen && (
                <div className="ml-3 mt-0.5 mb-1 pl-3 border-l border-border/60 space-y-0.5">
                  {g.items.map((leaf) => (
                    <NavItem
                      key={leaf.href}
                      leaf={leaf}
                      active={pathname === leaf.href}
                      collapsed={false}
                      manualCount={manualCount}
                      compact
                    />
                  ))}
                </div>
              )}
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
  compact = false,
}: {
  leaf: NavLeaf;
  active: boolean;
  collapsed: boolean;
  manualCount: number;
  /** Sous-items d'un groupe : padding et texte réduits. */
  compact?: boolean;
}) {
  const Icon = leaf.icon;
  return (
    <Link
      href={leaf.href}
      className={cn(
        "group flex items-center gap-3 rounded-lg transition-colors",
        compact ? "text-[12px] px-2.5 py-1.5" : "text-[13px] px-3 py-2",
        collapsed ? "!px-2 !py-2 justify-center" : "",
        active
          ? "bg-panel2 text-text border border-border shadow-[inset_0_0_0_1px_rgba(96,165,250,0.15)]"
          : "text-muted hover:text-text hover:bg-panel2 border border-transparent",
      )}
      title={collapsed ? leaf.label : undefined}
    >
      <Icon
        size={compact ? 14 : 16}
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
