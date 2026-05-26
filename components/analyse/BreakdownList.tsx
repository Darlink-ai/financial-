"use client";

import type { CategoryBreakdown } from "@/lib/analyse-mock";
import { formatAmount } from "@/lib/format";

export function BreakdownList({
  title,
  items,
  currency = "USD",
}: {
  title: string;
  items: CategoryBreakdown[];
  currency?: "USD" | "EUR" | "CHF";
}) {
  return (
    <div className="card p-5">
      <div className="text-[14px] font-medium mb-4">{title}</div>
      <div className="space-y-3">
        {items.map((it) => (
          <div key={it.code} className="space-y-1">
            <div className="flex items-baseline justify-between text-[12px]">
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: it.color }}
                />
                <span className="truncate">{it.label}</span>
                <span className="font-mono text-[10px] text-muted">{it.code}</span>
              </div>
              <div className="tabular-nums font-medium">
                {formatAmount(it.amount, currency)}
              </div>
            </div>
            <div className="h-1.5 bg-panel2 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${it.share}%`, background: it.color }}
              />
            </div>
            <div className="text-[10px] text-muted tabular-nums">{it.share.toFixed(1)} %</div>
          </div>
        ))}
      </div>
    </div>
  );
}
