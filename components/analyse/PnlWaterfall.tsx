"use client";

import { formatAmount } from "@/lib/format";
import type {
  PnlTotals,
  SubCategoryTotal,
} from "@/lib/analyse-financials";

/**
 * Waterfall visuel CA → Bénéfice brut → EBITDA → EBIT → Bénéfice net.
 *
 * Chaque colonne montre un indicateur cumulé (barre pleine), et entre deux
 * indicateurs on affiche les déductions détaillées par poste (Marketing,
 * IT, Loyer…) — c'est ce que l'utilisateur voulait pour comprendre comment
 * on passe d'un solde à l'autre.
 */
export function PnlWaterfall({
  totals,
  subCategories,
}: {
  totals: PnlTotals;
  subCategories: SubCategoryTotal[];
}) {
  // Étapes du waterfall — clair et dans l'ordre comptable canonique.
  const steps = [
    {
      key: "revenue",
      label: "Chiffre d'affaires",
      value: totals.revenue,
      kind: "level" as const,
      color: "#3b82f6",
      tooltip: "Somme des revenus saisis dans /revenues sur la période, convertie en CHF.",
    },
    {
      key: "cogs",
      label: "− Coûts directs (COGS)",
      value: totals.cogs,
      kind: "deduction" as const,
      section: "cogs" as const,
      color: "#f59e0b",
      tooltip: "Factures matched avec folder_code commençant par 4 (achats de marchandises, prestations facturées, matières).",
    },
    {
      key: "beneficeBrut",
      label: "= Bénéfice brut",
      value: totals.beneficeBrut,
      kind: "level" as const,
      color: "#0ea5e9",
      tooltip: "CA − Coûts directs. Marge dégagée avant charges d'exploitation.",
    },
    {
      key: "personnel",
      label: "− Personnel",
      value: totals.personnel,
      kind: "deduction" as const,
      section: "personnel" as const,
      color: "#f59e0b",
      tooltip: "Factures 5xxx : salaires, mandats indépendants, charges sociales.",
    },
    {
      key: "autresCharges",
      label: "− Autres charges d'exploit.",
      value: totals.autresCharges,
      kind: "deduction" as const,
      section: "opex_other" as const,
      color: "#f59e0b",
      tooltip: "Factures 6xxx (sauf 68xx) + factures non classées. Détail par poste ci-dessous.",
    },
    {
      key: "ebitda",
      label: "= EBITDA",
      value: totals.ebitda,
      kind: "level" as const,
      color: "#0ea5e9",
      tooltip: "Bénéfice brut − Personnel − Autres charges. Performance opérationnelle brute.",
    },
    {
      key: "amortissements",
      label: "− Amortissements",
      value: totals.amortissements,
      kind: "deduction" as const,
      section: "amort" as const,
      color: "#f59e0b",
      tooltip: "Factures 68xx. Généralement 0 côté factures — saisis manuellement en compta.",
    },
    {
      key: "ebit",
      label: "= EBIT",
      value: totals.ebit,
      kind: "level" as const,
      color: "#0ea5e9",
      tooltip: "EBITDA − Amortissements. Résultat opérationnel courant.",
    },
    {
      key: "chargesFinancieres",
      label: "− Charges financières",
      value: totals.chargesFinancieres,
      kind: "deduction" as const,
      section: "fin" as const,
      color: "#f59e0b",
      tooltip: "Factures 69xx : intérêts, frais bancaires.",
    },
    {
      key: "impots",
      label: "− Impôts",
      value: totals.impots,
      kind: "deduction" as const,
      section: "tax" as const,
      color: "#f59e0b",
      tooltip: "Factures 85xx : impôts directs (bénéfice, capital).",
    },
    {
      key: "beneficeNet",
      label: "= Bénéfice net",
      value: totals.beneficeNet,
      kind: "level" as const,
      color: totals.beneficeNet >= 0 ? "#22c55e" : "#ef4444",
      tooltip: "EBIT − Charges financières − Impôts. Ce qui reste vraiment.",
    },
  ];

  const maxLevel = Math.max(
    totals.revenue,
    totals.beneficeBrut,
    totals.ebitda,
    totals.ebit,
    Math.abs(totals.beneficeNet),
  );

  return (
    <div className="card p-5 space-y-6">
      {/* Séquence horizontale — chaque marche du waterfall */}
      <div className="w-full overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-11 gap-2 items-end min-h-[180px]">
            {steps.map((s) => (
              <WaterfallStep key={s.key} step={s} maxValue={maxLevel} />
            ))}
          </div>
        </div>
      </div>

      {/* Détail par poste : sous-catégories groupées par section du waterfall */}
      <div className="border-t border-border pt-5">
        <div className="text-[11px] uppercase tracking-wider text-muted font-medium mb-3">
          Détail des postes de dépenses
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <SectionCard
            title="Coûts directs (COGS)"
            hint="Déduits du CA pour donner le Bénéfice brut"
            color="#f59e0b"
            items={subCategories.filter((s) => s.section === "cogs")}
            emptyLabel="Aucune facture 4xxx sur la période."
          />
          <SectionCard
            title="Charges d'exploitation"
            hint="Déduites du Bénéfice brut pour donner l'EBITDA"
            color="#f59e0b"
            items={subCategories.filter((s) => s.section === "opex")}
            emptyLabel="Aucune facture 5xxx ou 6xxx sur la période."
          />
          <SectionCard
            title="Après EBITDA"
            hint="Déduits successivement pour EBIT puis Bénéfice net"
            color="#f59e0b"
            items={subCategories.filter(
              (s) => s.section === "amort" || s.section === "fin" || s.section === "tax",
            )}
            emptyLabel="Aucune facture 68xx / 69xx / 85xx."
          />
        </div>
      </div>
    </div>
  );
}

