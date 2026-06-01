"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, RefreshCw, AlertCircle } from "lucide-react";
import { useStore, formatMonthLabel } from "@/lib/store";
import { formatAmount } from "@/lib/format";
import {
  computeExpenseTotal,
  detectInterAccountTransfers,
  type ParsedSheet,
} from "@/lib/excel-match";
import { convertAmount, getFxRate } from "@/lib/fx";
import type { AccountCurrency } from "@/lib/types";

const CA_COLOR = "#3b82f6"; // blue-500
const EXPENSES_COLOR = "#10b981"; // emerald-500

type MonthlyPoint = { month: string; ca: number; expenses: number };

const MONTHS_TO_SHOW = 6;
const CURRENCIES: AccountCurrency[] = ["USD", "EUR", "CHF"];

// Annotation one-shot : achat du business IFY en avril 2026 (-60'627,74 EUR
// sortis du compte EUR). On affiche un 2ème point Dépenses sur ce mois,
// hors achat, pour montrer ce que les dépenses opérationnelles "normales"
// auraient été. Ne PAS étendre cette logique aux autres mois sans demande.
const IFY_ACQUISITION = {
  month: "2026-04",
  amountEur: 60627.74,
  label: "IFY acquisition",
};

/** Récupère un sheet via l'API. Renvoie null si rien stocké. */
async function fetchSheet(
  month: string,
  currency: AccountCurrency,
  signal: AbortSignal,
): Promise<ParsedSheet | null> {
  try {
    const r = await fetch(`/api/excel-sheets/${month}?currency=${currency}`, {
      cache: "no-store",
      signal,
    });
    if (!r.ok) return null;
    const data = (await r.json()) as {
      sheet: {
        headers: string[];
        rows: (string | number | null)[][];
      } | null;
    };
    if (!data.sheet) return null;
    return { headers: data.sheet.headers, rows: data.sheet.rows };
  } catch {
    return null;
  }
}

/**
 * Construit les N derniers mois et calcule pour chacun :
 *  - CA : somme des revenues du mois (capturedAmount filtré par business)
 *  - Dépenses : somme des débits des 3 rapprochements Excel (CHF/EUR/USD),
 *    convertis en USD via taux moyens. Tous comptes confondus.
 */
