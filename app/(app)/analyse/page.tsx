"use client";

import { useState, type ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";
import { KpiCard } from "@/components/analyse/KpiCard";
import { SeriesChart } from "@/components/analyse/SeriesChart";
import { BreakdownList } from "@/components/analyse/BreakdownList";
import {
  AnalysePeriodPicker,
  defaultPeriod,
  formatPeriodLabel,
  type Period,
} from "@/components/AnalysePeriodPicker";
import {
  mockCA,
  mockBeneficeBrut,
  mockBeneficeNet,
  mockEbitda,
  mockEbit,
  type KPI,
} from "@/lib/analyse-mock";
import {
  TrendingUp,
  BarChart3,
  Coins,
  Activity,
  LineChart,
} from "lucide-react";

type IconType = typeof TrendingUp;

export default function AnalysePage() {
  const [period, setPeriod] = useState<Period>(defaultPeriod());

  const ca = mockCA(period);
  const brut = mockBeneficeBrut(period);
  const net = mockBeneficeNet(period);
  const ebitda = mockEbitda(period);
  const ebit = mockEbit(period);

  return (
    <>
      <PageHeader
        title="Analyse financière"
        subtitle={`Vue d'ensemble — ${formatPeriodLabel(period)}. CA, marges et résultats opérationnels, toutes les données du mock-up pour l'instant.`}
        actions={<AnalysePeriodPicker value={period} onChange={setPeriod} />}
      />

      <div className="p-8 space-y-12">
        <Section
          icon={TrendingUp}
          title="Chiffre d'affaires"
          subtitle="Volume encaissé toutes activités confondues"
        >
          <KpiGrid kpis={ca.kpis} />
          <div className="grid grid-cols-[2fr_1fr] gap-4">
            <SeriesChart data={ca.series} title="Évolution mensuelle" />
            <BreakdownList title="Répartition par business" items={ca.byBusiness} />
          </div>
        </Section>

        <Section
          icon={BarChart3}
          title="Bénéfice brut"
          subtitle="CA − coûts directs (commissions processeur + infrastructure de prod)"
        >
          <KpiGrid kpis={brut.kpis} percentAt={1} />
          <div className="grid grid-cols-[2fr_1fr] gap-4">
            <SeriesChart data={brut.series} title="Évolution mensuelle" />
            <BreakdownList title="Coûts directs par catégorie" items={brut.byCategory} />
          </div>
        </Section>

        <Section
          icon={Coins}
          title="Bénéfice net"
          subtitle="Résultat après impôts, charges financières et exceptionnelles"
        >
          <KpiGrid kpis={net.kpis} percentAt={1} />
          <SeriesChart data={net.series} title="Évolution du résultat net" />
        </Section>

        <Section
          icon={Activity}
          title="EBITDA"
          subtitle="Résultat opérationnel avant intérêts, taxes, dépréciation & amortissement"
        >
          <KpiGrid kpis={ebitda.kpis} percentAt={1} />
          <SeriesChart data={ebitda.series} title="Évolution EBITDA" />
        </Section>

        <Section
          icon={LineChart}
          title="EBIT"
          subtitle="Résultat d'exploitation — avant intérêts et impôts, mais après amortissements"
        >
          <KpiGrid kpis={ebit.kpis} percentAt={1} />
          <SeriesChart data={ebit.series} title="Évolution EBIT" />
        </Section>
      </div>
    </>
  );
}

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: IconType;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 scroll-mt-8">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-panel2 border border-border flex items-center justify-center shrink-0">
          <Icon size={16} className="text-accent" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
          <p className="text-[12px] text-muted truncate">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function KpiGrid({
  kpis,
  percentAt,
}: {
  kpis: KPI[];
  percentAt?: number;
}) {
  return (
    <div className="grid grid-cols-4 gap-4">
      {kpis.map((k, i) => (
        <KpiCard
          key={k.label}
          label={k.label}
          value={k.value}
          currency={k.currency}
          delta={k.delta}
          hint={k.hint}
          highlight={i === 0}
          isPercent={i === percentAt}
        />
      ))}
    </div>
  );
}
