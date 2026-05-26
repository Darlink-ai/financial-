"use client";

import { useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/analyse/KpiCard";
import { BreakdownList } from "@/components/analyse/BreakdownList";
import {
  AnalysePeriodPicker,
  defaultPeriod,
  formatPeriodLabel,
  type Period,
} from "@/components/AnalysePeriodPicker";
import { mockRecurringInvoices, type RecurringInvoice } from "@/lib/analyse-mock";
import { formatAmount, formatSwissDate } from "@/lib/format";
import { Repeat, CheckCircle2, PauseCircle, Search } from "lucide-react";

type Filter = "all" | "active" | "inactive";

// Conversion ultra-simplifiée vers USD pour les KPI agrégés. À remplacer
// par les vrais taux de change au moment de brancher la DB.
const FX: Record<string, number> = { USD: 1, EUR: 1.08, CHF: 1.12 };

function monthlyUsd(inv: RecurringInvoice): number {
  const usd = inv.amount * (FX[inv.currency] ?? 1);
  if (inv.cadence === "Mensuel") return usd;
  if (inv.cadence === "Trimestriel") return usd / 3;
  return usd / 12;
}

export default function RecurrentsPage() {
  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");

  const visible = useMemo(() => {
    return mockRecurringInvoices
      .filter((r) =>
        filter === "all" ? true : filter === "active" ? r.active : !r.active,
      )
      .filter((r) =>
        query.trim() === ""
          ? true
          : `${r.creditor} ${r.category} ${r.categoryCode}`
              .toLowerCase()
              .includes(query.trim().toLowerCase()),
      );
  }, [filter, query]);

  const activeCount = mockRecurringInvoices.filter((r) => r.active).length;
  const inactiveCount = mockRecurringInvoices.filter((r) => !r.active).length;

  const monthlyTotal = mockRecurringInvoices
    .filter((r) => r.active)
    .reduce((s, r) => s + monthlyUsd(r), 0);
  const annualTotal = monthlyTotal * 12;

  // Répartition par catégorie (sur les abos actifs)
  const byCat = useMemo(() => {
    const map = new Map<string, { label: string; code: string; amount: number }>();
    for (const r of mockRecurringInvoices) {
      if (!r.active) continue;
      const existing = map.get(r.categoryCode);
      const monthly = monthlyUsd(r);
      if (existing) existing.amount += monthly;
      else
        map.set(r.categoryCode, {
          label: r.category,
          code: r.categoryCode,
          amount: monthly,
        });
    }
    const colors = ["#60a5fa", "#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#f87171"];
    const list = Array.from(map.values()).sort((a, b) => b.amount - a.amount);
    const total = list.reduce((s, x) => s + x.amount, 0) || 1;
    return list.map((x, i) => ({
      label: x.label,
      code: x.code,
      amount: x.amount,
      share: (x.amount / total) * 100,
      color: colors[i % colors.length],
    }));
  }, []);

  return (
    <>
      <PageHeader
        title="Factures récurrentes"
        subtitle={`Abonnements, loyers, assurances — ${formatPeriodLabel(period)}`}
        actions={<AnalysePeriodPicker value={period} onChange={setPeriod} />}
      />

      <div className="p-8 space-y-6">
        <section className="grid grid-cols-4 gap-4">
          <KpiCard
            label="Coût récurrent / mois"
            value={monthlyTotal}
            currency="USD"
            hint={`Sur ${activeCount} abonnements actifs, en équiv. USD`}
            highlight
          />
          <KpiCard
            label="Coût récurrent / an"
            value={annualTotal}
            currency="USD"
            hint="Projection annuelle des abos actifs"
          />
          <KpiCard
            label="Abonnements actifs"
            value={activeCount}
            currency="USD"
            isCount
            hint="Encore débités automatiquement"
          />
          <KpiCard
            label="Résiliés / suspendus"
            value={inactiveCount}
            currency="USD"
            isCount
            hint="Plus prélevés — gardés pour archives"
          />
        </section>

        <section className="grid grid-cols-[2fr_1fr] gap-4 items-start">
          {/* Liste des abos */}
          <div className="card">
            <div className="flex items-center gap-3 px-5 py-3 border-b border-border flex-wrap">
              <div className="text-[14px] font-medium flex items-center gap-2">
                <Repeat size={14} className="text-accent" />
                Abonnements détectés
              </div>
              <div className="ml-auto flex items-center gap-2">
                <div className="relative">
                  <Search
                    size={12}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                  />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Rechercher…"
                    className="input !py-1.5 !pl-7 !pr-3 text-[12px] w-[160px]"
                  />
                </div>
                <div className="card !rounded-lg p-1 flex items-center gap-0.5">
                  {(["active", "inactive", "all"] as Filter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                        filter === f
                          ? "bg-panel2 text-text border border-border"
                          : "text-muted hover:text-text border border-transparent"
                      }`}
                    >
                      {f === "active" ? "Actifs" : f === "inactive" ? "Résiliés" : "Tous"}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="divide-y divide-border">
              {visible.length === 0 ? (
                <div className="px-5 py-10 text-center text-muted text-[13px]">
                  Aucun abonnement ne correspond.
                </div>
              ) : (
                visible.map((r) => (
                  <div key={r.id} className="px-5 py-3 flex items-center gap-4">
                    <div
                      className={`w-7 h-7 rounded-full border flex items-center justify-center shrink-0 ${
                        r.active
                          ? "bg-ok/10 border-ok/30 text-ok"
                          : "bg-panel2 border-border text-muted"
                      }`}
                    >
                      {r.active ? (
                        <CheckCircle2 size={14} />
                      ) : (
                        <PauseCircle size={14} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate">
                        {r.creditor}
                      </div>
                      <div className="text-[11px] text-muted truncate">
                        {r.category}
                        <span className="font-mono mx-1.5 text-[10px] opacity-70">
                          {r.categoryCode}
                        </span>
                        · {r.cadence}
                        {r.notes ? ` · ${r.notes}` : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-[13px] font-medium tabular-nums">
                        {formatAmount(r.amount, r.currency)}
                      </div>
                      <div className="text-[10px] text-muted">
                        {r.cadence === "Mensuel"
                          ? "/ mois"
                          : r.cadence === "Trimestriel"
                          ? "/ trim."
                          : "/ an"}
                      </div>
                    </div>
                    <div className="text-right shrink-0 w-28">
                      <div className="text-[10px] text-muted uppercase tracking-wider">
                        Prochain
                      </div>
                      <div className="text-[12px] tabular-nums">
                        {formatSwissDate(r.nextChargeAt)}
                      </div>
                    </div>
                    <span
                      className={`badge ${r.active ? "ok" : ""}`}
                    >
                      {r.active ? "Actif" : "Résilié"}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <BreakdownList
            title="Coût mensuel par catégorie"
            items={byCat}
            currency="USD"
          />
        </section>

        <div className="text-[11px] text-muted">
          Mock-up — la détection automatique des récurrences (basée sur l'historique de factures
          Gmail) sera branchée dans une prochaine itération.
        </div>
      </div>
    </>
  );
}
