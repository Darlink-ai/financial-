"use client";

import type { MonthlyPoint } from "@/lib/analyse-mock";

/** Bar chart minimal en SVG : revenu vs dépenses, net en ligne overlay. */
export function SeriesChart({
  data,
  title,
}: {
  data: MonthlyPoint[];
  title?: string;
}) {
  if (data.length === 0) return null;

  const width = 720;
  const height = 240;
  const padX = 32;
  const padY = 24;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const maxVal = Math.max(...data.map((d) => Math.max(d.revenue, d.expenses, d.net))) * 1.1;
  const minVal = Math.min(0, ...data.map((d) => d.net)) * 1.1;
  const range = maxVal - minVal;

  const yOf = (v: number) => padY + innerH - ((v - minVal) / range) * innerH;
  const xOf = (i: number) => padX + (i + 0.5) * (innerW / data.length);
  const barW = (innerW / data.length) * 0.32;

  const netPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(d.net)}`)
    .join(" ");

  return (
    <div className="card p-5">
      {title && (
        <div className="text-[14px] font-medium mb-1">{title}</div>
      )}
      <div className="text-[11px] text-muted mb-4">
        Mock-up — chiffres d'exemple, à brancher sur les vraies données.
      </div>
      <div className="w-full overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[240px] block">
          {/* Grille horizontale */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = padY + innerH * t;
            return (
              <line
                key={t}
                x1={padX}
                x2={width - padX}
                y1={y}
                y2={y}
                stroke="#243049"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
            );
          })}

          {/* Barres revenue + expenses */}
          {data.map((d, i) => (
            <g key={d.month}>
              <rect
                x={xOf(i) - barW - 1}
                y={yOf(d.revenue)}
                width={barW}
                height={yOf(0) - yOf(d.revenue)}
                fill="url(#grad-revenue)"
                rx={3}
              />
              <rect
                x={xOf(i) + 1}
                y={yOf(d.expenses)}
                width={barW}
                height={yOf(0) - yOf(d.expenses)}
                fill="#1f2a44"
                stroke="#33425f"
                strokeWidth={1}
                rx={3}
              />
              <text
                x={xOf(i)}
                y={height - 6}
                fontSize={10}
                textAnchor="middle"
                fill="#94a3b8"
              >
                {d.month.slice(5)}/{d.month.slice(2, 4)}
              </text>
            </g>
          ))}

          {/* Ligne net */}
          <path d={netPath} fill="none" stroke="#22d3ee" strokeWidth={2} />
          {data.map((d, i) => (
            <circle key={`p-${d.month}`} cx={xOf(i)} cy={yOf(d.net)} r={3} fill="#22d3ee" />
          ))}

          {/* Gradients */}
          <defs>
            <linearGradient id="grad-revenue" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" />
              <stop offset="100%" stopColor="#3b82f6" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-muted mt-3">
        <Legend color="#3b82f6" label="Revenus" />
        <Legend color="#1f2a44" border="#33425f" label="Dépenses" />
        <Legend color="#22d3ee" line label="Net" />
      </div>
    </div>
  );
}

function Legend({
  color,
  border,
  line,
  label,
}: {
  color: string;
  border?: string;
  line?: boolean;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {line ? (
        <div className="w-4 h-[2px] rounded-full" style={{ background: color }} />
      ) : (
        <div
          className="w-3 h-3 rounded-sm"
          style={{ background: color, border: border ? `1px solid ${border}` : undefined }}
        />
      )}
      <span>{label}</span>
    </div>
  );
}
