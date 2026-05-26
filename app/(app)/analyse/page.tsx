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
  mockBeneficeBrut,
  mockEbitda,
  mockEbit,
  type KPI,
} from "@/lib/analyse-mock";
import { useAnalyseAggregates } from "@/lib/analyse-data";
import { formatAmount } from "@/lib/format";
import {
  TrendingUp,
  BarChart3,
  Coins,
  Activity,
  LineChart,
  Info,
} from "lucide-react";

type IconType = typeof TrendingUp;

export default function AnalysePage() {
  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const agg = useAnalyseAggregates(period);

  // Pour les sections "Bénéfice brut", EBITDA et EBIT on garde des mocks
  // tant qu'on n'a pas la donnée nécessaire (cogs, amortissements, etc.).
  const brut = mockBeneficeBrut(period);
  const ebitda = mockEbitda(period);
  const ebit = mockEbit(period);

  // KPIs réels CA — somme capturedAmount sur la période (USD).
  // 4 tuiles : CA total, Net, volume EMP, volume Centrobill.
  const volumeEmp = agg.byProcessor["EMP"] ?? 0;
  const volumeCentrobill = agg.byProcessor["Centrobill"] ?? 0;
  const caKpis: KPI[] = [
    {
      label: "Chiffre d'affaires",
      value: agg.totals.revenue,
      currency: "USD",
      hint: agg.loading
        ? "Chargement…"
        : "Somme des capturedAmount des revenus du mois (merchant pay).",
    },
    {
      label: "Net",
      value: agg.totals.net,
      currency: "USD",
      hint: "CA − dépenses (somme des débits des 3 rapprochements Excel).",
    },
    {
      label: "Volume EMP",
      value: volumeEmp,
      currency: "USD",
      hint: "Captured EMP, hors fees.",
    },
    {
      label: "Volume Centrobill",
      value: volumeCentrobill,
      currency: "USD",
      hint: volumeCentrobill > 0
        ? "Captured Centrobill, hors fees."
        : "Pas encore de revenus Centrobill saisis.",
    },
  ];

  // KPIs réels Bénéfice net = CA - dépenses (sommes des débits des 3 Excel).
  const marginPct = agg.totals.revenue > 0
    ? (agg.totals.net / agg.totals.revenue) * 100
    : 0;
  const netKpis: KPI[] = [
    {
      label: "Bénéfice net",
      value: agg.totals.net,
      currency: "USD",
      hint: "CA − somme des débits des 3 rapprochements Excel (USD/EUR/CHF, convertis en USD).",
    },
    {
      label: "Marge nette",
      value: marginPct,
      currency: "USD",
      hint: "Bénéfice net / CA.",
    },
    {
      label: "Total dépenses",
      value: agg.totals.expenses,
      currency: "USD",
      hint: "Somme des débits des 3 rapprochements Excel (convertis en USD).",
    },
    {
      label: "Nb de mois",
      value: agg.months.length,
      currency: "USD",
      hint: "Période couverte par les calculs.",
    },
  ];

  return (
    <>
      <PageHeader
        title="Analyse financière"
        subtitle={`Vue d'ensemble — ${formatPeriodLabel(period)}. CA et bénéfice net branchés sur les données réelles (revenus + rapprochements Excel). EBITDA / EBIT / Bénéfice brut restent à calculer.`}
        actions={<AnalysePeriodPicker value={period} onChange={setPeriod} />}
      />

      <div className="p-8 space-y-12">
        <Section
          icon={TrendingUp}
          title="Chiffre d'affaires"
          subtitle="Volume encaissé toutes activités confondues — depuis tes revenus saisis."
          live
        >
          <KpiGrid kpis={caKpis} />
          <div className="grid grid-cols-[2fr_1fr] gap-4">
            <SeriesChart
              data={agg.series}
              title="Évolution mensuelle (USD)"
              isLive
            />
            <BreakdownList
              title="Répartition par business"
              items={agg.byBusiness.map((b) => ({
                label: b.name,
                code: b.id,
                amount: b.amount,
                share: b.share,
                color: b.color,
              }))}
            />
          </div>
        </Section>

        <Section
          icon={Coins}
          title="Bénéfice net"
          subtitle="CA − dépenses (somme des débits des 3 rapprochements Excel, convertis en USD)."
          live
        >
          <KpiGrid kpis={netKpis} percentAt={1} countAt={[3]} />
          <SeriesChart
            data={agg.series}
            title="Évolution du résultat net (USD)"
            isLive
          />
          <ExpensesByCurrencyCard agg={agg} />
        </Section>

        <Section
          icon={BarChart3}
          title="Bénéfice brut"
          subtitle="CA − coûts directs (commissions processeur + infrastructure de prod) — à calculer."
        >
          <KpiGrid kpis={brut.kpis} percentAt={1} />
          <div className="grid grid-cols-[2fr_1fr] gap-4">
            <SeriesChart data={brut.series} title="Évolution mensuelle" />
            <BreakdownList title="Coûts directs par catégorie" items={brut.byCategory} />
          </div>
        </Section>

        <Section
          icon={Activity}
          title="EBITDA"
          subtitle="Résultat opérationnel avant intérêts, taxes, dépréciation & amortissement — à calculer."
        >
          <KpiGrid kpis={ebitda.kpis} percentAt={1} />
          <SeriesChart data={ebitda.series} title="Évolution EBITDA" />
        </Section>

        <Section
          icon={LineChart}
          title="EBIT"
          subtitle="Résultat d'exploitation — avant intérêts et impôts, mais après amortissements — à calculer."
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
  live,
}: {
  icon: IconType;
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Si true, affiche un badge "Live" à côté du titre pour distinguer du mock. */
  live?: boolean;
}) {
  return (
    <section className="space-y-4 scroll-mt-8">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-panel2 border border-border flex items-center justify-center shrink-0">
          <Icon size={16} className="text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
            {live ? (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-ok/10 text-ok border border-ok/30">
                Live
              </span>
            ) : (
              <span
                className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-warn/10 text-warn border border-warn/30 inline-flex items-center gap-1"
                title="Chiffres mock — sera branché plus tard."
              >
                <Info size={10} /> Mock
              </span>
            )}
          </div>
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
  countAt,
}: {
  kpis: KPI[];
  percentAt?: number;
  /** Indices (0-based) qui sont des compteurs entiers et non des montants. */
  countAt?: number[];
}) {
  const counts = new Set(countAt ?? []);
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
          isCount={counts.has(i)}
        />
      ))}
    </div>
  );
}

/** Détail "dépenses par devise" pour la section Bénéfice net — montre les
 *  3 buckets avec leur montant local + équivalent USD + nom du fichier. */
function ExpensesByCurrencyCard({ agg }: { agg: ReturnType<typeof useAnalyseAggregates> }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <div className="text-[13px] font-medium">
          Détail des dépenses par devise
        </div>
        <div className="text-[11px] text-muted">
          Somme directe des débits par fichier de rapprochement, et équivalent USD pour le total.
        </div>
      </div>
      <div className="divide-y divide-border">
        {agg.totals.expensesByCurrency.map((e) => (
          <div
            key={e.currency}
            className="px-5 py-2.5 flex items-center gap-3 text-[12px]"
          >
            <span className="font-mono text-[11px] w-12 shrink-0 text-accent">
              {e.currency}
            </span>
            <span className="truncate flex-1 min-w-0 text-muted" title={e.fileName ?? undefined}>
              {e.fileName ?? "Pas de fichier chargé sur la période"}
            </span>
            <span className="font-mono tabular-nums w-32 text-right">
              {formatAmount(e.amount, e.currency)}
            </span>
            <span className="font-mono tabular-nums w-32 text-right text-muted">
              ≈ {formatAmount(e.amountUsd, "USD")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
