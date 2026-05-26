"use client";

import { useState } from "react";
import { AnalyseHeader } from "@/components/analyse/AnalyseHeader";
import { KpiCard } from "@/components/analyse/KpiCard";
import { SeriesChart } from "@/components/analyse/SeriesChart";
import { BreakdownList } from "@/components/analyse/BreakdownList";
import { defaultPeriod, type Period } from "@/components/AnalysePeriodPicker";
import { mockBeneficeBrut } from "@/lib/analyse-mock";

export default function BeneficeBrutPage() {
  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const { kpis, series, byCategory } = mockBeneficeBrut(period);

  return (
    <>
      <AnalyseHeader
        title="Bénéfice brut"
        subtitle="CA − coûts directs (commissions processeur + infrastructure de prod)"
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
              isPercent={i === 1}
            />
          ))}
        </section>

        <section className="grid grid-cols-[2fr_1fr] gap-4">
          <SeriesChart data={series} title="Évolution mensuelle" />
          <BreakdownList title="Coûts directs par catégorie" items={byCategory} />
        </section>
      </div>
    </>
  );
}
