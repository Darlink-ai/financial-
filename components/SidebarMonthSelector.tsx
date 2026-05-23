"use client";

import { useStore } from "@/lib/store";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

const MONTHS_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

function parse(ym: string): [number, number] {
  const [y, m] = ym.split("-").map(Number);
  return [y, m];
}

function compose(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

function shiftMonth(ym: string, delta: number): string {
  const [y, m] = parse(ym);
  const d = new Date(y, m - 1 + delta, 1);
  return compose(d.getFullYear(), d.getMonth() + 1);
}

export function SidebarMonthSelector() {
  const { selectedMonth, setSelectedMonth } = useStore();
  const [year, month] = parse(selectedMonth);

  const years: number[] = [];
  for (let y = 2024; y <= new Date().getFullYear() + 1; y++) years.push(y);

  return (
    <div className="px-3 pt-4 pb-3 border-b border-border">
      <div className="text-[10px] uppercase tracking-wider text-muted px-1 pb-2 flex items-center gap-1.5">
        <Calendar size={11} />
        Période
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={() => setSelectedMonth(shiftMonth(selectedMonth, -1))}
          className="btn !px-1.5 !py-1"
          title="Mois précédent"
        >
          <ChevronLeft size={12} />
        </button>

        <div className="flex-1 grid grid-cols-[1fr_auto] gap-1">
          <select
            value={month}
            onChange={(e) => setSelectedMonth(compose(year, parseInt(e.target.value, 10)))}
            className="input !py-1 !px-2 text-[12px] cursor-pointer"
            title="Mois"
          >
            {MONTHS_FR.map((label, i) => (
              <option key={i} value={i + 1}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={year}
            onChange={(e) => setSelectedMonth(compose(parseInt(e.target.value, 10), month))}
            className="input !py-1 !px-2 text-[12px] cursor-pointer tabular-nums w-[68px]"
            title="Année"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={() => setSelectedMonth(shiftMonth(selectedMonth, 1))}
          className="btn !px-1.5 !py-1"
          title="Mois suivant"
        >
          <ChevronRight size={12} />
        </button>
      </div>
    </div>
  );
}
