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
import { type KPI } from "@/lib/analyse-mock";
import {
  DISPLAY_CURRENCY,
  useAnalyseAggregates,
} from "@/lib/analyse-data";
import { useFinancials, type MonthlyPnl } from "@/lib/analyse-financials";
import { RollingReserveChart } from "@/components/analyse/RollingReserveChart";
import { formatAmount } from "@/lib/format";
import { formatMonthLabel } from "@/lib/store";
import {
  TrendingUp,
  BarChart3,
  Coins,
  Activity,
  LineChart,
  Info,
  ArrowRightLeft,
  Lock,
} from "lucide-react";

type IconType = typeof TrendingUp;

export default function AnalysePage() {
  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const agg = useAnalyseAggregates(period);
  // P&L LIVE — recalcul auto à chaque validation de facture (les charges
  // sont ventilées par folder_code via lib/analyse-financials).
  const pnl = useFinancials(period);

  const beneficeBrutKpis: KPI[] = [
    {
      label: "Bénéfice brut",
      value: pnl.totals.beneficeBrut,
      currency: DISPLAY_CURRENCY,
      hint: "CA − Coûts directs (COGS = folder_codes 4xxx). Ce que génère l'activité avant charges d'exploitation.",
    },
    {
      label: "Marge brute",
      value: pnl.totals.revenue > 0
        ? (pnl.totals.beneficeBrut / pnl.totals.revenue) * 100
        : 0,
      currency: DISPLAY_CURRENCY,
      hint: "Bénéfice brut / Chiffre d'affaires.",
    },
    {
      label: "Chiffre d'affaires",
      value: pnl.totals.revenue,
      currency: DISPLAY_CURRENCY,
      hint: "Somme des revenus saisis sur la période, convertie en CHF au taux du mois.",
    },
    {
      label: "Coûts directs (COGS)",
      value: pnl.totals.cogs,
      currency: DISPLAY_CURRENCY,
      hint: "Somme des factures matched avec folder_code commençant par 4 (achats de marchandises et prestations, commissions processeur, infrastructure de prod).",
    },
  ];

  const ebitdaKpis: KPI[] = [
    {
      label: "EBITDA",
      value: pnl.totals.ebitda,
      currency: DISPLAY_CURRENCY,
      hint: "Bénéfice brut − Charges de personnel − Autres charges d'exploitation. Résultat opérationnel avant amortissements, intérêts et impôts.",
    },
    {
      label: "Marge EBITDA",
      value: pnl.totals.revenue > 0
        ? (pnl.totals.ebitda / pnl.totals.revenue) * 100
        : 0,
      currency: DISPLAY_CURRENCY,
      hint: "EBITDA / Chiffre d'affaires.",
    },
    {
      label: "Charges de personnel",
      value: pnl.totals.personnel,
      currency: DISPLAY_CURRENCY,
      hint: "Somme des factures matched avec folder_code 5xxx (salaires, mandats indépendants, charges sociales).",
    },
    {
      label: "Autres charges d'exploit.",
      value: pnl.totals.autresCharges,
      currency: DISPLAY_CURRENCY,
      hint: "Somme des factures matched avec folder_code 6xxx sauf 68xx (loyer, marketing, IT, admin) + factures non classées.",
    },
  ];

  const ebitKpis: KPI[] = [
    {
      label: "EBIT",
      value: pnl.totals.ebit,
      currency: DISPLAY_CURRENCY,
      hint: "EBITDA − Amortissements et corrections de valeur. Résultat d'exploitation courant (Earnings Before Interest and Taxes).",
    },
    {
      label: "Marge EBIT",
      value: pnl.totals.revenue > 0
        ? (pnl.totals.ebit / pnl.totals.revenue) * 100
        : 0,
      currency: DISPLAY_CURRENCY,
      hint: "EBIT / Chiffre d'affaires.",
    },
    {
      label: "Amortissements",
      value: pnl.totals.amortissements,
      currency: DISPLAY_CURRENCY,
      hint: "Somme des factures matched avec folder_code 68xx. Généralement 0 côté factures — les amortissements sont saisis manuellement en compta.",
    },
    {
      label: "Bénéfice net",
      value: pnl.totals.beneficeNet,
      currency: DISPLAY_CURRENCY,
      hint: "EBIT − Charges financières (69xx) − Impôts (85xx). Ce qui reste après tout.",
    },
  ];

  // KPIs réels CA — somme capturedAmount sur la période, convertie en CHF
  // via taux moyens mensuels. 4 tuiles : CA total, Net, Volume EMP, Volume Centrobill.
  const volumeEmp = agg.byProcessor["EMP"] ?? 0;
  const volumeCentrobill = agg.byProcessor["Centrobill"] ?? 0;
  const caKpis: KPI[] = [
    {
      label: "Chiffre d'affaires",
      value: agg.totals.revenue,
      currency: DISPLAY_CURRENCY,
      hint: agg.loading
        ? "Chargement…"
        : "Somme des revenus du mois, convertie en CHF via taux moyens.",
    },
    {
      label: "Net",
      value: agg.totals.net,
      currency: DISPLAY_CURRENCY,
      hint: "CA − dépenses (somme des débits des 3 rapprochements Excel, le tout en CHF).",
    },
    {
      label: "Volume EMP",
      value: volumeEmp,
      currency: DISPLAY_CURRENCY,
      hint: "Captured EMP (CHF), hors fees.",
    },
    {
      label: "Volume Centrobill",
      value: volumeCentrobill,
      currency: DISPLAY_CURRENCY,
      hint: volumeCentrobill > 0
        ? "Captured Centrobill (CHF), hors fees."
        : "Pas encore de revenus Centrobill saisis.",
    },
  ];

  // KPIs réels Bénéfice net = CA - dépenses (sommes des débits des 3 Excel,
  // convertis en CHF).
  const marginPct = agg.totals.revenue > 0
    ? (agg.totals.net / agg.totals.revenue) * 100
    : 0;
  const netKpis: KPI[] = [
    {
      label: "Bénéfice net",
      value: agg.totals.net,
      currency: DISPLAY_CURRENCY,
      hint: "CA − somme des débits des 3 rapprochements Excel (tout en CHF).",
    },
    {
      label: "Marge nette",
      value: marginPct,
      currency: DISPLAY_CURRENCY,
      hint: "Bénéfice net / CA.",
    },
    {
      label: "Total dépenses",
      value: agg.totals.expenses,
      currency: DISPLAY_CURRENCY,
      hint: "Somme des débits des 3 rapprochements Excel (convertis en CHF).",
    },
    {
      label: "Nb de mois",
      value: agg.months.length,
      currency: DISPLAY_CURRENCY,
      hint: "Période couverte par les calculs.",
    },
  ];

  return (
    <>
      <PageHeader
        title="Analyse financière"
        subtitle={`Vue d'ensemble — ${formatPeriodLabel(period)}. Tout est en CHF (taux moyens du mois). EBITDA / EBIT / Bénéfice brut restent à calculer.`}
        actions={<AnalysePeriodPicker value={period} onChange={setPeriod} />}
      />

      <div className="p-8 space-y-8">
        {/* Bandeau FX : indique les taux utilisés pour la conversion CHF. */}
        <FxRatesBanner agg={agg} />

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
              title="Évolution mensuelle (CHF)"
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
          subtitle="CA − dépenses (somme des débits des 3 rapprochements Excel, tout en CHF)."
          live
        >
          <KpiGrid kpis={netKpis} percentAt={1} countAt={[3]} />
          <SeriesChart
            data={agg.series}
            title="Évolution du résultat net (CHF)"
            isLive
          />
          <ExpensesByCurrencyCard agg={agg} />
        </Section>

        <Section
          icon={BarChart3}
          title="Bénéfice brut"
          subtitle="CA − Coûts directs. Ventilation des dépenses depuis le folder_code des factures matched."
          titleTooltip="Bénéfice brut = Chiffre d'affaires − Coûts directs (COGS). Les coûts directs sont ceux qu'on ne pourrait pas éviter en vendant plus : commissions processeur, infrastructure de prod (RunPod, DigitalOcean…), matières premières. Classification automatique : folder_codes commençant par 4."
          live
        >
          <KpiGrid kpis={beneficeBrutKpis} percentAt={1} />
        </Section>

        <Section
          icon={Activity}
          title="EBITDA"
          subtitle="Résultat opérationnel avant amortissements, intérêts et impôts."
          titleTooltip="EBITDA = Earnings Before Interest, Taxes, Depreciation and Amortization. Calcul : Bénéfice brut − Charges de personnel (5xxx) − Autres charges d'exploitation (6xxx sauf 68xx). Mesure la performance opérationnelle brute de l'activité."
          live
        >
          <KpiGrid kpis={ebitdaKpis} percentAt={1} />
        </Section>

        <Section
          icon={LineChart}
          title="EBIT et Bénéfice net"
          subtitle="Résultat d'exploitation après amortissements, puis après charges financières et impôts."
          titleTooltip="EBIT = Earnings Before Interest and Taxes = EBITDA − Amortissements (68xx). Bénéfice net = EBIT − Charges financières (69xx) − Impôts (85xx). Si tu n'as pas encore saisi d'amortissements ou d'impôts dans les factures, EBIT ≈ EBITDA et Bénéfice net ≈ EBIT."
          live
        >
          <KpiGrid kpis={ebitKpis} percentAt={1} />
        </Section>

        <Section
          icon={BarChart3}
          title="Tableau mensuel — allocation revenus & charges"
          subtitle={`${pnl.matchedInvoiceCount} factures validées incluses${pnl.uncategorizedCount > 0 ? ` · ${pnl.uncategorizedCount} sans code (comptées dans autres charges)` : ""}. Tout est recalculé au fur et à mesure des validations.`}
          live
        >
          <PnlMonthlyTable byMonth={pnl.byMonth} totals={pnl.totals} />
        </Section>

        <Section
          icon={Lock}
          title="Rolling reserve chez EMP"
          subtitle="Montant retenu par le processeur en garantie, libéré 6 mois plus tard. C'est une créance immobilisée, PAS une charge — donc non déduit de la marge nette ci-dessus."
          titleTooltip="EMP retient un % du capturé chaque mois (rollingReservePercent, typiquement 10%) et libère un montant équivalent d'une période d'il y a 6 mois. Le graphique montre le stock cumulé bloqué chez EMP mois par mois — calculé sur TOUT l'historique pour que la valeur initiale reflète les mois hors période visible."
          live
        >
          <RollingReserveChart months={pnl.months} processorFilter="EMP" />
        </Section>
      </div>
    </>
  );
}

