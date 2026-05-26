"use client";

import type { Period } from "@/components/AnalysePeriodPicker";
import { AnalysePeriodPicker, formatPeriodLabel } from "@/components/AnalysePeriodPicker";

export function AnalyseHeader({
  title,
  subtitle,
  period,
  onChangePeriod,
}: {
  title: string;
  subtitle: string;
  period: Period;
  onChangePeriod: (p: Period) => void;
}) {
  return (
    <header className="px-8 pt-8 pb-6 border-b border-border">
      <div className="flex items-start justify-between gap-6 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight">{title}</h1>
          <p className="text-[13px] text-muted mt-1 max-w-2xl">
            {subtitle} · <span className="text-text">{formatPeriodLabel(period)}</span>
          </p>
        </div>
        <AnalysePeriodPicker value={period} onChange={onChangePeriod} />
      </div>
    </header>
  );
}
