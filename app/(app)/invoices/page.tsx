"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { InvoiceRow } from "@/components/InvoiceRow";
import { useInvoicesForCurrentMonth, formatMonthLabel, useStore } from "@/lib/store";
import { RefreshCw, Search, Trash2, Zap } from "lucide-react";
import type { InvoiceStatus } from "@/lib/types";

const filters: { id: "all" | InvoiceStatus; label: string }[] = [
  { id: "all", label: "Toutes" },
  { id: "analyzing", label: "Analyse" },
  { id: "classified", label: "Classées" },
  { id: "renamed", label: "Renommées" },
  { id: "uploaded", label: "Sur Drive" },
  { id: "matched", label: "Rapprochées Excel" },
  { id: "manual", label: "Manuel" },
];

export default function InvoicesPage() {
  const invoices = useInvoicesForCurrentMonth();
  const { selectedMonth, invoices: allInvoices, reloadFromDb } = useStore();
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("all");
  const [q, setQ] = useState("");
  const [wiping, setWiping] = useState(false);
  const [reprocessingStuck, setReprocessingStuck] = useState(false);

  const stuckCount = allInvoices.filter((i) => i.status === "analyzing").length;

  // Tant qu'il y a des factures bloquées en "analyzing", on rafraîchit
  // l'état toutes les 30 secondes — le cron Vercel les retraite en
  // arrière-plan (chaque minute), donc on verra leur status évoluer.
  useEffect(() => {
    if (stuckCount === 0) return;
    const id = setInterval(() => {
      void reloadFromDb();
    }, 30_000);
    return () => clearInterval(id);
  }, [stuckCount, reloadFromDb]);

  const reprocessStuck = async () => {
    if (stuckCount === 0) {
      alert("Aucune facture en analyse figée.");
      return;
    }
    setReprocessingStuck(true);
    try {
      const r = await fetch("/api/invoices/reprocess-stuck", { method: "POST" });
      const data = (await r.json().catch(() => null)) as
        | {
            ok?: boolean;
            total?: number;
            processed?: number;
            breakdown?: {
              manual: number;
              renamed: number;
              uploaded: number;
              matched: number;
              failed: number;
            };
            message?: string;
          }
        | null;
      if (!r.ok) {
        alert(`Échec : ${data?.message ?? `HTTP ${r.status}`}`);
        return;
      }
      await reloadFromDb();
      const b = data?.breakdown as
        | {
            matched: number;
            uploaded: number;
            renamed: number;
            manual: number;
            stillAnalyzing: number;
            noPdf: number;
          }
        | undefined;
      const summary = b
        ? `${data?.processed} traitée(s) sur ${data?.total}\n\nRépartition :\n• matched : ${b.matched}\n• uploaded : ${b.uploaded}\n• renamed : ${b.renamed}\n• manual : ${b.manual}\n• à retenter (échec) : ${b.stillAnalyzing}\n• sans PDF : ${b.noPdf}\n\nLes "à retenter" et "sans PDF" seront ré-essayées automatiquement chaque minute.`
        : `${data?.processed ?? 0} traitée(s)`;
      alert(summary);
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`);
    } finally {
      setReprocessingStuck(false);
    }
  };

  const wipeAll = async () => {
    const total = allInvoices.length;
    if (total === 0) {
      alert("Aucune facture à supprimer.");
      return;
    }
    if (
      !confirm(
        `Supprimer définitivement les ${total} facture(s) (tous mois, tous statuts) ?\n\nCette action ne touche pas aux mailboxes Gmail, mappings comptables, Drive ni revenus.`,
      )
    )
      return;
    setWiping(true);
    try {
      const r = await fetch("/api/invoices", { method: "DELETE" });
      if (!r.ok) {
        const txt = await r.text();
        alert(`Échec : HTTP ${r.status}\n${txt.slice(0, 200)}`);
        return;
      }
      await reloadFromDb();
    } finally {
      setWiping(false);
    }
  };

  const filtered = useMemo(() => {
    return invoices
      .filter((i) => (filter === "all" ? true : i.status === filter))
      .filter((i) =>
        q
          ? `${i.subject} ${i.creditor ?? ""} ${i.fromEmail} ${i.folderCode ?? ""} ${i.folderLabel ?? ""}`
              .toLowerCase()
              .includes(q.toLowerCase())
          : true,
      )
      .sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  }, [invoices, filter, q]);

  return (
    <>
      <PageHeader
        title="Factures"
        subtitle={`Factures détectées pour ${formatMonthLabel(selectedMonth)}, à chaque étape du pipeline.`}
        actions={
          <>
            {stuckCount > 0 && (
              <button
                onClick={reprocessStuck}
                disabled={reprocessingStuck}
                className="btn disabled:opacity-50"
                title="Le cron retentera automatiquement chaque minute — ce bouton force un retry immédiat."
              >
                {reprocessingStuck ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" /> Réveil…
                  </>
                ) : (
                  <>
                    <Zap size={14} /> Retenter maintenant ({stuckCount})
                  </>
                )}
              </button>
            )}
            <button
              onClick={wipeAll}
              disabled={wiping || allInvoices.length === 0}
              className="btn disabled:opacity-50"
              title="Supprimer toutes les factures (tous mois, tous statuts)"
            >
              <Trash2 size={14} />
              {wiping ? "Suppression…" : `Tout supprimer (${allInvoices.length})`}
            </button>
            <button className="btn btn-primary">
              <RefreshCw size={14} /> Synchroniser maintenant
            </button>
          </>
        }
      />

      <div className="p-8 space-y-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="input pl-9"
              placeholder="Rechercher (créditeur, expéditeur, code…)"
            />
          </div>
          <div className="flex items-center gap-1 ml-auto">
            {filters.map((f) => {
              const count =
                f.id === "all" ? invoices.length : invoices.filter((i) => i.status === f.id).length;
              return (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  className={`btn text-[12px] ${filter === f.id ? "!bg-panel2 !border-accent2" : ""}`}
                >
                  {f.label} <span className="text-muted">({count})</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="card overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-muted text-[13px]">
              Aucune facture ne correspond.
            </div>
          ) : (
            <>
              {/* En-tête de tableau */}
              <div className="px-5 py-2 border-b border-border flex items-center gap-4 text-[10px] uppercase tracking-wider text-muted">
                <span className="w-3.5 shrink-0" />
                <span className="w-4 shrink-0" />
                <span className="flex-1">Sujet / Créditeur</span>
                <span className="w-16 text-center">Compte</span>
                <span className="w-28 text-right">Montant</span>
                <span className="w-32 text-right">Statut</span>
                <span className="w-24 text-right">Reçue</span>
              </div>
              {filtered.map((inv) => <InvoiceRow key={inv.id} invoice={inv} />)}
            </>
          )}
        </div>
      </div>
    </>
  );
}
