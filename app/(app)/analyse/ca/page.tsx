"use client";

import { useState } from "react";
import { AnalyseHeader } from "@/components/analyse/AnalyseHeader";
import { KpiCard } from "@/components/analyse/KpiCard";
import { SeriesChart } from "@/components/analyse/SeriesChart";
import { BreakdownList } from "@/components/analyse/BreakdownList";
import { defaultPeriod, type Period } from "@/components/AnalysePeriodPicker";
import { mockCA } from "@/lib/analyse-mock";

export default function CAPage() {
  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const { kpis, series, byBusiness } = mockCA(period);

  return (
    <>
      <AnalyseHeader
        title="Chiffre d'affaires"
        subtitle="Volume encaissé toutes activités confondues"
        period={period}
        onChangePeriod={setPeriod}
      />

      <div className="p-8 space-y-6">
        <section className="grid grid-cols-4 gap-4">
          {kpis.map((k, i) => (
            <KpiCard
              key={k.label}
              label={k.label}
              value={k.value}
              currency={k.currency}
              delta={k.delta}
              hint={k.hint}
              highlight={i === 0}
            />
          ))}
        </section>

        <section className="grid grid-cols-[2fr_1fr] gap-4">
          <SeriesChart data={series} title="Évolution mensuelle" />
          <BreakdownList title="Répartition par business" items={byBusiness} />
        </section>
      </div>
    </>
  );
}
