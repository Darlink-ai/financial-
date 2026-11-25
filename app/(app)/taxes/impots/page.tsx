"use client";

import { useMemo } from "react";
import { Calculator, Loader2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { useAnalyseAggregates, DISPLAY_CURRENCY } from "@/lib/analyse-data";
import type { Period } from "@/components/AnalysePeriodPicker";
import { formatAmount } from "@/lib/format";

const TAX_RATE = 0.16;
const FIRST_YEAR = 2026;
const TH = "px-5 py-2.5 text-left text-[12px] font-medium text-muted whitespace-nowrap";
const TD = "px-5 py-3.5 tabular-nums whitespace-nowrap";

export default function ImpotsPage() {
  const { revenues } = useStore();
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const fromData = revenues
      .map((r) => Number(r.month.slice(0, 4)))
      .filter((y) => Number.isFinite(y));
    const start = Math.min(FIRST_YEAR, ...fromData, now);
    return Array.from({ length: now - start + 1 }, (_, i) => now - i);
  }, [revenues]);

  return (
    <div className="p-8 space-y-4 max-w-[1100px]">
      <section className="card overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
          <Calculator size={16} className="text-accent" />
          <div className="text-[14px] font-semibold">Impôts estimés</div>
          <span className="text-[12px] text-muted ml-auto">
            16 % du bénéfice annuel brut
          </span>
        </div>
        <table className="w-full text-[13px] border-collapse">
          <thead className="bg-panel2">
            <tr>
              <th className={TH}>Année</th>
              <th className={TH}>Mois connus</th>
              <th className={`${TH} text-right`}>Bénéfice des mois connus</th>
              <th className={`${TH} text-right`}>Bénéfice annuel</th>
              <th className={`${TH} text-right`}>Impôts (16 %)</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <YearRow key={y} year={y} />
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-[12px] text-muted px-1">
        Bénéfice = chiffre d&apos;affaires net (après TVA) − dépenses des relevés, en{" "}
        {DISPLAY_CURRENCY}. Un mois compte quand il a des revenus et un relevé de
        dépenses. Année incomplète : le bénéfice des mois connus est ramené à 12 mois.
      </p>
    </div>
  );
}

function YearRow({ year }: { year: number }) {
  const period = useMemo<Period>(() => ({ kind: "year", year }), [year]);
  const { loading, series } = useAnalyseAggregates(period);

  const known = series.filter((m) => m.revenue > 0 && m.expenses > 0);
  const knownNet = known.reduce((s, m) => s + m.net, 0);
  const annualNet = known.length > 0 ? (knownNet / known.length) * 12 : null;
  const estimated = known.length > 0 && known.length < 12;
  const tax = annualNet != null ? Math.max(0, annualNet) * TAX_RATE : null;

  return (
    <tr className="border-t border-border/60">
      <td className={`${TD} font-semibold`}>{year}</td>
      <td className={`${TD} text-muted`}>
        {loading ? <Loader2 size={13} className="animate-spin" /> : `${known.length} / 12`}
      </td>
      <td className={`${TD} text-right`}>
        {loading || known.length === 0 ? "—" : formatAmount(knownNet, DISPLAY_CURRENCY)}
      </td>
      <td className={`${TD} text-right`}>
        {loading || annualNet == null ? "—" : formatAmount(annualNet, DISPLAY_CURRENCY)}
        {!loading && estimated && (
          <span className="badge info ml-2 align-middle">estimé</span>
        )}
      </td>
      <td className={`${TD} text-right font-semibold text-[15px]`}>
        {loading || tax == null ? "—" : formatAmount(tax, DISPLAY_CURRENCY)}
      </td>
    </tr>
  );
}
