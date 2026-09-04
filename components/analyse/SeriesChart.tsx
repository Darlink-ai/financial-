"use client";

import { useState } from "react";
import type { MonthlyPoint } from "@/lib/analyse-mock";
import { formatAmount } from "@/lib/format";
import { formatMonthLabel } from "@/lib/store";

/** Bar chart minimal en SVG : revenu vs dépenses, net en ligne overlay.
 *  Quand `isLive`, on retire la mention "Mock-up".
 *
 *  Tooltip au survol : une zone invisible par mois capture le hover et
 *  affiche un cartouche flottant avec les 3 valeurs (revenus / dépenses /
 *  net) + un fil vertical qui marque le mois sélectionné.
 */
export function SeriesChart({
  data,
  title,
  isLive,
}: {
  data: MonthlyPoint[];
  title?: string;
  isLive?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length === 0) return null;

  const width = 720;
  const height = 260;
  // padX gauche etendu pour l'axe Y avec labels de montants.
  const padLeft = 68;
  const padRight = 20;
  const padY = 28;
  const innerW = width - padLeft - padRight;
  const innerH = height - padY * 2;

  const maxVal = Math.max(...data.map((d) => Math.max(d.revenue, d.expenses, d.net))) * 1.1;
  const minVal = Math.min(0, ...data.map((d) => d.net)) * 1.1;
  const range = maxVal - minVal || 1;

  const yOf = (v: number) => padY + innerH - ((v - minVal) / range) * innerH;
  const xOf = (i: number) => padLeft + (i + 0.5) * (innerW / data.length);
  const barW = (innerW / data.length) * 0.32;
  const colW = innerW / data.length;

  // Labels Y : 5 crans reguliers entre minVal et maxVal, formates court
  // (K pour milliers, M pour millions).
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => {
    const yPx = padY + innerH * t;
    const value = maxVal - (maxVal - minVal) * t;
    return { yPx, value };
  });
  const fmtShort = (n: number): string => {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
    return n.toFixed(0);
  };

  const netPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(d.net)}`)
    .join(" ");

  const hovered = hoverIdx != null ? data[hoverIdx] : null;
  // Positionne le tooltip HTML en % (relatif au wrapper) pour rester
  // aligné avec le SVG même quand celui-ci scale.
  const tooltipLeftPct =
    hoverIdx != null ? (xOf(hoverIdx) / width) * 100 : 0;
  // Bascule à gauche si on est dans la moitié droite pour ne pas déborder.
  const tooltipOnRight = tooltipLeftPct > 60;

  return (
    <div className="card p-5">
      {title && (
        <div className="text-[14px] font-medium mb-1">{title}</div>
      )}
      {!isLive && (
        <div className="text-[11px] text-muted mb-4">
          Mock-up — chiffres d'exemple, à brancher sur les vraies données.
        </div>
      )}
      <div className="w-full overflow-x-auto">
        <div className="relative">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-[260px] block"
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* Grille horizontale + labels axe Y (montants en CHF, format court) */}
            {yTicks.map((tick, idx) => (
              <g key={idx}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={tick.yPx}
                  y2={tick.yPx}
                  stroke="#243049"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                />
                <text
                  x={padLeft - 8}
                  y={tick.yPx + 3}
                  fontSize={10}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                >
                  {fmtShort(tick.value)}
                </text>
              </g>
            ))}

            {/* Fil vertical du mois survolé */}
            {hoverIdx != null && (
              <line
                x1={xOf(hoverIdx)}
                x2={xOf(hoverIdx)}
                y1={padY}
                y2={height - padY}
                stroke="#22d3ee"
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.5}
                pointerEvents="none"
              />
            )}

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
                  opacity={hoverIdx == null || hoverIdx === i ? 1 : 0.35}
                  style={{ transition: "opacity .15s" }}
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
                  opacity={hoverIdx == null || hoverIdx === i ? 1 : 0.35}
                  style={{ transition: "opacity .15s" }}
                />
                <text
                  x={xOf(i)}
                  y={height - 6}
                  fontSize={10}
                  textAnchor="middle"
                  fill={hoverIdx === i ? "#e2e8f0" : "#94a3b8"}
                  style={{ transition: "fill .15s" }}
                >
                  {d.month.slice(5)}/{d.month.slice(2, 4)}
                </text>
              </g>
            ))}

            {/* Ligne net */}
            <path d={netPath} fill="none" stroke="#22d3ee" strokeWidth={2} pointerEvents="none" />
            {data.map((d, i) => {
              const cx = xOf(i);
              const cy = yOf(d.net);
              // Position du label : au-dessus du point si la place est
              // suffisante, sinon en dessous.
              const labelAbove = cy > padY + 22;
              const labelY = labelAbove ? cy - 10 : cy + 18;
              return (
                <g key={`p-${d.month}`}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={hoverIdx === i ? 5 : 3.5}
                    fill="#22d3ee"
                    stroke={hoverIdx === i ? "#0891b2" : "#0f1525"}
                    strokeWidth={2}
                    style={{ transition: "r .15s" }}
                    pointerEvents="none"
                  />
                  {/* Label permanent avec le bénéfice — visible sans survol */}
                  <text
                    x={cx}
                    y={labelY}
                    fontSize={11}
                    fontWeight={600}
                    textAnchor="middle"
                    fill="#22d3ee"
                    fontFamily="ui-monospace, SFMono-Regular, monospace"
                    pointerEvents="none"
                    stroke="#0f1525"
                    strokeWidth={3}
                    paintOrder="stroke"
                  >
                    {fmtShort(d.net)}
                  </text>
                </g>
              );
            })}

            {/* Zones de capture hover — une par mois, transparentes,
                couvrent toute la colonne pour un pointage facile. */}
            {data.map((d, i) => (
              <rect
                key={`hit-${d.month}`}
                x={padLeft + i * colW}
                y={padY}
                width={colW}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                style={{ cursor: "pointer" }}
              />
            ))}

            {/* Gradients */}
            <defs>
              <linearGradient id="grad-revenue" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" />
                <stop offset="100%" stopColor="#3b82f6" />
              </linearGradient>
            </defs>
          </svg>

          {/* Tooltip HTML flottant — positionné en % pour rester aligné
              avec le SVG responsive. */}
          {hovered && hoverIdx != null && (
            <div
              className="absolute pointer-events-none z-10 min-w-[180px]"
              style={{
                left: tooltipOnRight ? "auto" : `${tooltipLeftPct}%`,
                right: tooltipOnRight ? `${100 - tooltipLeftPct}%` : "auto",
                top: 8,
                transform: tooltipOnRight ? "translateX(-10px)" : "translateX(10px)",
              }}
            >
              <div className="bg-panel border border-border rounded-md shadow-lg px-3 py-2.5 text-[11.5px]">
                <div className="font-medium text-text mb-1.5 pb-1.5 border-b border-border">
                  {formatMonthLabel(hovered.month)}
                </div>
                <div className="space-y-1">
                  <TooltipRow color="#3b82f6" label="Revenus" value={hovered.revenue} />
                  <TooltipRow color="#33425f" label="Dépenses" value={hovered.expenses} />
                  <TooltipRow
                    color="#22d3ee"
                    label="Net"
                    value={hovered.net}
                    strong
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-muted mt-3">
        <Legend color="#3b82f6" label="Revenus" />
        <Legend color="#1f2a44" border="#33425f" label="Dépenses" />
        <Legend color="#22d3ee" line label="Net" />
        <span className="ml-auto text-[10px] italic">
          Survole pour voir le détail
        </span>
      </div>
    </div>
  );
}

function TooltipRow({
  color,
  label,
  value,
  strong,
}: {
  color: string;
  label: string;
  value: number;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-1.5 text-muted">
        <span
          className="w-2 h-2 rounded-sm shrink-0"
          style={{ background: color }}
        />
        <span>{label}</span>
      </div>
      <span
        className={`font-mono tabular-nums ${strong ? "text-text font-semibold" : "text-text"}`}
      >
        {formatAmount(value, "CHF")}
      </span>
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
