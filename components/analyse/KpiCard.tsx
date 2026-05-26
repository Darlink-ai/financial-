"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { formatAmount } from "@/lib/format";

export function KpiCard({
  label,
  value,
  currency,
  delta,
  hint,
  highlight,
  isPercent,
  isCount,
}: {
  label: string;
  value: number;
  currency: "USD" | "EUR" | "CHF";
  delta?: number;
  hint?: string;
  highlight?: boolean;
  isPercent?: boolean;
  isCount?: boolean;
}) {
  const positive = (delta ?? 0) > 0;
  const negative = (delta ?? 0) < 0;
  const valueDisplay = isPercent
    ? `${value.toFixed(1)} %`
    : isCount
    ? value.toLocaleString("fr-CH")
    : formatAmount(value, currency);

  return (
    <div className={highlight ? "card-accent p-5" : "card p-5"}>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] text-muted">{label}</div>
        {typeof delta === "number" && (
          <div
            className={`flex items-center gap-0.5 text-[11px] tabular-nums font-medium px-1.5 py-0.5 rounded-full ${
              positive
                ? "bg-ok/10 text-ok"
                : negative
                ? "bg-err/10 text-err"
                : "bg-panel2 text-muted"
            }`}
          >
            {positive ? (
              <ArrowUpRight size={11} />
            ) : negative ? (
              <ArrowDownRight size={11} />
            ) : null}
            {positive ? "+" : ""}
            {delta.toFixed(1)} %
          </div>
        )}
      </div>
      <div className="text-[26px] font-semibold leading-none tabular-nums">
        {valueDisplay}
      </div>
      {hint && <div className="text-[11px] text-muted mt-2">{hint}</div>}
    </div>
  );
}
