/**
 * Mock-data temporaire pour la section Analyse financière.
 * À remplacer par des vraies agrégations DB plus tard.
 */
import type { Period } from "@/components/AnalysePeriodPicker";

export type KPI = {
  label: string;
  value: number;
  currency: "USD" | "EUR" | "CHF";
  delta?: number; // % vs période précédente
  hint?: string;
};

export type CategoryBreakdown = {
  label: string;
  code: string;
  amount: number;
  share: number; // %
  color: string;
};

export type MonthlyPoint = {
  month: string; // "YYYY-MM"
  revenue: number;
  expenses: number;
  net: number;
};

/** Échelle simple en fonction du type de période : plus la fenêtre est large,
 *  plus les chiffres sont gros (juste pour rendre la mock cohérente). */
function scale(p: Period): number {
  if (p.kind === "month") return 1;
  if (p.kind === "quarter") return 3;
  if (p.kind === "ytd") return Math.max(1, new Date().getMonth() + 1);
  return 12;
}

export function mockCA(p: Period): { kpis: KPI[]; series: MonthlyPoint[]; byBusiness: CategoryBreakdown[] } {
  const s = scale(p);
  return {
    kpis: [
      {
        label: "Chiffre d'affaires",
        value: 83_600 * s,
        currency: "USD",
        delta: 12.4,
        hint: "Total encaissé tous processeurs",
      },
      {
        label: "Volume Stripe",
        value: 70_800 * s,
        currency: "USD",
        delta: 9.1,
        hint: "Captured, hors fees",
      },
      {
        label: "Volume PayPal",
        value: 12_800 * s,
        currency: "USD",
        delta: 22.7,
        hint: "Captured, hors fees",
      },
      {
        label: "Transactions captured",
        value: 1820 * s,
        currency: "USD",
        delta: 5.0,
        hint: "Toutes processeurs confondus",
      },
    ],
    series: buildSeries(p, 70_000, 38_000),
    byBusiness: [
      { label: "Link", code: "LINK", amount: 61_300 * s, share: 73.3, color: "#60a5fa" },
      { label: "Ify", code: "IFY", amount: 22_300 * s, share: 26.7, color: "#22d3ee" },
    ],
  };
}

export function mockBeneficeBrut(p: Period): { kpis: KPI[]; series: MonthlyPoint[]; byCategory: CategoryBreakdown[] } {
  const s = scale(p);
  return {
    kpis: [
      {
        label: "Bénéfice brut",
        value: 45_200 * s,
        currency: "USD",
        delta: 8.3,
        hint: "CA − coûts directs (processeurs + COGS)",
      },
      {
        label: "Marge brute",
        value: 54.1,
        currency: "USD",
        delta: -1.2,
        hint: "Bénéfice brut / CA",
      },
      {
        label: "Coûts directs",
        value: 38_400 * s,
        currency: "USD",
        delta: 14.1,
        hint: "Processeurs + infra de prod",
      },
      {
        label: "Coût / transaction",
        value: 4.21,
        currency: "USD",
        delta: -3.4,
        hint: "Direct cost / tx",
      },
    ],
    series: buildSeries(p, 70_000, 28_000),
    byCategory: [
      { label: "Commission processeur", code: "PROC", amount: 3_456 * s, share: 9.0, color: "#60a5fa" },
      { label: "Tech & R&D", code: "TECH", amount: 14_200 * s, share: 36.9, color: "#22d3ee" },
      { label: "Marketing & Pub", code: "MKT", amount: 10_800 * s, share: 28.1, color: "#a78bfa" },
      { label: "Locaux", code: "LOC", amount: 4_800 * s, share: 12.5, color: "#34d399" },
      { label: "Autres", code: "OTHER", amount: 5_144 * s, share: 13.5, color: "#fbbf24" },
    ],
  };
}

export function mockBeneficeNet(p: Period): { kpis: KPI[]; series: MonthlyPoint[] } {
  const s = scale(p);
  return {
    kpis: [
      {
        label: "Bénéfice net",
        value: 19_650 * s,
        currency: "USD",
        delta: 4.7,
        hint: "Après impôts et intérêts",
      },
      {
        label: "Marge nette",
        value: 23.5,
        currency: "USD",
        delta: -0.8,
        hint: "Bénéfice net / CA",
      },
      {
        label: "Impôts estimés",
        value: 4_900 * s,
        currency: "USD",
        delta: 6.0,
        hint: "Provision IS",
      },
      {
        label: "Cash disponible",
        value: 142_400,
        currency: "USD",
        delta: 18.0,
        hint: "Hors rolling reserve",
      },
    ],
    series: buildSeries(p, 70_000, 50_000),
  };
}

export function mockEbit(p: Period): { kpis: KPI[]; series: MonthlyPoint[] } {
  const s = scale(p);
  return {
    kpis: [
      {
        label: "EBIT",
        value: 26_600 * s,
        currency: "USD",
        delta: 10.1,
        hint: "Earnings before interest & tax (résultat d'exploitation)",
      },
      {
        label: "Marge EBIT",
        value: 31.8,
        currency: "USD",
        delta: 0.9,
        hint: "EBIT / CA",
      },
      {
        label: "OPEX",
        value: 55_800 * s,
        currency: "USD",
        delta: 6.1,
        hint: "Charges opérationnelles",
      },
      {
        label: "Amortissements",
        value: 1_200 * s,
        currency: "USD",
        delta: 0,
        hint: "Inclus dans l'EBIT (≠ EBITDA)",
      },
    ],
    series: buildSeries(p, 70_000, 43_400),
  };
}