function WaterfallStep({
  step,
  maxValue,
}: {
  step: {
    label: string;
    value: number;
    kind: "level" | "deduction";
    color: string;
    tooltip: string;
  };
  maxValue: number;
}) {
  const isLevel = step.kind === "level";
  // Height : levels = proportionnel à max, deductions = plus petit pour être lisible.
  const heightPct =
    maxValue > 0
      ? isLevel
        ? Math.max((Math.abs(step.value) / maxValue) * 100, 8)
        : Math.max((Math.abs(step.value) / maxValue) * 100, 3)
      : 8;

  return (
    <div className="flex flex-col items-center gap-1.5" title={step.tooltip}>
      <div
        className="w-full text-[10px] text-center font-mono tabular-nums text-text truncate"
        style={{ minHeight: 14 }}
      >
        {formatAmount(step.value, "CHF")}
      </div>
      <div
        className="w-full rounded-sm relative"
        style={{
          height: `${heightPct}%`,
          minHeight: 4,
          background: step.color,
          opacity: isLevel ? 0.95 : 0.55,
          border: isLevel ? `1px solid ${step.color}` : `1px dashed ${step.color}`,
        }}
      />
      <div
        className={`w-full text-[10px] text-center leading-tight ${isLevel ? "font-semibold text-text" : "text-muted"}`}
        style={{ minHeight: 26 }}
      >
        {step.label}
      </div>
    </div>
  );
}

function SectionCard({
  title,
  hint,
  color,
  items,
  emptyLabel,
}: {
  title: string;
  hint: string;
  color: string;
  items: SubCategoryTotal[];
  emptyLabel: string;
}) {
  const total = items.reduce((s, i) => s + i.amount, 0);
  return (
    <div className="rounded-md border border-border bg-panel2/40 p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="text-[12.5px] font-medium">{title}</div>
        <div className="font-mono tabular-nums text-[12.5px] font-semibold" style={{ color }}>
          {formatAmount(total, "CHF")}
        </div>
      </div>
      <div className="text-[10.5px] text-muted mb-3">{hint}</div>
      {items.length === 0 ? (
        <div className="text-[11px] text-muted italic">{emptyLabel}</div>
      ) : (
        <div className="space-y-1.5">
          {items.map((it) => (
            <div key={it.key} className="flex items-center justify-between gap-2 text-[11.5px]">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="font-mono text-[10px] text-muted w-6 shrink-0"
                  title={`Codes ${it.key}xx`}
                >
                  {it.key}
                </span>
                <span className="truncate text-text" title={it.label}>
                  {it.label}
                </span>
                <span
                  className="text-[10px] text-muted shrink-0"
                  title={`${it.invoiceCount} facture${it.invoiceCount > 1 ? "s" : ""}`}
                >
                  · {it.invoiceCount}
                </span>
              </div>
              <span className="font-mono tabular-nums shrink-0 text-text">
                {formatAmount(it.amount, "CHF")}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
