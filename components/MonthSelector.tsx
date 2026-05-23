"use client";

import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { useStore, formatMonthLabel, monthOf } from "@/lib/store";
import { useMemo } from "react";

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthSelector() {
  const { selectedMonth, setSelectedMonth, invoices } = useStore();

  const monthsWithInvoices = useMemo(() => {
    const set = new Set<string>();
    invoices.forEach((i) => set.add(monthOf(i.invoiceDate ?? i.receivedAt)));
    return Array.from(set).sort().reverse();
  }, [invoices]);

  const currentCount = useMemo(
    () =>
      invoices.filter(
        (i) => monthOf(i.invoiceDate ?? i.receivedAt) === selectedMonth,
      ).length,
    [invoices, selectedMonth],
  );

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))}
        className="btn !px-2"
        title="Mois précédent"
      >
        <ChevronLeft size={14} />
      </button>

      <div className="card px-3 py-1.5 flex items-center gap-2 min-w-[180px]">
        <Calendar size={13} className="text-accent" />
        <select
          value={selectedMonth}
          onChange={(e) => setSelectedMonth(e.target.value)}
          className="bg-transparent outline-none text-[13px] font-medium flex-1 cursor-pointer"
        >
          {!monthsWithInvoices.includes(selectedMonth) && (
            <option value={selectedMonth}>{formatMonthLabel(selectedMonth)} (vide)</option>
          )}
          {monthsWithInvoices.map((m) => (
            <option key={m} value={m}>
              {formatMonthLabel(m)}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted tabular-nums">{currentCount}</span>
      </div>

      <button
        onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))}
        className="btn !px-2"
        title="Mois suivant"
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
