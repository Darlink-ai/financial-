"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Calendar, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Popover } from "./ui/Popover";

const MONTHS_FR_LONG = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

const MONTHS_FR_SHORT = [
  "Janv.", "Févr.", "Mars", "Avril", "Mai", "Juin",
  "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc.",
];

function compose(y: number, m: number): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function SidebarMonthSelector({ disabled = false }: { disabled?: boolean }) {
  const { selectedMonth, setSelectedMonth } = useStore();
  const [yearStr, monthStr] = selectedMonth.split("-");
  const currentYear = parseInt(yearStr, 10);
  const currentMonth = parseInt(monthStr, 10);

  return (
    <div className="px-3 pt-4 pb-3 border-b border-border">
      <div className="text-[10px] uppercase tracking-wider text-muted px-1 pb-2 flex items-center gap-1.5">
        <Calendar size={11} />
        Période
      </div>

      <Popover
        sameWidth
        trigger={(open, toggle) => (
          <button
            type="button"
            onClick={disabled ? undefined : toggle}
            disabled={disabled}
            className={`btn w-full justify-between !py-2 ${
              disabled ? "opacity-50 cursor-not-allowed" : ""
            }`}
          >
            <span className="text-[13px] font-medium">
              {MONTHS_FR_LONG[currentMonth - 1]} {currentYear}
            </span>
            <ChevronDown
              size={12}
              className={`text-muted transition-transform duration-150 ${
                open ? "rotate-180" : ""
              }`}
            />
          </button>
        )}
      >
        {(close) => (
          <MonthPicker
            year={currentYear}
            month={currentMonth}
            onPick={(y, m) => {
              setSelectedMonth(compose(y, m));
              close();
            }}
          />
        )}
      </Popover>

      {disabled && (
        <div className="text-[10px] text-muted px-1 pt-2 leading-tight">
          Période gérée dans la page d'analyse.
        </div>
      )}
    </div>
  );
}

function MonthPicker({
  year,
  month,
  onPick,
}: {
  year: number;
  month: number;
  onPick: (y: number, m: number) => void;
}) {
  // Année navigable dans le popover sans changer la sélection courante.
  const [browsingYear, setBrowsingYear] = useState(year);

  return (
    <div className="w-full p-0.5">
      <div className="flex items-center justify-between px-1 py-1">
        <button
          type="button"
          onClick={() => setBrowsingYear((y) => y - 1)}
          className="btn !px-1.5 !py-1"
          title="Année précédente"
        >
          <ChevronLeft size={12} />
        </button>
        <div className="text-[13px] font-semibold tabular-nums">{browsingYear}</div>
        <button
          type="button"
          onClick={() => setBrowsingYear((y) => y + 1)}
          className="btn !px-1.5 !py-1"
          title="Année suivante"
        >
          <ChevronRight size={12} />
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1 p-1">
        {MONTHS_FR_SHORT.map((label, i) => {
          const m = i + 1;
          const isActive = browsingYear === year && m === month;
          return (
            <button
              key={m}
              type="button"
              onClick={() => onPick(browsingYear, m)}
              className={`px-2 py-2 rounded-md text-[12px] font-medium transition-colors ${
                isActive
                  ? "bg-accent2 text-white border border-accent2 shadow-[0_4px_12px_-4px_rgba(59,130,246,0.5)]"
                  : "text-muted hover:text-text hover:bg-panel2 border border-transparent"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
