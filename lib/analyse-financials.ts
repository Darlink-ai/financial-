/**
 * Calcul temps réel du compte de résultat (P&L) sur la période sélectionnée
 * dans /analyse — Bénéfice brut, EBITDA, EBIT, Bénéfice net — depuis :
 *  - les revenus saisis (côté /revenues)
 *  - les factures VALIDÉES (status='matched') ventilées par folder_code
 *
 * Classification comptable (plan comptable suisse PME, ventilation par
 * première digit du folder_code) :
 *   4xxx        → COGS (coût des marchandises et prestations vendues)
 *   5xxx        → Charges de personnel
 *   6xxx (≠68)  → Autres charges d'exploitation (loyer, marketing, IT, admin…)
 *   68xx        → Amortissements et corrections de valeur
 *   69xx        → Charges financières (intérêts, frais bancaires)
 *   85xx        → Impôts directs
 *   autre/null  → Non classé (agrégé dans "autres charges d'exploitation")
 *
 * Formules :
 *   Bénéfice brut = CA − COGS
 *   EBITDA        = Bénéfice brut − Personnel − Autres charges
 *   EBIT          = EBITDA − Amortissements
 *   Bénéfice net  = EBIT − Charges financières − Impôts
 */

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import type { Invoice } from "@/lib/types";
import {
  DEFAULT_FX_TO_CHF,
  getRateToChf,
} from "@/lib/fx";
import type { Period } from "@/components/AnalysePeriodPicker";

export type PnlCategory =
  | "cogs"
  | "personnel"
  | "autresCharges"
  | "amortissements"
  | "chargesFinancieres"
  | "impots";

export type MonthlyPnl = {
  month: string;
  revenue: number;
  cogs: number;
  personnel: number;
  autresCharges: number;
  amortissements: number;
  chargesFinancieres: number;
  impots: number;
  beneficeBrut: number;
  ebitda: number;
  ebit: number;
  beneficeNet: number;
};

export type PnlTotals = Omit<MonthlyPnl, "month">;

export type CategoryBreakdown = {
  category: PnlCategory | "nonClasse";
  label: string;
  amount: number;
  share: number;
  invoiceCount: number;
};

export type SubCategoryTotal = {
  key: string;
  label: string;
  section: PnlSection;
  amount: number;
  invoiceCount: number;
};

/** Une catégorie exacte (folderCode complet type "6600") avec ses montants
 *  mois par mois. Label vient du mapping utilisateur (/mappings) — fallback
 *  sur "Autre (Xxxx)" si le code n'a pas de mapping. */
export type ExpenseCategory = {
  code: string; // folderCode complet, ex "6600" ou "C0"
  label: string; // libellé du mapping ou fallback
  perMonth: Record<string, number>; // month YYYY-MM -> CHF
  total: number; // total sur la période
  invoiceCount: number;
};

export type FinancialsResult = {
  months: string[];
  byMonth: MonthlyPnl[];
  totals: PnlTotals;
  /** Répartition des charges par catégorie sur toute la période. */
  breakdown: CategoryBreakdown[];
  /** Répartition fine par sous-catégorie (Marketing, IT, Loyer…). Triée
   *  par montant décroissant. Sert au waterfall + à la vue "postes". */
  subCategories: SubCategoryTotal[];
  /** Catégories réelles utilisées (folderCode complet), avec breakdown mois
   *  par mois et labels venant de /mappings. Sert au tableau des dépenses. */
  expenseCategories: ExpenseCategory[];
  /** Nombre de factures matched incluses dans le calcul. */
  matchedInvoiceCount: number;
  /** Factures matched sans folder_code (rangées dans "autres charges"). */
  uncategorizedCount: number;
};