/** Tableau P&L mensuel : une colonne par mois + colonne "Total" à droite.
 *  Chaque ligne = un poste (CA, COGS, Personnel, etc.) avec tooltip sur la
 *  cellule label pour rappeler la définition. */
function PnlMonthlyTable({
  byMonth,
  totals,
}: {
  byMonth: MonthlyPnl[];
  totals: Omit<MonthlyPnl, "month">;
}) {
  type Row = {
    label: string;
    key: keyof Omit<MonthlyPnl, "month">;
    tooltip: string;
    kind: "revenue" | "charge" | "computed";
    strong?: boolean;
  };
  const rows: Row[] = [
    {
      label: "Chiffre d'affaires",
      key: "revenue",
      kind: "revenue",
      tooltip: "Somme des revenus saisis dans /revenues sur le mois (converti CHF).",
      strong: true,
    },
    {
      label: "− Coûts directs (4xxx)",
      key: "cogs",
      kind: "charge",
      tooltip: "Factures matched dont folder_code commence par 4 : commissions processeur, infrastructure de prod, marchandises.",
    },
    {
      label: "= Bénéfice brut",
      key: "beneficeBrut",
      kind: "computed",
      tooltip: "CA − Coûts directs.",
      strong: true,
    },
    {
      label: "− Personnel (5xxx)",
      key: "personnel",
      kind: "charge",
      tooltip: "Salaires, mandats indépendants, charges sociales.",
    },
    {
      label: "− Autres charges (6xxx≠68)",
      key: "autresCharges",
      kind: "charge",
      tooltip: "Loyer, marketing, IT, admin. Inclut aussi les factures matched sans folder_code.",
    },
    {
      label: "= EBITDA",
      key: "ebitda",
      kind: "computed",
      tooltip: "Bénéfice brut − Personnel − Autres charges d'exploitation.",
      strong: true,
    },
    {
      label: "− Amortissements (68xx)",
      key: "amortissements",
      kind: "charge",
      tooltip: "Généralement 0 côté factures — saisis manuellement en compta.",
    },
    {
      label: "= EBIT",
      key: "ebit",
      kind: "computed",
      tooltip: "EBITDA − Amortissements.",
      strong: true,
    },
    {
      label: "− Charges financières (69xx)",
      key: "chargesFinancieres",
      kind: "charge",
      tooltip: "Intérêts, frais bancaires.",
    },
    {
      label: "− Impôts (85xx)",
      key: "impots",
      kind: "charge",
      tooltip: "Impôts directs (sur bénéfice, capital).",
    },
    {
      label: "= Bénéfice net",
      key: "beneficeNet",
      kind: "computed",
      tooltip: "EBIT − Charges financières − Impôts. Ce qui reste au final.",
      strong: true,
    },
  ];

  const cellClass = (kind: Row["kind"], value: number, strong: boolean | undefined) => {
    let cls = "px-3 py-2 text-right font-mono tabular-nums text-[12px] ";
    if (strong) cls += "font-semibold ";
    if (kind === "computed") cls += value >= 0 ? "text-ok " : "text-err ";
    else if (kind === "charge") cls += "text-muted ";
    return cls;
  };

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider sticky left-0 bg-panel">
              Poste
            </th>
            {byMonth.map((m) => (
              <th
                key={m.month}
                className="text-right px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider whitespace-nowrap"
              >
                {formatMonthLabel(m.month)}
              </th>
            ))}
            <th className="text-right px-3 py-2.5 font-semibold text-text text-[11px] uppercase tracking-wider whitespace-nowrap border-l border-border">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.key}
              className={`border-b border-border/50 ${r.kind === "computed" ? "bg-panel2/40" : ""}`}
            >
              <td
                className={`px-3 py-2 sticky left-0 whitespace-nowrap ${r.strong ? "font-semibold" : ""} ${r.kind === "computed" ? "bg-panel2/40 text-text" : "bg-panel"}`}
                title={r.tooltip}
              >
                {r.label}
                <span className="text-muted/60 ml-1 text-[10px]" aria-hidden>ⓘ</span>
              </td>
              {byMonth.map((m) => (
                <td key={m.month} className={cellClass(r.kind, m[r.key] as number, r.strong)}>
                  {formatAmount(m[r.key] as number, "CHF")}
                </td>
              ))}
              <td className={cellClass(r.kind, totals[r.key] as number, true) + " border-l border-border"}>
                {formatAmount(totals[r.key] as number, "CHF")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Bandeau visible en haut de la page indiquant les taux FX utilisés pour
 *  convertir tous les montants en CHF. */
function FxRatesBanner({ agg }: { agg: ReturnType<typeof useAnalyseAggregates> }) {
  const usd = agg.fx.averages.USD;
  const eur = agg.fx.averages.EUR;
  return (
    <div className="card px-5 py-3 flex items-center gap-4 flex-wrap text-[12px]">
      <div className="flex items-center gap-2 text-text">
        <ArrowRightLeft size={14} className="text-accent" />
        <span className="font-medium">Taux de change utilisés</span>
      </div>
      <div className="flex items-center gap-4 text-muted">
        <span>
          1 USD ={" "}
          <span className="font-mono text-text">{usd.toFixed(4)} CHF</span>
        </span>
        <span>
          1 EUR ={" "}
          <span className="font-mono text-text">{eur.toFixed(4)} CHF</span>
        </span>
        <span>
          1 CHF = <span className="font-mono text-text">1.0000 CHF</span>
        </span>
      </div>
      <div className="text-[11px] text-muted ml-auto">
        {agg.fx.hasOverrides
          ? `Moyenne sur ${agg.fx.perMonth.length} mois (taux exacts par mois)`
          : `Approximations stables (à brancher sur un feed FX réel)`}
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  subtitle,
  children,
  live,
  titleTooltip,
}: {
  icon: IconType;
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Si true, affiche un badge "Live" à côté du titre pour distinguer du mock. */
  live?: boolean;
  /** Tooltip natif (title="…") sur le titre — utilisé pour expliquer la
   *  définition d'un indicateur au survol (EBITDA, EBIT, Bénéfice brut). */
  titleTooltip?: string;
}) {
  return (
    <section className="space-y-4 scroll-mt-8">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-panel2 border border-border flex items-center justify-center shrink-0">
          <Icon size={16} className="text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2
              className="text-[16px] font-semibold tracking-tight"
              title={titleTooltip}
              style={titleTooltip ? { cursor: "help", borderBottom: "1px dashed var(--border)" } : undefined}
            >
              {title}
            </h2>
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
 *  3 buckets avec leur montant local + équivalent CHF + nom du fichier. */
function ExpensesByCurrencyCard({ agg }: { agg: ReturnType<typeof useAnalyseAggregates> }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <div className="text-[13px] font-medium">
          Détail des dépenses par devise
        </div>
        <div className="text-[11px] text-muted">
          Somme directe des débits par fichier de rapprochement, et équivalent CHF pour le total.
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
              ≈ {formatAmount(e.amountChf, "CHF")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
