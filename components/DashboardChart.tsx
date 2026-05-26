"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp } from "lucide-react";
import { useStore, formatMonthLabel } from "@/lib/store";
import { formatAmount } from "@/lib/format";

const CA_COLOR = "#3b82f6"; // blue-500
const NET_COLOR = "#10b981"; // emerald-500 (vert distinct du bleu)

type MonthlyPoint = { month: string; ca: number; net: number };

const MONTHS_TO_SHOW = 6;

/**
 * Construit les N derniers mois (incluant le mois courant) à partir de la
 * date du jour, et calcule CA + Bénéfice net depuis les revenues filtrées
 * par business (ou tous).
 */
function buildSerie(
  revenues: { month: string; businessId: string; capturedAmount: number; fees: number }[],
  businessFilter: string,
): MonthlyPoint[] {
  const now = new Date();
  const points: MonthlyPoint[] = [];

  for (let i = MONTHS_TO_SHOW - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    const filtered =
      businessFilter === "all"
        ? revenues.filter((r) => r.month === ym)
        : revenues.filter(
            (r) => r.month === ym && r.businessId === businessFilter,
          );

    const ca = filtered.reduce((s, r) => s + (r.capturedAmount ?? 0), 0);
    const fees = filtered.reduce((s, r) => s + (r.fees ?? 0), 0);
    // Approximation : net = CA − frais processeur. Pour un vrai bénéfice
    // net il faudrait soustraire toutes les factures du mois — sera fait
    // plus tard quand l'analyse financière sera branchée sur la DB.
    points.push({ month: ym, ca, net: ca - fees });
  }
  return points;
}

export function DashboardChart() {
  const { revenues, businesses } = useStore();
  const [filter, setFilter] = useState<string>("all");

  const data = useMemo(() => buildSerie(revenues, filter), [revenues, filter]);

  // Si toutes les valeurs sont 0, on affiche un message au lieu d'un chart vide.
  const hasData = data.some((p) => p.ca > 0 || p.net > 0);

  const filterOptions = useMemo(
    () => [
      { value: "all", label: "Tous", color: "#94a3b8" },
      ...businesses.map((b) => ({
        value: b.id,
        label: b.name,
        color: b.color,
      })),
    ],
    [businesses],
  );

  return (
    <section className="card px-4 py-4">
      <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
        <div>
          <div className="text-[14px] font-semibold flex items-center gap-2">
            <TrendingUp size={15} className="text-accent" />
            Évolution sur 6 mois
          </div>
          <div className="text-[11px] text-muted">
            Chiffre d'affaires et bénéfice net en USD
          </div>
        </div>
        <div className="card !rounded-lg p-1 flex items-center gap-0.5">
          {filterOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-3 py-1 rounded-md text-[12px] font-medium transition-colors ${
                filter === opt.value
                  ? "bg-panel2 text-text border border-border"
                  : "text-muted hover:text-text border border-transparent"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {hasData ? (
        <LineChart data={data} />
      ) : (
        <div className="h-[240px] flex flex-col items-center justify-center text-center text-muted text-[13px]">
          <div>Aucune donnée de revenus sur les 6 derniers mois.</div>
          <div className="text-[11px] mt-1">
            Ajoute des revenus depuis l'onglet « Revenus » pour voir l'évolution.
          </div>
        </div>
      )}
    </section>
  );
}

function LineChart({ data }: { data: MonthlyPoint[] }) {
  // Mesure la largeur réelle du conteneur — comme ça la SVG remplit
  // exactement l'espace dispo, sans bandes vides à cause d'un viewBox
  // d'un autre ratio.
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(320, Math.floor(entry.contentRect.width));
        setWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const height = 260;
  const padL = 44;
  const padR = 12;
  const padT = 20;
  const padB = 36;
  const innerW = Math.max(1, width - padL - padR);
  const innerH = height - padT - padB;

  const maxVal =
    Math.max(...data.flatMap((d) => [d.ca, d.net]), 1) * 1.15;
  const minVal = Math.min(0, ...data.map((d) => d.net));
  const range = maxVal - minVal || 1;

  const xOf = (i: number) =>
    padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const yOf = (v: number) => padT + innerH - ((v - minVal) / range) * innerH;

  const caPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(d.ca)}`)
    .join(" ");
  const netPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(d.net)}`)
    .join(" ");

  const caArea = `${caPath} L ${xOf(data.length - 1)} ${yOf(minVal)} L ${xOf(0)} ${yOf(minVal)} Z`;
  const yTicks = [0, 0.33, 0.66, 1].map((t) => minVal + range * t);

  return (
    <div ref={containerRef} className="w-full">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
      >
        <defs>
          <linearGradient id="ca-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={CA_COLOR} stopOpacity="0.22" />
            <stop offset="100%" stopColor={CA_COLOR} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grille horizontale + labels Y */}
        {yTicks.map((v, i) => {
          const y = yOf(v);
          return (
            <g key={i}>
              <line
                x1={padL}
                x2={width - padR}
                y1={y}
                y2={y}
                stroke="#243049"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <text
                x={padL - 8}
                y={y + 4}
                fontSize={10}
                textAnchor="end"
                fill="#94a3b8"
              >
                {formatCompactUsd(v)}
              </text>
            </g>
          );
        })}

        {/* Area sous CA */}
        <path d={caArea} fill="url(#ca-area)" />

        {/* Ligne CA */}
        <path d={caPath} fill="none" stroke={CA_COLOR} strokeWidth={2.5} />
        {/* Ligne Net */}
        <path d={netPath} fill="none" stroke={NET_COLOR} strokeWidth={2.5} />

        {/* Points + labels mois */}
        {data.map((d, i) => (
          <g key={d.month}>
            <circle cx={xOf(i)} cy={yOf(d.ca)} r={3.5} fill={CA_COLOR} />
            <circle cx={xOf(i)} cy={yOf(d.net)} r={3.5} fill={NET_COLOR} />
            <text
              x={xOf(i)}
              y={height - 14}
              fontSize={11}
              textAnchor="middle"
              fill="#94a3b8"
            >
              {formatMonthLabel(d.month).slice(0, 4)}
            </text>
            <text
              x={xOf(i)}
              y={height - 2}
              fontSize={10}
              textAnchor="middle"
              fill="#64748b"
            >
              {d.month.slice(2, 4)}
            </text>
          </g>
        ))}
      </svg>

      <div className="flex items-center gap-4 text-[11px] text-muted pt-2 px-2">
        <Legend color={CA_COLOR} label="Chiffre d'affaires" />
        <Legend color={NET_COLOR} label="Bénéfice net" />
        <div className="ml-auto tabular-nums text-text">
          Dernier mois : {formatAmount(data[data.length - 1].ca, "USD")} CA ·{" "}
          {formatAmount(data[data.length - 1].net, "USD")} net
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-4 h-[2.5px] rounded-full" style={{ background: color }} />
      <span>{label}</span>
    </div>
  );
}

function formatCompactUsd(n: number): string {
  if (Math.abs(n) >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}
