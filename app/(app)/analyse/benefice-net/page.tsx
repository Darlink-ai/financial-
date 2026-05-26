"use client";

import { useState } from "react";
import { AnalyseHeader } from "@/components/analyse/AnalyseHeader";
import { KpiCard } from "@/components/analyse/KpiCard";
import { SeriesChart } from "@/components/analyse/SeriesChart";
import { defaultPeriod, type Period } from "@/components/AnalysePeriodPicker";
import { mockBeneficeNet } from "@/lib/analyse-mock";

export default function BeneficeNetPage() {
  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const { kpis, series } = mockBeneficeNet(period);

  return (
    <>
      <AnalyseHeader
        title="Bénéfice net"
        subtitle="Résultat après impôts, charges financières et exceptionnelles"
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

        <section>
          <SeriesChart data={series} title="Évolution du résultat net" />
        </section>
      </div>
    </>
  );
}
