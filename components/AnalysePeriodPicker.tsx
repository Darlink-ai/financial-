"use client";

import { useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

export type Period =
  | { kind: "month"; year: number; month: number }
  | { kind: "quarter"; year: number; quarter: 1 | 2 | 3 | 4 }
  | { kind: "year"; year: number }
  | { kind: "ytd"; year: number };

export function formatPeriodLabel(p: Period): string {
  const months = [
    "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
    "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
  ];
  if (p.kind === "month") return `${months[p.month - 1]} ${p.year}`;
  if (p.kind === "quarter") return `T${p.quarter} ${p.year}`;
  if (p.kind === "year") return `Année ${p.year}`;
  return `YTD ${p.year}`;
}

export function defaultPeriod(): Period {
  const d = new Date();
  return { kind: "month", year: d.getFullYear(), month: d.getMonth() + 1 };
}

const KINDS: { value: Period["kind"]; label: string }[] = [
  { value: "month", label: "Mois" },
  { value: "quarter", label: "Trimestre" },
  { value: "year", label: "Année" },
  { value: "ytd", label: "YTD" },
];

export function AnalysePeriodPicker({
  value,
  onChange,
}: {
  value: Period;
  onChange: (p: Period) => void;
}) {
  const [year, setYear] = useState(value.year);

  const years: number[] = [];
  for (let y = 2024; y <= new Date().getFullYear() + 1; y++) years.push(y);

  const setKind = (kind: Period["kind"]) => {
    if (kind === "month") {
      onChange({
        kind: "month",
        year,
        month: value.kind === "month" ? value.month : new Date().getMonth() + 1,
      });
    } else if (kind === "quarter") {
      onChange({
        kind: "quarter",
        year,
        quarter: value.kind === "quarter" ? value.quarter : 1,
      });
    } else if (kind === "year") {
      onChange({ kind: "year", year });
    } else {
      onChange({ kind: "ytd", year });
    }
  };

  const setYearAll = (y: number) => {
    setYear(y);
    onChange({ ...value, year: y } as Period);
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Choix du type de période */}
      <div className="card !rounded-lg p-1 flex items-center gap-0.5">
        {KINDS.map((k) => (
          <button
            key={k.value}
            onClick={() => setKind(k.value)}
            className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${
              value.kind === k.value
                ? "bg-panel2 text-text border border-border"
                : "text-muted hover:text-text border border-transparent"
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {/* Détail selon le type */}
      {value.kind === "month" && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              const d = new Date(value.year, value.month - 2, 1);
              onChange({ kind: "month", year: d.getFullYear(), month: d.getMonth() + 1 });
              setYear(d.getFullYear());
            }}
            className="btn !px-2 !py-1.5"
            title="Mois précédent"
          >
            <ChevronLeft size={12} />
          </button>
          <select
            value={value.month}
            onChange={(e) =>
              onChange({ kind: "month", year: value.year, month: parseInt(e.target.value, 10) })
            }
            className="input !py-1.5 !px-2 text-[12px] cursor-pointer w-[120px]"
          >
            {[
              "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
              "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
            ].map((label, i) => (
              <option key={i} value={i + 1}>{label}</option>
            ))}
          </select>
          <button
            onClick={() => {
              const d = new Date(value.year, value.month, 1);
              onChange({ kind: "month", year: d.getFullYear(), month: d.getMonth() + 1 });
              setYear(d.getFullYear());
            }}
            className="btn !px-2 !py-1.5"
            title="Mois suivant"
          >
            <ChevronRight size={12} />
          </button>
        </div>
      )}

      {value.kind === "quarter" && (
        <div className="card !rounded-lg p-1 flex items-center gap-0.5">
          {[1, 2, 3, 4].map((q) => (
            <button
              key={q}
              onClick={() =>
                onChange({ kind: "quarter", year: value.year, quarter: q as 1 | 2 | 3 | 4 })
              }
              className={`px-3 py-1 rounded-md text-[12px] font-mono font-medium transition-colors ${
                value.quarter === q
                  ? "bg-panel2 text-text border border-border"
                  : "text-muted hover:text-text border border-transparent"
              }`}
            >
              T{q}
            </button>
          ))}
        </div>
      )}

      {/* Année — toujours visible */}
      <div className="flex items-center gap-1.5 text-[12px] text-muted">
        <Calendar size={12} />
        <select
          value={value.year}
          onChange={(e) => setYearAll(parseInt(e.target.value, 10))}
          className="input !py-1.5 !px-2 text-[12px] cursor-pointer tabular-nums w-[80px]"
        >
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