function fmt(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Convertit une Period (mois / trimestre / année / YTD) en liste de mois
 *  YYYY-MM couverts — même logique que lib/analyse-data. */
function monthsInPeriod(p: Period): string[] {
  if (p.kind === "month") {
    return [fmt(p.year, p.month)];
  }
  if (p.kind === "quarter") {
    const start = (p.quarter - 1) * 3 + 1;
    return [fmt(p.year, start), fmt(p.year, start + 1), fmt(p.year, start + 2)];
  }
  if (p.kind === "year") {
    return Array.from({ length: 12 }, (_, i) => fmt(p.year, i + 1));
  }
  const now = new Date();
  const last = p.year === now.getFullYear() ? now.getMonth() + 1 : 12;
  return Array.from({ length: last }, (_, i) => fmt(p.year, i + 1));
}

/** Classifie un folder_code (ex "6100", "4400") en une catégorie P&L. */
export function classifyFolderCode(code: string | null): PnlCategory | "nonClasse" {
  if (!code) return "nonClasse";
  const c = code.trim();
  if (c.length === 0) return "nonClasse";
  const two = c.slice(0, 2);
  const one = c[0];
  if (two === "68") return "amortissements";
  if (two === "69") return "chargesFinancieres";
  if (two === "85") return "impots";
  if (one === "4") return "cogs";
  if (one === "5") return "personnel";
  if (one === "6") return "autresCharges";
  return "nonClasse";
}

const CATEGORY_LABELS: Record<CategoryBreakdown["category"], string> = {
  cogs: "Coûts directs (COGS)",
  personnel: "Charges de personnel",
  autresCharges: "Autres charges d'exploitation",
  amortissements: "Amortissements",
  chargesFinancieres: "Charges financières",
  impots: "Impôts directs",
  nonClasse: "Non classé (à ranger)",
};

export function categoryLabel(cat: CategoryBreakdown["category"]): string {
  return CATEGORY_LABELS[cat];
}

/**
 * Sous-catégorie plus fine, basée sur les 2 premiers chiffres du folder_code
 * (plan comptable suisse PME). Permet de dire "Marketing", "IT", "Loyer"
 * dans le waterfall — plus utile que juste "Autres charges".
 *
 * Retourne toujours un {label, section} — la section est la marche du
 * waterfall (cogs, opex, amort, fin, tax) qui contient cette sous-catégorie.
 */
export type PnlSection = "cogs" | "opex" | "amort" | "fin" | "tax";

export type SubCategoryInfo = {
  key: string; // ex "61" pour IT, "66" pour marketing
  label: string;
  section: PnlSection;
};

const SUB_CATEGORIES: Record<string, SubCategoryInfo> = {
  // 4xxx COGS
  "40": { key: "40", label: "Matières premières", section: "cogs" },
  "42": { key: "42", label: "Marchandises", section: "cogs" },
  "44": { key: "44", label: "Prestations facturées (COGS)", section: "cogs" },
  // 5xxx Personnel
  "50": { key: "50", label: "Salaires", section: "opex" },
  "51": { key: "51", label: "Salaires (bis)", section: "opex" },
  "52": { key: "52", label: "Salaires (bis)", section: "opex" },
  "53": { key: "53", label: "Salaires (bis)", section: "opex" },
  "54": { key: "54", label: "Salaires (bis)", section: "opex" },
  "55": { key: "55", label: "Salaires (bis)", section: "opex" },
  "56": { key: "56", label: "Salaires (bis)", section: "opex" },
  "57": { key: "57", label: "Charges sociales", section: "opex" },
  "58": { key: "58", label: "Autres charges personnel", section: "opex" },
  "59": { key: "59", label: "Prestations aux collaborateurs", section: "opex" },
  // 6xxx Autres charges d'exploitation
  "60": { key: "60", label: "Locaux (loyer, entretien)", section: "opex" },
  "61": { key: "61", label: "IT & Infrastructure", section: "opex" },
  "62": { key: "62", label: "Véhicules", section: "opex" },
  "63": { key: "63", label: "Assurances & taxes", section: "opex" },
  "64": { key: "64", label: "Énergie & évacuation", section: "opex" },
  "65": { key: "65", label: "Administration & communication", section: "opex" },
  "66": { key: "66", label: "Marketing & publicité", section: "opex" },
  "67": { key: "67", label: "Autres charges d'exploit.", section: "opex" },
  "68": { key: "68", label: "Amortissements", section: "amort" },
  "69": { key: "69", label: "Frais financiers", section: "fin" },
  // 85xx impôts
  "85": { key: "85", label: "Impôts directs", section: "tax" },
};

export function classifySubCategory(code: string | null): SubCategoryInfo {
  if (!code) return { key: "??", label: "Non classé", section: "opex" };
  const c = code.trim();
  if (c.length < 2) return { key: "??", label: "Non classé", section: "opex" };
  const two = c.slice(0, 2);
  return (
    SUB_CATEGORIES[two] ?? {
      key: two,
      label: `Autre (${two}xxx)`,
      section: "opex",
    }
  );
}

function toChf(amount: number, currency: string | null, month: string): number {
  const c = (currency || "CHF").toUpperCase();
  if (!(c in DEFAULT_FX_TO_CHF)) return amount;
  return amount * getRateToChf(month, c as keyof typeof DEFAULT_FX_TO_CHF);
}

/** Hook principal — recalculé automatiquement à chaque changement d'invoices
 *  ou de revenus (au fur et à mesure des validations). */
export function useFinancials(period: Period): FinancialsResult {
  const { invoices, revenues, mappings } = useStore();
  const months = useMemo(() => monthsInPeriod(period), [period]);

  return useMemo(() => {
    const monthSet = new Set(months);
    // Filtre factures matched dont la date tombe dans la période.
    const matched = invoices.filter(
      (i): i is Invoice =>
        i.status === "matched" &&
        i.invoiceDate != null &&
        monthSet.has(i.invoiceDate.slice(0, 7)),
    );

    // Init structure par mois.
    const byMonthMap = new Map<string, MonthlyPnl>();
    for (const m of months) {
      byMonthMap.set(m, {
        month: m,
        revenue: 0,
        cogs: 0,
        personnel: 0,
        autresCharges: 0,
        amortissements: 0,
        chargesFinancieres: 0,
        impots: 0,
        beneficeBrut: 0,
        ebitda: 0,
        ebit: 0,
        beneficeNet: 0,
      });
    }

    // Revenus par mois (converti CHF au taux du mois).
    for (const r of revenues) {
      if (!monthSet.has(r.month)) continue;
      const row = byMonthMap.get(r.month);
      if (!row) continue;
      row.revenue += toChf(r.capturedAmount, r.currency, r.month);
    }

    // Charges par mois × catégorie (converti CHF au taux du mois).
    let uncategorized = 0;
    const breakdownMap = new Map<CategoryBreakdown["category"], { amount: number; count: number }>();
    const subMap = new Map<string, SubCategoryTotal>();
    // Map folderCode complet → ExpenseCategory (avec breakdown mensuel)
    const expenseCatMap = new Map<string, ExpenseCategory>();
    const labelForCode = (code: string): string => {
      const m = mappings.find((mp) => mp.folderCode === code);
      if (m?.folderLabel) return m.folderLabel;
      // Fallback : essaie la sous-catégorie plan comptable
      const sub = classifySubCategory(code);
      return `${code} — ${sub.label}`;
    };

    for (const inv of matched) {
      const m = inv.invoiceDate!.slice(0, 7);
      const row = byMonthMap.get(m);
      if (!row) continue;
      const amt = toChf(inv.amount ?? 0, inv.currency, m);
      const cat = classifyFolderCode(inv.folderCode);
      // Non classé → ranger dans "autres charges" pour le P&L, mais compter séparément.
      const pnlCat: PnlCategory = cat === "nonClasse" ? "autresCharges" : cat;
      row[pnlCat] += amt;
      if (cat === "nonClasse") uncategorized++;
      const b = breakdownMap.get(cat) ?? { amount: 0, count: 0 };
      b.amount += amt;
      b.count += 1;
      breakdownMap.set(cat, b);
      // Sous-catégorie fine (pour waterfall détaillé).
      const sub = classifySubCategory(inv.folderCode);
      const existing = subMap.get(sub.key) ?? {
        key: sub.key,
        label: sub.label,
        section: sub.section,
        amount: 0,
        invoiceCount: 0,
      };
      existing.amount += amt;
      existing.invoiceCount += 1;
      subMap.set(sub.key, existing);

      // Catégorie exacte (folderCode complet) pour le tableau des dépenses.
      const code = (inv.folderCode ?? "").trim() || "??";
      const ec = expenseCatMap.get(code) ?? {
        code,
        label: code === "??" ? "Non classé" : labelForCode(code),
        perMonth: {} as Record<string, number>,
        total: 0,
        invoiceCount: 0,
      };
      ec.perMonth[m] = (ec.perMonth[m] ?? 0) + amt;
      ec.total += amt;
      ec.invoiceCount += 1;
      expenseCatMap.set(code, ec);
    }

    // Calcul dérivés par mois.
    for (const row of byMonthMap.values()) {
      row.beneficeBrut = row.revenue - row.cogs;
      row.ebitda =
        row.beneficeBrut - row.personnel - row.autresCharges;
      row.ebit = row.ebitda - row.amortissements;
      row.beneficeNet = row.ebit - row.chargesFinancieres - row.impots;
    }

    const byMonth = months.map((m) => byMonthMap.get(m)!);
    const totals: PnlTotals = byMonth.reduce(
      (acc, r) => ({
        revenue: acc.revenue + r.revenue,
        cogs: acc.cogs + r.cogs,
        personnel: acc.personnel + r.personnel,
        autresCharges: acc.autresCharges + r.autresCharges,
        amortissements: acc.amortissements + r.amortissements,
        chargesFinancieres: acc.chargesFinancieres + r.chargesFinancieres,
        impots: acc.impots + r.impots,
        beneficeBrut: acc.beneficeBrut + r.beneficeBrut,
        ebitda: acc.ebitda + r.ebitda,
        ebit: acc.ebit + r.ebit,
        beneficeNet: acc.beneficeNet + r.beneficeNet,
      }),
      {
        revenue: 0,
        cogs: 0,
        personnel: 0,
        autresCharges: 0,
        amortissements: 0,
        chargesFinancieres: 0,
        impots: 0,
        beneficeBrut: 0,
        ebitda: 0,
        ebit: 0,
        beneficeNet: 0,
      },
    );

    const totalCharges =
      totals.cogs +
      totals.personnel +
      totals.autresCharges +
      totals.amortissements +
      totals.chargesFinancieres +
      totals.impots;

    const breakdown: CategoryBreakdown[] = Array.from(breakdownMap.entries())
      .map(([category, v]) => ({
        category,
        label: CATEGORY_LABELS[category],
        amount: v.amount,
        share: totalCharges > 0 ? (v.amount / totalCharges) * 100 : 0,
        invoiceCount: v.count,
      }))
      .sort((a, b) => b.amount - a.amount);

    const subCategories: SubCategoryTotal[] = Array.from(subMap.values()).sort(
      (a, b) => b.amount - a.amount,
    );

    // Exclut les 'commission processeur' — les relevés emerchantpay sont
    // des rentrees d'argent, pas des depenses. Les vraies commissions
    // sont deja dans la tuile 'Frais EMP' (Revenue.fees). Match par code
    // ET par label pour couvrir toutes les variantes que l'utilisateur
    // pourrait avoir saisies dans /mappings.
    const isProcessorCommission = (ec: ExpenseCategory): boolean => {
      const code = ec.code.trim().toUpperCase().replace(/\s+/g, "");
      if (code === "C0" || code === "CO") return true;
      const lbl = (ec.label || "").toLowerCase();
      return /(commission|processeur|processor|emerchant|payment\s+processor)/i.test(lbl);
    };
    const expenseCategories: ExpenseCategory[] = Array.from(
      expenseCatMap.values(),
    )
      .filter((ec) => !isProcessorCommission(ec))
      .sort((a, b) => b.total - a.total);

    return {
      months,
      byMonth,
      totals,
      breakdown,
      subCategories,
      expenseCategories,
      matchedInvoiceCount: matched.length,
      uncategorizedCount: uncategorized,
    };
  }, [invoices, revenues, mappings, months]);
}
