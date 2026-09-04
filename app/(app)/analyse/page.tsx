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
import { useFinancials, type ExpenseCategory } from "@/lib/analyse-financials";
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

  // Frais EMP sur la periode (Revenue.fees converti CHF).
  const empFees = agg.feesByProcessor["EMP"] ?? 0;
  // CA Net = CA brut − TVA due − Frais EMP.
  const caAfterFees = agg.totals.revenue - agg.totals.vatDue - empFees;

  const beneficeBrutKpis: KPI[] = [
    {
      label: "Bénéfice brut",
      value: pnl.totals.beneficeBrut,
      currency: DISPLAY_CURRENCY,
      hint: "CA − Coûts directs (COGS = folder_codes 4xxx). Ce que génère l'activité avant charges d'exploitation.",
    },
    {
      label: "TVA",
      value: agg.totals.vatDue,
      currency: DISPLAY_CURRENCY,
      hint: "TVA due sur la période, calculée par pays UE + UK au taux standard depuis le countryBreakdown des revenus.",
    },
    {
      label: "Frais EMP",
      value: empFees,
      currency: DISPLAY_CURRENCY,
      hint: "Somme des frais processeur emerchantpay sur la période (Revenue.fees × taux moyens CHF).",
    },
    {
      label: "CA Net",
      value: caAfterFees,
      currency: DISPLAY_CURRENCY,
      hint: "Chiffre d'affaires − TVA − Frais EMP. Ce qui revient réellement après reversement TVA et frais processeur.",
    },
  ];

  // KPIs CA — 2 tuiles simples : CA total et Net. Les tuiles 'Volume EMP'
  // et 'Volume Centrobill' ont ete retirees (bruitage inutile — la
  // repartition par processeur est deja visible plus bas).
  const caKpis: KPI[] = [
    {
      label: "Chiffre d'affaires brut",
      value: agg.totals.revenue,
      currency: DISPLAY_CURRENCY,
      hint: agg.loading
        ? "Chargement…"
        : "Somme des revenus encaissés sur la période, convertie en CHF via taux moyens du mois.",
    },
    {
      label: "Chiffre d'affaires net",
      value: agg.totals.revenueNet,
      currency: DISPLAY_CURRENCY,
      hint: `CA brut − TVA due sur la période (${formatAmount(agg.totals.vatDue, "CHF")} de TVA calculée par pays UE + UK).`,
    },
    {
      label: "Dépenses",
      value: agg.totals.expenses,
      currency: DISPLAY_CURRENCY,
      hint: "Dépenses sur tous les comptes réunis (USD − CHF − EUR), hors TVA.",
    },
    {
      label: "Bénéfice avant Impôts et Amortissements",
      value: agg.totals.net,
      currency: DISPLAY_CURRENCY,
      hint: "CA net − Dépenses.",
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
          icon={BarChart3}
          title="Bénéfice brut"
          subtitle="CA − Coûts directs (COGS = folder_codes 4xxx). C'est ce que dégage l'activité avant frais généraux."
          titleTooltip="Bénéfice brut = Chiffre d'affaires − Coûts directs (COGS). Les coûts directs sont ceux qu'on ne pourrait pas éviter en vendant plus : commissions processeur, infrastructure de prod (RunPod, DigitalOcean…), matières premières. Classification automatique : folder_codes commençant par 4."
          live
        >
          <KpiGrid kpis={beneficeBrutKpis} />
        </Section>

        <Section
          icon={BarChart3}
          title="Tableau des dépenses"
          subtitle={`${pnl.matchedInvoiceCount} factures validées ventilées par catégorie du /mappings. Une ligne par folder_code, une colonne par mois.`}
          titleTooltip="Chaque ligne correspond à une catégorie de dépense définie dans /mappings (code + libellé). Le montant par mois vient des factures matched avec ce code. Total à droite pour la période complète. Tout se recalcule en temps réel à chaque validation de facture."
          live
        >
          <ExpensesByCategoryTable
            categories={pnl.expenseCategories}
            months={pnl.months}
            revenueByMonth={Object.fromEntries(agg.series.map((m) => [m.month, m.revenue]))}
            revenueTotal={agg.totals.revenue}
            vatByMonth={Object.fromEntries(agg.series.map((m) => [m.month, m.vatDue]))}
            vatTotal={agg.totals.vatDue}
          />
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
/** Tableau des dépenses : une ligne par catégorie de dépense (folder_code
 *  complet + label du mapping utilisateur), une colonne par mois + total.
 *  Ligne "Total" en bas pour l'ensemble des catégories du mois. */
function ExpensesByCategoryTable({
  categories,
  months,
  revenueByMonth,
  revenueTotal,
  vatByMonth,
  vatTotal,
}: {
  categories: ExpenseCategory[];
  months: string[];
  /** CA brut par mois (YYYY-MM → CHF). Sert au % face CA. */
  revenueByMonth: Record<string, number>;
  /** CA brut total sur la période. Sert au % de la colonne Total. */
  revenueTotal: number;
  /** TVA due par mois (YYYY-MM → CHF). Sert au calcul Benefice = CA - TVA - Depenses. */
  vatByMonth: Record<string, number>;
  vatTotal: number;
}) {
  // Filtre : exclut la categorie 'C0' (Commission processeur) — les relevés
  // emerchantpay sont des rentrees d'argent, pas des depenses de commission.
  // Ils sont visibles a part dans la tuile 'Frais EMP' (source: Revenue.fees).
  const filteredCategories = categories.filter(
    (c) => c.code.toUpperCase() !== "C0",
  );
  const monthTotals = months.map((m) =>
    filteredCategories.reduce((s, c) => s + (c.perMonth[m] ?? 0), 0),
  );
  const grandTotal = filteredCategories.reduce((s, c) => s + c.total, 0);
  const monthBenefices = months.map(
    (m, i) => (revenueByMonth[m] ?? 0) - (vatByMonth[m] ?? 0) - monthTotals[i],
  );
  const grandBenefice = revenueTotal - vatTotal - grandTotal;

  /** Formatte "1'234.56 CHF · 5.2%" — % base = CA brut du mois (ou total).
   *  Si CA=0, on cache le %. */
  const fmtWithPct = (value: number, base: number): { amount: string; pct: string | null } => {
    if (value === 0) return { amount: "—", pct: null };
    const pct = base > 0 ? (value / base) * 100 : 0;
    return {
      amount: formatAmount(value, "CHF"),
      pct: base > 0 ? `${pct < 10 ? pct.toFixed(1) : pct.toFixed(0)} %` : null,
    };
  };

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider sticky left-0 bg-panel min-w-[240px]">
              Catégorie
            </th>
            {months.map((m) => (
              <th
                key={m}
                className="text-right px-3 py-2.5 font-medium text-muted text-[11px] uppercase tracking-wider whitespace-nowrap"
              >
                {formatMonthLabel(m)}
              </th>
            ))}
            <th className="text-right px-3 py-2.5 font-semibold text-text text-[11px] uppercase tracking-wider whitespace-nowrap border-l border-border">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {filteredCategories.length === 0 ? (
            <tr>
              <td colSpan={months.length + 2} className="px-4 py-8 text-center text-muted italic text-[12px]">
                Aucune facture validée sur la période — la vue se remplira au fur et à mesure.
              </td>
            </tr>
          ) : (
            filteredCategories.map((c) => (
              <tr key={c.code} className="border-b border-border/50 hover:bg-panel2/30">
                <td
                  className="px-3 py-2 sticky left-0 bg-panel whitespace-nowrap"
                  title={`Code ${c.code} · ${c.invoiceCount} facture${c.invoiceCount > 1 ? "s" : ""} sur la période`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-muted bg-panel2 px-1.5 py-0.5 rounded shrink-0">
                      {c.code}
                    </span>
                    <span className="text-text">{c.label}</span>
                    <span className="text-[10px] text-muted/70">· {c.invoiceCount}</span>
                  </div>
                </td>
                {months.map((m) => {
                  const v = c.perMonth[m] ?? 0;
                  const cell = fmtWithPct(v, revenueByMonth[m] ?? 0);
                  return (
                    <td
                      key={m}
                      className={`px-3 py-2 text-right font-mono tabular-nums text-[12px] ${v === 0 ? "text-muted/40" : "text-text"}`}
                    >
                      <div>{cell.amount}</div>
                      {cell.pct && (
                        <div className="text-[10px] text-muted/70 font-normal mt-0.5">
                          {cell.pct}
                        </div>
                      )}
                    </td>
                  );
                })}
                {(() => {
                  const cell = fmtWithPct(c.total, revenueTotal);
                  return (
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[12px] font-semibold text-text border-l border-border">
                      <div>{cell.amount}</div>
                      {cell.pct && (
                        <div className="text-[10px] text-muted/70 font-normal mt-0.5">
                          {cell.pct}
                        </div>
                      )}
                    </td>
                  );
                })()}
              </tr>
            ))
          )}
        </tbody>
        {filteredCategories.length > 0 && (
          <tfoot>
            <tr className="border-t-2 border-border bg-panel2/40 font-semibold">
              <td className="px-3 py-2.5 sticky left-0 bg-panel2/40 text-text text-[12px]">
                Total dépenses
              </td>
              {monthTotals.map((v, i) => {
                const cell = fmtWithPct(v, revenueByMonth[months[i]] ?? 0);
                return (
                  <td
                    key={months[i]}
                    className="px-3 py-2.5 text-right font-mono tabular-nums text-[12px] text-warn"
                  >
                    <div>{cell.amount}</div>
                    {cell.pct && (
                      <div className="text-[10px] text-warn/70 font-normal mt-0.5">
                        {cell.pct}
                      </div>
                    )}
                  </td>
                );
              })}
              {(() => {
                const cell = fmtWithPct(grandTotal, revenueTotal);
                return (
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-[12px] text-warn border-l border-border">
                    <div>{cell.amount}</div>
                    {cell.pct && (
                      <div className="text-[10px] text-warn/70 font-normal mt-0.5">
                        {cell.pct}
                      </div>
                    )}
                  </td>
                );
              })()}
            </tr>
            {/* Sous-total Benefice avant Impots et Amortissements =
                CA brut − TVA − Total depenses (par mois puis total). */}
            <tr className="bg-panel2/60 font-semibold border-t border-border">
              <td className="px-3 py-2.5 sticky left-0 bg-panel2/60 text-text text-[12px]"
                  title="Chiffre d'affaires brut − TVA due − Total dépenses. Ce que dégage l'activité avant amortissements et impôts.">
                Bénéfice avant Impôts et Amortissements
              </td>
              {monthBenefices.map((v, i) => {
                const base = revenueByMonth[months[i]] ?? 0;
                const cell = fmtWithPct(v, base);
                const color = v >= 0 ? "text-ok" : "text-err";
                return (
                  <td
                    key={months[i]}
                    className={`px-3 py-2.5 text-right font-mono tabular-nums text-[12px] ${color}`}
                  >
                    <div>{cell.amount}</div>
                    {cell.pct && (
                      <div className={`text-[10px] font-normal mt-0.5 opacity-70`}>
                        {cell.pct}
                      </div>
                    )}
                  </td>
                );
              })}
              {(() => {
                const cell = fmtWithPct(grandBenefice, revenueTotal);
                const color = grandBenefice >= 0 ? "text-ok" : "text-err";
                return (
                  <td className={`px-3 py-2.5 text-right font-mono tabular-nums text-[12px] ${color} border-l border-border`}>
                    <div>{cell.amount}</div>
                    {cell.pct && (
                      <div className="text-[10px] font-normal mt-0.5 opacity-70">
                        {cell.pct}
                      </div>
                    )}
                  </td>
                );
              })()}
            </tr>
          </tfoot>
        )}
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
  // Grille adaptative selon le nombre de KPI pour eviter les cases vides
  // (ex: la section CA n'a que 2 tuiles depuis la suppression de Volume EMP/Centrobill).
  const cols =
    kpis.length <= 2
      ? "grid-cols-1 md:grid-cols-2"
      : kpis.length === 3
      ? "grid-cols-1 md:grid-cols-3"
      : "grid-cols-2 md:grid-cols-4";
  return (
    <div className={`grid gap-4 ${cols}`}>
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