function buildMonths(): string[] {
  const now = new Date();
  const months: string[] = [];
  for (let i = MONTHS_TO_SHOW - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}

export function DashboardChart() {
  const { revenues, businesses, ready, dbError, reloadFromDb } = useStore();
  const [filter, setFilter] = useState<string>("all");
  const [reloading, setReloading] = useState(false);

  const handleManualReload = async () => {
    setReloading(true);
    try {
      await reloadFromDb();
    } finally {
      setReloading(false);
    }
  };

  const months = useMemo(() => buildMonths(), []);
  // expensesByMonth[ym] = total dépenses USD, somme des 3 buckets convertis.
  const [expensesByMonth, setExpensesByMonth] = useState<Record<string, number>>(
    {},
  );
  // transfersByMonth[ym] = { count, amountUsd } : pour informer l'utilisateur
  // de combien de transferts inter-comptes ont été détectés + exclus.
  const [transfersByMonth, setTransfersByMonth] = useState<
    Record<string, { count: number; amountUsd: number }>
  >({});

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      const next: Record<string, number> = {};
      const transfersNext: Record<string, { count: number; amountUsd: number }> =
        {};
      // Pour chaque mois : on charge les 3 sheets EN PARALLÈLE, on détecte
      // les transferts inter-comptes (genre EUR → CHF), puis on calcule
      // le total des dépenses EN EXCLUANT ces transferts.
      await Promise.all(
        months.map(async (month) => {
          const sheets: Partial<
            Record<AccountCurrency, ParsedSheet | null | undefined>
          > = {};
          await Promise.all(
            CURRENCIES.map(async (currency) => {
              const sheet = await fetchSheet(month, currency, controller.signal);
              if (cancelled) return;
              sheets[currency] = sheet;
            }),
          );
          if (cancelled) return;

          // Détection des transferts internes (débit > 4k matchant un
          // crédit dans une autre devise, ±5% FX, ±7j).
          const transfers = detectInterAccountTransfers(
            sheets,
            (from, to) => getFxRate(month, from, to),
            { minAmount: 4000, amountTolerance: 0.05, dateWindowDays: 7 },
          );
          // Index : currency → set des rowIndex à exclure du débit total.
          const excludedRowsByCurrency = new Map<AccountCurrency, Set<number>>();
          let transfersAmountUsd = 0;
          for (const t of transfers) {
            const set =
              excludedRowsByCurrency.get(t.debit.currency) ?? new Set<number>();
            set.add(t.debit.rowIndex);
            excludedRowsByCurrency.set(t.debit.currency, set);
            transfersAmountUsd += convertAmount(
              t.debit.amount,
              t.debit.currency,
              "USD",
              month,
            );
          }
          if (transfers.length > 0) {
            transfersNext[month] = {
              count: transfers.length,
              amountUsd: transfersAmountUsd,
            };
          }

          let totalUsd = 0;
          for (const currency of CURRENCIES) {
            const sheet = sheets[currency];
            if (!sheet) continue;
            const { totalDebit, rowDebits } = computeExpenseTotal(sheet);
            // Si pas de transfert → somme directe ; sinon on soustrait
            // les rows exclues.
            const excluded = excludedRowsByCurrency.get(currency);
            let localDebit = totalDebit;
            if (excluded && excluded.size > 0) {
              let removed = 0;
              for (const idx of excluded) {
                removed += rowDebits[idx] ?? 0;
              }
              localDebit -= removed;
            }
            totalUsd += convertAmount(localDebit, currency, "USD", month);
          }
          next[month] = totalUsd;
        }),
      );
      if (!cancelled) {
        setExpensesByMonth(next);
        setTransfersByMonth(transfersNext);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [months]);

  const data: MonthlyPoint[] = useMemo(() => {
    return months.map((ym) => {
      const filtered =
        filter === "all"
          ? revenues.filter((r) => r.month === ym)
          : revenues.filter((r) => r.month === ym && r.businessId === filter);
      const ca = filtered.reduce((s, r) => s + (r.capturedAmount ?? 0), 0);
      const expenses = expensesByMonth[ym] ?? 0;
      return { month: ym, ca, expenses };
    });
  }, [months, revenues, filter, expensesByMonth]);

  // Si toutes les valeurs sont 0, on affiche un message au lieu d'un chart vide.
  const hasData = data.some((p) => p.ca > 0 || p.expenses > 0);

  // Diagnostic CA = 0 sur tous les mois visibles. Aide à savoir POURQUOI :
  //  - store pas prêt (fetch /api/state pas fini ou échoué)
  //  - revenues vide en DB
  //  - revenues présents mais hors fenêtre (mois antérieurs)
  //  - revenues présents dans la fenêtre mais capturedAmount = 0
  const caDiagnostic = useMemo(() => {
    const allCaZero = data.every((p) => p.ca === 0);
    if (!allCaZero) return null;
    const monthsSet = new Set(months);
    const inWindow = revenues.filter((r) => monthsSet.has(r.month));
    const inWindowWithAmount = inWindow.filter(
      (r) => (r.capturedAmount ?? 0) > 0,
    );
    // Mois distincts trouvés en DB (max 6 affichés pour pas spammer).
    const allMonthsInDb = Array.from(
      new Set(revenues.map((r) => r.month).filter(Boolean)),
    ).sort();
    return {
      ready,
      hasDbError: !!dbError,
      dbErrorMessage: dbError?.message ?? null,
      totalRevenuesLoaded: revenues.length,
      revenuesInWindow: inWindow.length,
      revenuesInWindowWithAmount: inWindowWithAmount.length,
      windowMonths: months,
      monthsFoundInDb: allMonthsInDb.slice(-12), // 12 derniers mois max
    };
  }, [data, revenues, months, ready, dbError]);

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
            Chiffre d&apos;affaires et dépenses (3 comptes confondus) en USD
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleManualReload}
            disabled={reloading}
            className="btn !py-1 !px-2 text-[11px] disabled:opacity-50"
            title="Recharger les données du store (revenues, businesses, etc.) sans rafraîchir la page entière."
          >
            <RefreshCw
              size={11}
              className={reloading ? "animate-spin" : ""}
            />
            {reloading ? "Chargement…" : "Recharger"}
          </button>
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
      </div>

      {caDiagnostic && (
        <CaDiagnosticBanner
          info={caDiagnostic}
          onReload={handleManualReload}
          reloading={reloading}
        />
      )}

      {hasData ? (
        <LineChart data={data} transfersByMonth={transfersByMonth} />
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

function LineChart({
  data,
  transfersByMonth,
}: {
  data: MonthlyPoint[];
  transfersByMonth: Record<string, { count: number; amountUsd: number }>;
}) {
  // Mesure la largeur réelle du conteneur — comme ça la SVG remplit
  // exactement l'espace dispo, sans bandes vides à cause d'un viewBox
  // d'un autre ratio.
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  // Index du point survolé (null = pas de hover).
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

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
    Math.max(...data.flatMap((d) => [d.ca, d.expenses]), 1) * 1.15;
  const minVal = 0;
  const range = maxVal - minVal || 1;

  const xOf = (i: number) =>
    padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const yOf = (v: number) => padT + innerH - ((v - minVal) / range) * innerH;

  // Annotation IFY acquisition : indice du mois ciblé + montant en USD
  // converti via le taux moyen du mois (lib/fx). On ne rend rien si le
  // mois n'est pas dans la fenêtre 6 mois affichée.
  const ifyIdx = data.findIndex((d) => d.month === IFY_ACQUISITION.month);
  const ifyUsd =
    ifyIdx >= 0
      ? convertAmount(
          IFY_ACQUISITION.amountEur,
          "EUR",
          "USD",
          IFY_ACQUISITION.month,
        )
      : 0;
  const ifyPoint = ifyIdx >= 0 ? data[ifyIdx] : null;
  const ifyExpensesWithout = ifyPoint
    ? Math.max(0, ifyPoint.expenses - ifyUsd)
    : 0;

  // Map mouse X → index du point le plus proche, pour le tooltip au hover.
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * width;
    // Recherche du point le plus proche par distance horizontale.
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const d = Math.abs(xOf(i) - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setHoverIdx(best);
  };
  const hoverPoint = hoverIdx != null ? data[hoverIdx] : null;
  const hoverMargin = hoverPoint ? hoverPoint.ca - hoverPoint.expenses : 0;

  const caPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(d.ca)}`)
    .join(" ");
  const expensesPath = data
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xOf(i)} ${yOf(d.expenses)}`)
    .join(" ");

  const caArea = `${caPath} L ${xOf(data.length - 1)} ${yOf(minVal)} L ${xOf(0)} ${yOf(minVal)} Z`;
  const yTicks = [0, 0.33, 0.66, 1].map((t) => minVal + range * t);

  return (
    <div ref={containerRef} className="w-full relative">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block"
        onMouseMove={onMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
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
        {/* Ligne Dépenses */}
        <path
          d={expensesPath}
          fill="none"
          stroke={EXPENSES_COLOR}
          strokeWidth={2.5}
        />

        {/* Points + labels mois */}
        {data.map((d, i) => (
          <g key={d.month}>
            <circle cx={xOf(i)} cy={yOf(d.ca)} r={3.5} fill={CA_COLOR} />
            <circle
              cx={xOf(i)}
              cy={yOf(d.expenses)}
              r={3.5}
              fill={EXPENSES_COLOR}
            />
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

        {/* Annotation IFY acquisition (avril 2026 uniquement).
            Trajectoire alternative en pointillés : mois précédent →
            point hors-IFY d'avril → mois suivant. Schématise ce qu'aurait
            été la courbe Dépenses sans l'achat one-shot. */}
        {ifyIdx >= 0 && ifyPoint && (
          <g pointerEvents="none">
            {/* Segment précédent (Mars → avril hors-IFY) */}
            {ifyIdx > 0 && (
              <line
                x1={xOf(ifyIdx - 1)}
                x2={xOf(ifyIdx)}
                y1={yOf(data[ifyIdx - 1].expenses)}
                y2={yOf(ifyExpensesWithout)}
                stroke={EXPENSES_COLOR}
                strokeWidth={1.75}
                strokeDasharray="4 3"
                opacity={0.7}
              />
            )}
            {/* Segment suivant (avril hors-IFY → Mai) */}
            {ifyIdx < data.length - 1 && (
              <line
                x1={xOf(ifyIdx)}
                x2={xOf(ifyIdx + 1)}
                y1={yOf(ifyExpensesWithout)}
                y2={yOf(data[ifyIdx + 1].expenses)}
                stroke={EXPENSES_COLOR}
                strokeWidth={1.75}
                strokeDasharray="4 3"
                opacity={0.7}
              />
            )}
            {/* Point creux pour distinguer du point principal */}
            <circle
              cx={xOf(ifyIdx)}
              cy={yOf(ifyExpensesWithout)}
              r={4}
              fill="#1a2342"
              stroke={EXPENSES_COLOR}
              strokeWidth={2}
            />
            {/* Label sous le point */}
            <text
              x={xOf(ifyIdx) + 8}
              y={yOf(ifyExpensesWithout) + 4}
              fontSize={10}
              fill={EXPENSES_COLOR}
              fillOpacity={0.85}
            >
              {IFY_ACQUISITION.label}
            </text>
          </g>
        )}

        {/* Ligne verticale de guide + halo au point survolé */}
        {hoverIdx != null && hoverPoint && (
          <g pointerEvents="none">
            <line
              x1={xOf(hoverIdx)}
              x2={xOf(hoverIdx)}
              y1={padT}
              y2={padT + innerH}
              stroke="#475569"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <circle
              cx={xOf(hoverIdx)}
              cy={yOf(hoverPoint.ca)}
              r={6}
              fill={CA_COLOR}
              fillOpacity={0.25}
            />
            <circle
              cx={xOf(hoverIdx)}
              cy={yOf(hoverPoint.expenses)}
              r={6}
              fill={EXPENSES_COLOR}
              fillOpacity={0.25}
            />
          </g>
        )}
      </svg>

      {/* Tooltip HTML positionné au-dessus du point survolé.
          Décale horizontalement selon la position pour pas déborder
          du chart sur les premiers/derniers points. */}
      {hoverIdx != null && hoverPoint && (() => {
        const xPct = (xOf(hoverIdx) / width) * 100;
        // Smooth clamp : -10% à gauche, -90% à droite, -50% au milieu.
        const xOffsetPct = xPct < 15 ? -10 : xPct > 85 ? -90 : -50;
        return (
        <div
          className="absolute pointer-events-none bg-panel2 border border-border rounded-lg px-3 py-2 text-[11px] shadow-xl tabular-nums whitespace-nowrap"
          style={{
            left: `${xPct}%`,
            top: `${(Math.min(yOf(hoverPoint.ca), yOf(hoverPoint.expenses)) / height) * 100}%`,
            transform: `translate(${xOffsetPct}%, calc(-100% - 12px))`,
          }}
        >
          <div className="font-semibold text-[12px] mb-1.5">
            {formatMonthLabel(hoverPoint.month)}
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: CA_COLOR }} />
            <span className="text-muted">CA</span>
            <span className="ml-auto text-text font-medium">
              {formatAmount(hoverPoint.ca, "USD")}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: EXPENSES_COLOR }}
            />
            <span className="text-muted">Dépenses</span>
            <span className="ml-auto text-text font-medium">
              {formatAmount(hoverPoint.expenses, "USD")}
            </span>
          </div>
          <div className="border-t border-border mt-1.5 pt-1.5 flex items-center gap-2">
            <span className="text-muted">Marge brute</span>
            <span
              className={`ml-auto font-semibold ${
                hoverMargin >= 0 ? "text-ok" : "text-err"
              }`}
            >
              {hoverMargin >= 0 ? "+" : ""}
              {formatAmount(hoverMargin, "USD")}
              {hoverPoint.ca > 0 && (
                <span className="ml-1 text-[10px] font-normal opacity-80">
                  ({((hoverMargin / hoverPoint.ca) * 100).toFixed(1)} %)
                </span>
              )}
            </span>
          </div>
          {/* Sur le mois de l'acquisition IFY, on affiche aussi la version
              "hors acquisition" pour aider à comparer avec les autres mois. */}
          {hoverPoint.month === IFY_ACQUISITION.month && (
            <div className="border-t border-border mt-1.5 pt-1.5 space-y-0.5">
              <div className="flex items-center gap-2 text-[10px] text-muted">
                <span
                  className="inline-block w-2 h-2 rounded-full border"
                  style={{ borderColor: EXPENSES_COLOR }}
                />
                <span>Hors {IFY_ACQUISITION.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted">Dépenses</span>
                <span className="ml-auto text-text">
                  {formatAmount(ifyExpensesWithout, "USD")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted">Marge brute</span>
                <span
                  className={`ml-auto font-semibold ${
                    hoverPoint.ca - ifyExpensesWithout >= 0
                      ? "text-ok"
                      : "text-err"
                  }`}
                >
                  {hoverPoint.ca - ifyExpensesWithout >= 0 ? "+" : ""}
                  {formatAmount(hoverPoint.ca - ifyExpensesWithout, "USD")}
                  {hoverPoint.ca > 0 && (
                    <span className="ml-1 text-[10px] font-normal opacity-80">
                      (
                      {(
                        ((hoverPoint.ca - ifyExpensesWithout) / hoverPoint.ca) *
                        100
                      ).toFixed(1)}{" "}
                      %)
                    </span>
                  )}
                </span>
              </div>
              <div className="text-[10px] text-muted mt-1">
                Achat one-shot : {formatAmount(IFY_ACQUISITION.amountEur, "EUR")}{" "}
                (≈ {formatAmount(ifyUsd, "USD")})
              </div>
            </div>
          )}
        </div>
        );
      })()}

      <div className="flex items-center gap-4 text-[11px] text-muted pt-2 px-2 flex-wrap">
        <Legend color={CA_COLOR} label="Chiffre d'affaires" />
        <Legend color={EXPENSES_COLOR} label="Dépenses (3 comptes)" />
        {(() => {
          // Total transferts détectés sur les 6 mois visibles.
          const totalCount = data.reduce(
            (s, d) => s + (transfersByMonth[d.month]?.count ?? 0),
            0,
          );
          const totalAmount = data.reduce(
            (s, d) => s + (transfersByMonth[d.month]?.amountUsd ?? 0),
            0,
          );
          if (totalCount === 0) return null;
          return (
            <span
              className="text-[11px] text-accent"
              title={`Débits identifiés comme transferts inter-comptes (EUR↔CHF↔USD) et exclus du total des dépenses. Détection : débit > 4 000 matchant un crédit dans une autre devise à ±5%, ±7 jours.`}
            >
              ↔ {totalCount} transfert{totalCount > 1 ? "s" : ""} interne
              {totalCount > 1 ? "s" : ""} exclu{totalCount > 1 ? "s" : ""} (
              {formatAmount(totalAmount, "USD")})
            </span>
          );
        })()}
        <div className="ml-auto tabular-nums text-text">
          Dernier mois : {formatAmount(data[data.length - 1].ca, "USD")} CA ·{" "}
          {formatAmount(data[data.length - 1].expenses, "USD")} dépenses
        </div>
      </div>
    </div>
  );
}

/**
 * Bannière de diagnostic affichée quand la ligne CA est plate à 0 sur
 * la fenêtre. Donne assez d'infos pour comprendre la cause sans avoir
 * à ouvrir la console : store ready ?, revenues chargés ?, mois trouvés
 * en DB ?
 */
function CaDiagnosticBanner({
  info,
  onReload,
  reloading,
}: {
  info: {
    ready: boolean;
    hasDbError: boolean;
    dbErrorMessage: string | null;
    totalRevenuesLoaded: number;
    revenuesInWindow: number;
    revenuesInWindowWithAmount: number;
    windowMonths: string[];
    monthsFoundInDb: string[];
  };
  onReload: () => void;
  reloading: boolean;
}) {
  // Devine la cause la plus probable pour formuler le message.
  let title: string;
  let detail: string;
  let tone: "warn" | "err" = "warn";
  if (info.hasDbError) {
    tone = "err";
    title = "Impossible de charger les données";
    detail = info.dbErrorMessage ?? "Erreur DB inconnue.";
  } else if (!info.ready) {
    title = "Données en cours de chargement…";
    detail =
      "Le store n'a pas encore terminé de récupérer revenues + invoices. Patiente quelques secondes ou clique Recharger.";
  } else if (info.totalRevenuesLoaded === 0) {
    title = "Aucun revenu en base";
    detail =
      "La table revenues est vide. Va dans Revenus pour saisir un mois (ex. import EMP + country file).";
  } else if (info.revenuesInWindow === 0) {
    title = "Revenus présents mais hors fenêtre 6 mois";
    detail = `${info.totalRevenuesLoaded} revenu(s) en base, aucun dans ${info.windowMonths[0]} → ${info.windowMonths[info.windowMonths.length - 1]}. Mois trouvés : ${info.monthsFoundInDb.join(", ") || "—"}.`;
  } else if (info.revenuesInWindowWithAmount === 0) {
    title = "Revenus présents mais capturedAmount = 0";
    detail = `${info.revenuesInWindow} revenu(s) sur la fenêtre, tous à 0. L'import EMP / country file a probablement échoué ou n'a pas été sauvegardé.`;
  } else {
    // Cas étrange : on a des revenues > 0 dans la fenêtre mais le chart
    // affiche 0. Signal un bug de filter (businessId ?), race re-render…
    tone = "err";
    title = "Incohérence : revenus présents mais chart à 0";
    detail = `${info.revenuesInWindowWithAmount} revenu(s) avec capturedAmount > 0 dans la fenêtre, mais le chart en affiche 0. Recharge pour réessayer — si ça persiste, c'est un bug d'agrégation.`;
  }

  const toneClasses =
    tone === "err"
      ? "border-err/30 bg-err/[0.06] text-err"
      : "border-warn/30 bg-warn/[0.06] text-warn";

  return (
    <div
      className={`border rounded-lg px-3 py-2 mb-3 text-[11px] flex items-start gap-2 ${toneClasses}`}
    >
      <AlertCircle size={13} className="shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{title}</div>
        <div className="text-muted text-[10.5px] mt-0.5">{detail}</div>
        <div className="text-muted text-[10px] mt-1 tabular-nums">
          ready={String(info.ready)} · revenues={info.totalRevenuesLoaded} ·
          dans fenêtre={info.revenuesInWindow} · avec montant={info.revenuesInWindowWithAmount}
        </div>
      </div>
      <button
        onClick={onReload}
        disabled={reloading}
        className="btn !py-1 !px-2 text-[10px] shrink-0 disabled:opacity-50"
      >
        <RefreshCw size={10} className={reloading ? "animate-spin" : ""} />
        Recharger
      </button>
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
