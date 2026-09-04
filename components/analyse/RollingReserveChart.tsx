"use client";

import { useMemo, useState } from "react";
import { useStore } from "@/lib/store";
import { formatAmount } from "@/lib/format";
import { formatMonthLabel } from "@/lib/store";
import { getRateToChf, DEFAULT_FX_TO_CHF } from "@/lib/fx";
import type { AccountCurrency } from "@/lib/types";

/**
 * Graphique du STOCK cumulé de rolling reserve retenu par EMP.
 *
 * Modèle EMP : chaque mois, EMP retient `rollingReservePercent`% du capturé
 * (= créance immobilisée, pas une charge), et libère un montant de reserves
 * d'une période plus ancienne (`txCounts.releasedReserveAmount`).
 *
 * Stock cumulé[m] = Σ(retenu - libéré) depuis le début, borné au mois m.
 *
 * On considère TOUT l'historique (pas juste la période visible) pour que
 * le stock initial de janvier reflète bien ce qui traîne des mois précédents.
 */
export function RollingReserveChart({
  months,
  processorFilter = "EMP",
}: {
  /** Liste de mois YYYY-MM à afficher sur le graphe (subset de tout l'historique). */
  months: string[];
  /** Filtre processeur (par défaut EMP — celui qui applique un rolling). */
  processorFilter?: string;
}) {
  const { revenues } = useStore();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  // Convertit un montant local en CHF au taux du mois donné.
  const toChf = (amount: number, currency: string, month: string) => {
    const c = (currency || "CHF").toUpperCase();
    if (!(c in DEFAULT_FX_TO_CHF)) return amount;
    return amount * getRateToChf(month, c as AccountCurrency);
  };

  const chartData = useMemo(() => {
    // 1) Récupère TOUS les revenus EMP triés par mois croissant.
    const empRevenues = revenues
      .filter(
        (r) => r.processor.toLowerCase() === processorFilter.toLowerCase(),
      )
      .slice()
      .sort((a, b) => a.month.localeCompare(b.month));
    if (empRevenues.length === 0) return null;

    // 2) Agrège par mois : retenu + libéré (converti CHF).
    const perMonth = new Map<
      string,
      { withheld: number; released: number }
    >();
    for (const r of empRevenues) {
      const withheld =
        (r.capturedAmount * (r.rollingReservePercent ?? 0)) / 100;
      const released = r.txCounts?.releasedReserveAmount ?? 0;
      const cur = perMonth.get(r.month) ?? { withheld: 0, released: 0 };
      cur.withheld += toChf(withheld, r.currency, r.month);
      cur.released += toChf(released, r.currency, r.month);
      perMonth.set(r.month, cur);
    }

    // 3) Calcule le stock cumulé mois par mois. On part du premier mois
    //    présent en base et on parcourt jusqu'au dernier mois affiché.
    const allMonths = [...perMonth.keys()].sort();
    const lastVisible = months[months.length - 1];
    const firstDataMonth = allMonths[0];
    const stockByMonth = new Map<string, number>();
    let cumulated = 0;
    // Enumere du premier data jusqu'au dernier visible (bornes inclusives).
    const cur = enumerateMonths(firstDataMonth, lastVisible ?? firstDataMonth);
    for (const m of cur) {
      const flow = perMonth.get(m) ?? { withheld: 0, released: 0 };
      cumulated += flow.withheld - flow.released;
      stockByMonth.set(m, cumulated);
    }

    // 4) Ne garde que les mois de la période visible.
    return months.map((m) => ({
      month: m,
      stock: stockByMonth.get(m) ?? cumulated, // futur : reste au niveau actuel
      withheld: (perMonth.get(m)?.withheld ?? 0),
      released: (perMonth.get(m)?.released ?? 0),
    }));
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
  const height = 240;
  const padX = 40;
  const padY = 24;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const maxStock = Math.max(...chartData.map((d) => d.stock)) * 1.15 || 1;
  const yOf = (v: number) => padY + innerH - (v / maxStock) * innerH;
  const xOf = (i: number) => padX + (i + 0.5) * (innerW / chartData.length);
  const colW = innerW / chartData.length;
  const barW = colW * 0.6;

  const currentStock = chartData[chartData.length - 1].stock;
  const startStock = chartData[0].stock;
  const delta = currentStock - startStock;

  const hovered = hoverIdx != null ? chartData[hoverIdx] : null;
  const tooltipLeftPct =
    hoverIdx != null ? (xOf(hoverIdx) / width) * 100 : 0;
  const tooltipOnRight = tooltipLeftPct > 60;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-4 mb-3">
        <div>
          <div className="text-[14px] font-medium">
            Stock cumulé chez {processorFilter}
          </div>
          <div className="text-[11px] text-muted mt-0.5">
            Somme du rolling retenu, moins les libérations. Représente la
            créance immobilisée chez le processeur à date.
          </div>
        </div>
        <div className="text-right">
          <div
            className="text-[10px] uppercase tracking-wider text-muted"
            title="Montant bloqué chez EMP à la fin du dernier mois affiché."
          >
            Bloqué à date
          </div>
          <div className="text-[18px] font-mono tabular-nums font-semibold">
            {formatAmount(currentStock, "CHF")}
          </div>
          {delta !== 0 && (
            <div
              className={`text-[11px] font-mono tabular-nums ${delta > 0 ? "text-warn" : "text-ok"}`}
              title="Variation sur la période visible."
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
            className="w-full h-[240px] block"
            onMouseLeave={() => setHoverIdx(null)}
          >
            {/* Grille */}
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

            {/* Fil vertical du mois survolé */}
            {hoverIdx != null && (
              <line
                x1={xOf(hoverIdx)}
                x2={xOf(hoverIdx)}
                y1={padY}
                y2={height - padY}
                stroke="#f59e0b"
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.5}
                pointerEvents="none"
              />
            )}

            {/* Barres du stock cumulé */}
            {chartData.map((d, i) => (
              <g key={d.month}>
                <rect
                  x={xOf(i) - barW / 2}
                  y={yOf(d.stock)}
                  width={barW}
                  height={yOf(0) - yOf(d.stock)}
                  fill="url(#grad-rolling)"
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

            {/* Zone hover */}
            {chartData.map((d, i) => (
              <rect
                key={`hit-${d.month}`}
                x={padX + i * colW}
                y={padY}
                width={colW}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                style={{ cursor: "pointer" }}
              />
            ))}

            <defs>
              <linearGradient id="grad-rolling" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#fbbf24" />
                <stop offset="100%" stopColor="#f59e0b" />
              </linearGradient>
            </defs>
          </svg>

          {hovered && hoverIdx != null && (
            <div
              className="absolute pointer-events-none z-10 min-w-[220px]"
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
                  <TooltipRow
                    color="#f59e0b"
                    label="Stock cumulé bloqué"
                    value={hovered.stock}
                    strong
                  />
                  <TooltipRow
                    color="#94a3b8"
                    label="Retenu ce mois"
                    value={hovered.withheld}
                  />
                  <TooltipRow
                    color="#22c55e"
                    label="Libéré ce mois"
                    value={hovered.released}
                  />
                  <div className="pt-1 mt-1 border-t border-border/50 text-muted text-[10.5px]">
                    Flux net :{" "}
                    <span
                      className={
                        hovered.withheld - hovered.released >= 0
                          ? "text-warn font-mono"
                          : "text-ok font-mono"
                      }
                    >
                      {hovered.withheld - hovered.released >= 0 ? "+" : ""}
                      {formatAmount(hovered.withheld - hovered.released, "CHF")}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 text-[11px] text-muted mt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm" style={{ background: "#f59e0b" }} />
          <span>Stock cumulé (bloqué)</span>
        </div>
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

function enumerateMonths(start: string, end: string): string[] {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const out: string[] = [];
  let y = sy;
  let m = sm;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}
