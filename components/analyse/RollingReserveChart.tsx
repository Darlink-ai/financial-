"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { formatAmount } from "@/lib/format";
import { formatMonthLabel } from "@/lib/store";
import { getRateToChf, DEFAULT_FX_TO_CHF } from "@/lib/fx";
import type { AccountCurrency } from "@/lib/types";

/**
 * Graphique du STOCK cumulé de rolling reserve retenu par EMP,
 * ventilé en SOUS-BANDES par mois d'origine.
 *
 * Modèle EMP : chaque mois, EMP retient rollingReservePercent% du capturé,
 * qu'il libère rollingReserveMonths plus tard (typiquement 6 mois).
 * Chaque bande d'un mois M = les retentions d'un mois X (X ≤ M) qui ne
 * sont pas encore libérées (X + reserveMonths > M).
 *
 * Tooltip au survol d'un segment : mois d'origine + date de libération +
 * montant CHF de ce segment.
 */
export function RollingReserveChart({
  months,
  processorFilter = "EMP",
}: {
  months: string[];
  processorFilter?: string;
}) {
  const { revenues } = useStore();
  const [hover, setHover] = useState<
    | { monthIdx: number; segIdx: number; label: string; from: string; release: string; amount: number }
    | null
  >(null);

  const toChf = (amount: number, currency: string, month: string) => {
    const c = (currency || "CHF").toUpperCase();
    if (!(c in DEFAULT_FX_TO_CHF)) return amount;
    return amount * getRateToChf(month, c as AccountCurrency);
  };

  const chartData = useMemo(() => {
    // 1) Filtre les revenus du processeur (EMP par défaut) triés par mois.
    const empRevenues = revenues
      .filter((r) => r.processor.toLowerCase() === processorFilter.toLowerCase())
      .slice()
      .sort((a, b) => a.month.localeCompare(b.month));
    if (empRevenues.length === 0) return null;

    // 2) Agrège les retentions par mois d'origine (converti CHF), avec la
    //    durée de retention (rollingReserveMonths). Si plusieurs revenus
    //    au même mois ont des durées différentes, on prend le max (plus
    //    prudent — les fonds les plus tardifs restent bloqués).
    type Origin = { month: string; withheld: number; reserveMonths: number };
    const originMap = new Map<string, Origin>();
    for (const r of empRevenues) {
      const withheld = (r.capturedAmount * (r.rollingReservePercent ?? 0)) / 100;
      if (withheld <= 0) continue;
      const withheldChf = toChf(withheld, r.currency, r.month);
      const reserveMonths = r.rollingReserveMonths || 6;
      const existing = originMap.get(r.month) ?? {
        month: r.month,
        withheld: 0,
        reserveMonths,
      };
      existing.withheld += withheldChf;
      existing.reserveMonths = Math.max(existing.reserveMonths, reserveMonths);
      originMap.set(r.month, existing);
    }
    const origins = [...originMap.values()].sort((a, b) =>
      a.month.localeCompare(b.month),
    );

    // 3) Pour chaque mois visible M, liste les segments encore actifs :
    //    origine X, released_at = X + reserveMonths, X ≤ M ET released_at > M.
    return months.map((m) => {
      const segments: {
        from: string;
        release: string;
        amount: number;
      }[] = [];
      for (const o of origins) {
        if (compareMonth(o.month, m) > 0) continue; // origine future — pas encore
        const release = addMonths(o.month, o.reserveMonths);
        // Segment actif si release > m (pas encore libéré au mois m)
        if (compareMonth(release, m) <= 0) continue;
        segments.push({
          from: o.month,
          release,
          amount: o.withheld,
        });
      }
      // Ordre du bas vers le haut : plus ancien en bas (bientôt libéré).
      segments.sort((a, b) => a.from.localeCompare(b.from));
      const stock = segments.reduce((s, seg) => s + seg.amount, 0);
      return { month: m, segments, stock };
    });
  }, [revenues, months, processorFilter]);

  if (!chartData || chartData.length === 0) {
    return (
      <div className="card p-5 text-[12px] text-muted">
        Aucun revenu {processorFilter} sur la période — impossible de calculer
        le rolling reserve.
      </div>
    );
  }

  // ------- Rendu SVG -------
  const width = 720;
  const height = 260;
  const padLeft = 60;
  const padRight = 20;
  const padY = 24;
  const innerW = width - padLeft - padRight;
  const innerH = height - padY * 2;

  const maxStock = Math.max(...chartData.map((d) => d.stock)) * 1.15 || 1;
  const yOf = (v: number) => padY + innerH - (v / maxStock) * innerH;
  const xOf = (i: number) => padLeft + (i + 0.5) * (innerW / chartData.length);
  const colW = innerW / chartData.length;
  const barW = colW * 0.6;

  const currentStock = chartData[chartData.length - 1].stock;
  const startStock = chartData[0].stock;
  const delta = currentStock - startStock;

  // Labels axe Y (5 crans)
  const fmtShort = (n: number): string => {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
    if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
    return n.toFixed(0);
  };
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    y: padY + innerH * t,
    v: maxStock - maxStock * t,
  }));

  // Palette : gradient jaune → orange selon l'ordre (plus ancien = plus foncé)
  const segColor = (segIdx: number, total: number): string => {
    if (total <= 1) return "#f59e0b";
    const t = segIdx / (total - 1); // 0 = plus ancien (bas), 1 = plus recent (haut)
    // interpole entre #d97706 (foncé) et #fcd34d (clair)
    const r = Math.round(217 + (252 - 217) * t);
    const g = Math.round(119 + (211 - 119) * t);
    const b = Math.round(6 + (77 - 6) * t);
    return `rgb(${r}, ${g}, ${b})`;
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div>
          <div className="text-[14px] font-medium">
            Stock cumulé chez {processorFilter}
          </div>
          <div className="text-[11px] text-muted mt-0.5">
            Chaque bande = un mois de retention (empilée du plus ancien au
            plus récent). Survole pour voir la date de libération.
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted">
            Bloqué à date
          </div>
          <div className="text-[18px] font-mono tabular-nums font-semibold">
            {formatAmount(currentStock, "CHF")}
          </div>
          {delta !== 0 && (
            <div
              className={`text-[11px] font-mono tabular-nums ${delta > 0 ? "text-warn" : "text-ok"}`}
            >
              {delta > 0 ? "+" : ""}
              {formatAmount(delta, "CHF")} sur la période
            </div>
          )}
        </div>
      </div>

      <div className="w-full overflow-x-auto">
        <div className="relative">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-[260px] block"
            onMouseLeave={() => setHover(null)}
          >
            {/* Grille horizontale + labels axe Y */}
            {yTicks.map((tick, idx) => (
              <g key={idx}>
                <line
                  x1={padLeft}
                  x2={width - padRight}
                  y1={tick.y}
                  y2={tick.y}
                  stroke="#243049"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                />
                <text
                  x={padLeft - 8}
                  y={tick.y + 3}
                  fontSize={10}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontFamily="ui-monospace, SFMono-Regular, monospace"
                >
                  {fmtShort(tick.v)}
                </text>
              </g>
            ))}

            {/* Barres empilées par segment (mois d'origine) */}
            {chartData.map((d, i) => {
              // Empile du bas vers le haut
              let y0 = yOf(0);
              return (
                <g key={d.month}>
                  {d.segments.map((seg, si) => {
                    const y1 = yOf(
                      d.segments.slice(0, si + 1).reduce((s, s2) => s + s2.amount, 0),
                    );
                    const h = y0 - y1;
                    const isHover =
                      hover?.monthIdx === i && hover?.segIdx === si;
                    const rectY = y1;
                    y0 = y1;
                    const anyHover = hover?.monthIdx === i;
                    return (
                      <rect
                        key={`${d.month}-${si}`}
                        x={xOf(i) - barW / 2}
                        y={rectY}
                        width={barW}
                        height={Math.max(0, h)}
                        fill={segColor(si, d.segments.length)}
                        opacity={anyHover && !isHover ? 0.45 : 1}
                        stroke={isHover ? "#0f1525" : "#f7f5ee"}
                        strokeWidth={isHover ? 1.5 : 0.5}
                        style={{ transition: "opacity .15s" }}
                        onMouseEnter={() =>
                          setHover({
                            monthIdx: i,
                            segIdx: si,
                            label: d.month,
                            from: seg.from,
                            release: seg.release,
                            amount: seg.amount,
                          })
                        }
                      />
                    );
                  })}
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
              );
            })}
          </svg>

          {/* Tooltip HTML positionné selon le segment survolé */}
          {hover && (
            <div
              className="absolute pointer-events-none z-10 min-w-[240px]"
              style={{
                left: `${(xOf(hover.monthIdx) / width) * 100}%`,
                top: 8,
                transform:
                  (xOf(hover.monthIdx) / width) * 100 > 60
                    ? "translateX(calc(-100% - 10px))"
                    : "translateX(10px)",
              }}
            >
              <div className="bg-panel border border-border rounded-md shadow-lg px-3 py-2.5 text-[11.5px]">
                <div className="font-medium text-text mb-1.5 pb-1.5 border-b border-border">
                  Segment du stock — {formatMonthLabel(hover.label)}
                </div>
                <div className="space-y-1">
                  <TooltipRow label="Retenu au" value={formatMonthLabel(hover.from)} />
                  <TooltipRow
                    label="Libéré au"
                    value={formatMonthLabel(hover.release)}
                    strong
                  />
                  <TooltipRow
                    label="Montant"
                    value={formatAmount(hover.amount, "CHF")}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-muted mt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ background: "#d97706" }} />
          <span>Plus ancien (bientôt libéré)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ background: "#fcd34d" }} />
          <span>Plus récent</span>
        </div>
        <span className="ml-auto text-[10px] italic">
          Survole une bande pour voir sa date de libération
        </span>
      </div>
    </div>
  );
}

function TooltipRow({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span
        className={`font-mono tabular-nums ${strong ? "text-warn font-semibold" : "text-text"}`}
      >
        {value}
      </span>
    </div>
  );
}

/** "2026-01" + 6 → "2026-07" ; "2026-10" + 6 → "2027-04". */
function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** -1 if a < b, 0 equal, 1 if a > b. */
function compareMonth(a: string, b: string): number {
  return a.localeCompare(b);
}
