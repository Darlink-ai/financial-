"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { InvoiceRow } from "@/components/InvoiceRow";
import { useInvoicesForCurrentMonth, formatMonthLabel, useStore } from "@/lib/store";
import { RefreshCw, Search } from "lucide-react";
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
  const { selectedMonth } = useStore();
  const [filter, setFilter] = useState<(typeof filters)[number]["id"]>("all");
  const [q, setQ] = useState("");

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
          <button className="btn btn-primary">
            <RefreshCw size={14} /> Synchroniser maintenant
          </button>
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