export function mockEbitda(p: Period): { kpis: KPI[]; series: MonthlyPoint[] } {
  const s = scale(p);
  return {
    kpis: [
      {
        label: "EBITDA",
        value: 27_800 * s,
        currency: "USD",
        delta: 11.2,
        hint: "Earnings before interest, tax, depreciation & amortization",
      },
      {
        label: "Marge EBITDA",
        value: 33.3,
        currency: "USD",
        delta: 1.4,
        hint: "EBITDA / CA",
      },
      {
        label: "OPEX",
        value: 55_800 * s,
        currency: "USD",
        delta: 6.1,
        hint: "Charges opérationnelles",
      },
      {
        label: "Amortissements",
        value: 1_200 * s,
        currency: "USD",
        delta: 0,
        hint: "D&A — peu d'immo. corporelles",
      },
    ],
    series: buildSeries(p, 70_000, 42_000),
  };
}

export type RecurringInvoice = {
  id: string;
  creditor: string;
  category: string;
  categoryCode: string;
  cadence: "Mensuel" | "Annuel" | "Trimestriel";
  amount: number;
  currency: "USD" | "EUR" | "CHF";
  active: boolean;
  nextChargeAt: string; // ISO date
  notes?: string;
};

export const mockRecurringInvoices: RecurringInvoice[] = [
  {
    id: "rec-1",
    creditor: "OpenAI",
    category: "Tech & R&D",
    categoryCode: "TECH",
    cadence: "Mensuel",
    amount: 200,
    currency: "USD",
    active: true,
    nextChargeAt: "2026-06-10",
  },
  {
    id: "rec-2",
    creditor: "Vercel",
    category: "Tech & R&D",
    categoryCode: "TECH",
    cadence: "Mensuel",
    amount: 20,
    currency: "USD",
    active: true,
    nextChargeAt: "2026-06-01",
  },
  {
    id: "rec-3",
    creditor: "Notion",
    category: "Administration",
    categoryCode: "ADM",
    cadence: "Mensuel",
    amount: 16,
    currency: "USD",
    active: true,
    nextChargeAt: "2026-06-14",
  },
  {
    id: "rec-4",
    creditor: "GitHub Team",
    category: "Tech & R&D",
    categoryCode: "TECH",
    cadence: "Mensuel",
    amount: 44,
    currency: "USD",
    active: true,
    nextChargeAt: "2026-06-21",
  },
  {
    id: "rec-5",
    creditor: "Adobe Creative Cloud",
    category: "Marketing & Pub",
    categoryCode: "MKT",
    cadence: "Annuel",
    amount: 720,
    currency: "EUR",
    active: true,
    nextChargeAt: "2026-09-12",
  },
  {
    id: "rec-6",
    creditor: "Helvetia Assurance RC Pro",
    category: "Assurances & Taxes",
    categoryCode: "ASS",
    cadence: "Trimestriel",
    amount: 480,
    currency: "CHF",
    active: true,
    nextChargeAt: "2026-07-15",
  },
  {
    id: "rec-7",
    creditor: "Loyer — Régie Dupont",
    category: "Charges de locaux",
    categoryCode: "LOC",
    cadence: "Mensuel",
    amount: 2400,
    currency: "CHF",
    active: true,
    nextChargeAt: "2026-06-01",
  },
  {
    id: "rec-8",
    creditor: "Swisscom",
    category: "Administration",
    categoryCode: "ADM",
    cadence: "Mensuel",
    amount: 89,
    currency: "CHF",
    active: true,
    nextChargeAt: "2026-06-15",
  },
  {
    id: "rec-9",
    creditor: "Anthropic (ancien plan)",
    category: "Tech & R&D",
    categoryCode: "TECH",
    cadence: "Mensuel",
    amount: 100,
    currency: "USD",
    active: false,
    nextChargeAt: "2026-04-12",
    notes: "Résilié en avril, remplacé par le plan Team.",
  },
];

function buildSeries(p: Period, baseRevenue: number, baseExpenses: number): MonthlyPoint[] {
  const months: MonthlyPoint[] = [];
  const now = new Date(p.year, (p.kind === "month" ? p.month : 12) - 1, 1);
  const count =
    p.kind === "month" ? 6 : p.kind === "quarter" ? 9 : p.kind === "ytd" ? new Date().getMonth() + 1 : 12;
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const wobble = (Math.sin(i * 1.3) + 1) / 2; // 0..1
    const revenue = Math.round(baseRevenue * (0.85 + wobble * 0.3));
    const expenses = Math.round(baseExpenses * (0.85 + wobble * 0.2));
    months.push({
      month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      revenue,
      expenses,
      net: revenue - expenses,
    });
  }
  return months;
}
