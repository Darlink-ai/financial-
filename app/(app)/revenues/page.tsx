"use client";

import { useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { BusinessSelector, BusinessDot } from "@/components/BusinessSelector";
import {
  useStore,
  useRevenuesForCurrentMonth,
  formatMonthLabel,
} from "@/lib/store";
import { parseCountryFile } from "@/lib/parse-country-file";
import { Select } from "@/components/ui/Select";

// Processeurs de paiement gérés par la plateforme. À étendre quand on
// branchera d'autres providers.
const PROCESSOR_OPTIONS = [
  { value: "EMP", label: "EMP" },
  { value: "Centrobill", label: "Centrobill" },
];
import {
  Plus,
  Trash2,
  Upload,
  Globe,
  Banknote,
  Percent,
  Clock,
  ChevronRight,
  TrendingUp,
  CheckCircle2,
  Lock,
  Pencil,
  Save,
  RefreshCw,
  FileSpreadsheet,
} from "lucide-react";
import type { Revenue, Business, FeeRates, TxCounts, AccountCurrency } from "@/lib/types";
import {
  DEFAULT_FEE_RATES,
  EMPTY_TX_COUNTS,
  authCount,
  computeTotalFees,
} from "@/lib/types";
import { formatAmount } from "@/lib/format";
import { convertAmount, getFxRate, hasMonthlyOverride } from "@/lib/fx";
import { ArrowRightLeft } from "lucide-react";

// Devise d'affichage : EUR, car EMP reverse en EUR sur le compte bancaire.
// Les montants stockés sont convertis vers EUR via les taux mensuels.
const DISPLAY_CURRENCY: AccountCurrency = "EUR";

export default function RevenuesPage() {
  const {
    businesses,
    selectedMonth,
    selectedBusinessId,
    addRevenue,
    updateRevenue,
    removeRevenue,
  } = useStore();
  const revenues = useRevenuesForCurrentMonth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const active = revenues.find((r) => r.id === activeId) ?? revenues[0] ?? null;

  // Totals (across visible revenues), tous en EUR.
  //
  // Net par revenu :
  //   - Si payoutAmountEur > 0 → on prend cette valeur (montant effectif viré
  //     par le processeur, intègre déjà le markup FX du processeur).
  //   - Sinon → fallback FX statique : capturedAmount - fees - reserve
  //     - refundAmount - chargebackAmount, convertis en EUR via taux du mois.
  //
  // Capturé / Frais / Reserve sont toujours FX-convertis (on n'a pas la
  // décomposition en EUR via le statement, juste le total).
  const totals = useMemo(() => {
    return revenues.reduce(
      (acc, r) => {
        const liveFees = computeTotalFees(
          r.txCounts,
          r.feeRates,
          r.capturedAmount,
        );
        const withheldLocal =
          (r.capturedAmount * r.rollingReservePercent) / 100;
        const releasedLocal = r.txCounts.releasedReserveAmount ?? 0;
        // Net reserve impact = retenue (cash out) − libération (cash in).
        const netReserveLocal = withheldLocal - releasedLocal;
        const refundAmt = r.txCounts.refundAmount ?? 0;
        const chargebackAmt = r.txCounts.chargebackAmount ?? 0;
        const payoutEur = r.txCounts.payoutAmountEur ?? 0;

        acc.captured += convertAmount(
          r.capturedAmount,
          r.currency,
          DISPLAY_CURRENCY,
          selectedMonth,
        );
        acc.fees += convertAmount(
          liveFees,
          r.currency,
          DISPLAY_CURRENCY,
          selectedMonth,
        );
        acc.reserve += convertAmount(
          netReserveLocal,
          r.currency,
          DISPLAY_CURRENCY,
          selectedMonth,
        );
        acc.debits += convertAmount(
          refundAmt + chargebackAmt,
          r.currency,
          DISPLAY_CURRENCY,
          selectedMonth,
        );
        // Net par revenu (en EUR) : prend payoutEur si renseigné.
        if (payoutEur > 0) {
          acc.net += payoutEur;
        } else {
          const netLocal =
            r.capturedAmount -
            liveFees -
            netReserveLocal -
            refundAmt -
            chargebackAmt;
          acc.net += convertAmount(
            netLocal,
            r.currency,
            DISPLAY_CURRENCY,
            selectedMonth,
          );
        }
        return acc;
      },
      { captured: 0, fees: 0, reserve: 0, debits: 0, net: 0 },
    );
  }, [revenues, selectedMonth]);

  const net = totals.net;
  const displayCurrency = DISPLAY_CURRENCY;

  return (
    <>
      <PageHeader
        title="Revenus"
        subtitle={`Revenus par business pour ${formatMonthLabel(selectedMonth)}. Cadence EMP : virements hebdomadaires, 10 % retenu en rolling reserve, libéré 6 mois plus tard.`}
        actions={
          <>
            <BusinessSelector />
            <button onClick={() => setCreating(true)} className="btn btn-primary">
              <Plus size={14} /> Nouveau revenu
            </button>
          </>
        }
      />

      <div className="p-8 space-y-6">
        {/* Bandeau FX : indique les taux du mois utilisés pour la conversion en EUR. */}
        <FxBanner month={selectedMonth} />

        {/* Totals */}
        <section className="grid grid-cols-4 gap-4">
          <TotalTile
            label={selectedBusinessId === "all" ? "Capturé (total)" : `Capturé`}
            value={totals.captured}
            currency={displayCurrency}
            icon={Banknote}
          />
          <TotalTile
            label="Frais processeur"
            value={totals.fees}
            currency={displayCurrency}
            icon={Percent}
            tone="warn"
          />
          <TotalTile
            label="Rolling reserve (net)"
            value={totals.reserve}
            currency={displayCurrency}
            icon={Clock}
            tone="info"
          />
          <TotalTile
            label="Net encaissé"
            value={net}
            currency={displayCurrency}
            icon={TrendingUp}
            tone="ok"
          />
        </section>

        {creating && (
          <NewRevenueForm
            businesses={businesses}
            defaultBusinessId={
              selectedBusinessId === "all" ? businesses[0]?.id : selectedBusinessId
            }
            month={selectedMonth}
            onCancel={() => setCreating(false)}
            onCreate={(r) => {
              addRevenue(r);
              setActiveId(r.id);
              setCreating(false);
            }}
          />
        )}

        {revenues.length === 0 && !creating ? (
          <div className="card p-12 text-center">
            <Banknote size={28} className="text-muted mx-auto mb-3" />
            <div className="text-[15px] font-medium">
              Aucun revenu pour {formatMonthLabel(selectedMonth)}
            </div>
            <div className="text-[12px] text-muted mt-1">
              Crée une entrée pour Link ou Ify.
            </div>
            <button onClick={() => setCreating(true)} className="btn btn-primary mt-4">
              <Plus size={14} /> Nouveau revenu
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-[340px_1fr] gap-4">
            {/* List grouped by business */}
            <div className="space-y-5">
              <GroupedRevenueList
                revenues={revenues}
                businesses={businesses}
                activeId={active?.id ?? null}
                onSelect={setActiveId}
                month={selectedMonth}
                onAddForBusiness={(businessId) => {
                  setCreating(true);
                  // Pre-fill the business in the form via a state hint — handled by selectedBusinessId
                  // (the form already uses selectedBusinessId as default)
                  // For multi-business "Tout" mode we just open the form.
                  // The user can still pick the right business in the form.
                  void businessId;
                }}
                showAddPerBusiness={selectedBusinessId === "all"}
              />
            </div>

            {/* Detail */}
            {active && (
              <RevenueDetail
                key={active.id}
                revenue={active}
                onUpdate={(patch) => updateRevenue(active.id, patch)}
                onDelete={() => {
                  removeRevenue(active.id);
                  setActiveId(null);
                }}
              />
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** Bandeau qui rappelle les taux FX utilisés pour la conversion vers EUR.
 *  Aide l'utilisateur à comprendre comment les chiffres affichés ont été
 *  obtenus, et à repérer s'il faut éditer les taux pour ce mois. */
function FxBanner({ month }: { month: string }) {
  const usdToEur = getFxRate(month, "USD", "EUR");
  const chfToEur = getFxRate(month, "CHF", "EUR");
  const exact = hasMonthlyOverride(month);
  return (
    <div className="card px-5 py-3 flex items-center gap-4 flex-wrap text-[12px]">
      <div className="flex items-center gap-2 text-text">
        <ArrowRightLeft size={14} className="text-accent" />
        <span className="font-medium">
          Devise d&apos;affichage : EUR — taux moyens du mois
        </span>
      </div>
      <div className="flex items-center gap-4 text-muted">
        <span>
          1 USD ={" "}
          <span className="font-mono text-text">{usdToEur.toFixed(4)} EUR</span>
        </span>
        <span>
          1 CHF ={" "}
          <span className="font-mono text-text">{chfToEur.toFixed(4)} EUR</span>
        </span>
        <span>
          1 EUR = <span className="font-mono text-text">1.0000 EUR</span>
        </span>
      </div>
      <div className="text-[11px] text-muted ml-auto">
        {exact
          ? "Taux exacts du mois"
          : "Approximations stables (à brancher sur un feed FX réel)"}
      </div>
    </div>
  );
}

function TotalTile({
  label,
  value,
  currency,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: number;
  currency: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone?: "neutral" | "ok" | "warn" | "info";
}) {
  const toneClass =
    tone === "ok"
      ? "text-ok"
      : tone === "warn"
        ? "text-warn"
        : tone === "info"
          ? "text-accent"
          : "text-text";
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[12px] text-muted">{label}</div>
        <Icon size={16} className="text-muted" />
      </div>
      <div className={`text-[22px] font-semibold leading-none ${toneClass} tabular-nums`}>
        {formatAmount(value, currency)}
      </div>
    </div>
  );
}

function GroupedRevenueList({
  revenues,
  businesses,
  activeId,
  onSelect,
  showAddPerBusiness,
  month,
}: {
  revenues: Revenue[];
  businesses: Business[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onAddForBusiness: (businessId: string) => void;
  showAddPerBusiness: boolean;
  /** Mois sélectionné — utilisé pour les taux FX de conversion en EUR. */
  month: string;
}) {
  const { setSelectedBusinessId } = useStore();
  // Group by businessId, only show businesses that have at least one revenue.
  const groups = businesses
    .map((b) => ({ business: b, items: revenues.filter((r) => r.businessId === b.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <>
      {groups.map(({ business, items }) => {
        // Sous-totaux convertis dans la devise d'affichage (EUR), en
        // itérant chaque revenu pour respecter sa propre devise source.
        const totalCapturedEur = items.reduce(
          (s, r) =>
            s + convertAmount(r.capturedAmount, r.currency, DISPLAY_CURRENCY, month),
          0,
        );
        const totalNetEur = items.reduce((s, r) => {
          // Si payoutAmountEur est fourni → source de vérité directe.
          const payoutEur = r.txCounts.payoutAmountEur ?? 0;
          if (payoutEur > 0) return s + payoutEur;
          const fees = computeTotalFees(r.txCounts, r.feeRates, r.capturedAmount);
          const withheld = (r.capturedAmount * r.rollingReservePercent) / 100;
          const released = r.txCounts.releasedReserveAmount ?? 0;
          const refundAmt = r.txCounts.refundAmount ?? 0;
          const chargebackAmt = r.txCounts.chargebackAmount ?? 0;
          const netLocal =
            r.capturedAmount -
            fees -
            (withheld - released) -
            refundAmt -
            chargebackAmt;
          return s + convertAmount(netLocal, r.currency, DISPLAY_CURRENCY, month);
        }, 0);
        return (
          <div key={business.id}>
            <div className="flex items-center gap-2 px-1 mb-2">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ background: business.color }}
              />
              <div className="text-[13px] font-semibold">{business.name}</div>
              <span className="badge">{items.length} proc.</span>
              <div className="ml-auto text-right">
                <div className="text-[11px] text-muted">Sous-total net</div>
                <div className="text-[13px] font-medium tabular-nums">
                  {formatAmount(totalNetEur, DISPLAY_CURRENCY)}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              {items.map((r) => (
                <RevenueListItem
                  key={r.id}
                  revenue={r}
                  active={activeId === r.id}
                  onClick={() => onSelect(r.id)}
                  month={month}
                />
              ))}
            </div>
            {showAddPerBusiness && (
              <button
                onClick={() => {
                  setSelectedBusinessId(business.id);
                  // The "Nouveau revenu" button at top-right is the canonical way; here we just
                  // pre-select the business in the global filter so the form defaults correctly.
                }}
                className="mt-2 w-full text-[11px] text-muted hover:text-text border border-dashed border-border rounded-lg py-1.5 transition-colors flex items-center justify-center gap-1.5"
                title={`Filtrer sur ${business.name} pour ajouter un autre processeur`}
              >
                <Plus size={11} /> Ajouter un processeur pour {business.name}
              </button>
            )}
            <div className="text-[10px] text-muted mt-1 px-1 tabular-nums">
              Capturé {formatAmount(totalCapturedEur, DISPLAY_CURRENCY)}
            </div>
          </div>
        );
      })}
    </>
  );
}

function RevenueListItem({
  revenue,
  active,
  onClick,
  month,
}: {
  revenue: Revenue;
  active: boolean;
  onClick: () => void;
  /** Mois sélectionné — utilisé pour les taux FX. */
  month: string;
}) {
  const withheldAmount =
    (revenue.capturedAmount * revenue.rollingReservePercent) / 100;
  const releasedAmount = revenue.txCounts.releasedReserveAmount ?? 0;
  const computedFees = computeTotalFees(
    revenue.txCounts,
    revenue.feeRates,
    revenue.capturedAmount,
  );
  // Refund + chargeback : montants débités du gross (écart 5).
  const refundAmt = revenue.txCounts.refundAmount ?? 0;
  const chargebackAmt = revenue.txCounts.chargebackAmount ?? 0;
  const netLocal =
    revenue.capturedAmount -
    computedFees -
    (withheldAmount - releasedAmount) -
    refundAmt -
    chargebackAmt;
  // Net en EUR : payoutAmountEur si renseigné (écart 3, FX EMP effectif),
  // sinon fallback FX statique.
  const payoutEur = revenue.txCounts.payoutAmountEur ?? 0;
  const netEur =
    payoutEur > 0
      ? payoutEur
      : convertAmount(netLocal, revenue.currency, DISPLAY_CURRENCY, month);
  const capturedEur = convertAmount(
    revenue.capturedAmount,
    revenue.currency,
    DISPLAY_CURRENCY,
    month,
  );
  const validated = !!revenue.validatedAt;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left card p-3 transition-colors relative ${
        active ? "!border-accent2 bg-panel2" : "hover:bg-panel2"
      } ${validated ? "!border-l-2 !border-l-ok" : ""}`}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className="text-[13px] font-medium">{revenue.processor}</div>
        {validated ? (
          <span
            className="badge ok ml-auto"
            title={`Enregistré le ${new Date(revenue.validatedAt!).toLocaleDateString("fr-CH")}`}
          >
            <CheckCircle2 size={10} /> Enregistré
          </span>
        ) : (
          <span className="badge warn ml-auto">Brouillon</span>
        )}
      </div>
      <div className="text-[16px] font-semibold leading-none tabular-nums">
        {formatAmount(netEur, DISPLAY_CURRENCY)}
      </div>
      <div className="text-[11px] text-muted mt-1.5 flex items-center gap-2">
        <span>{formatAmount(capturedEur, DISPLAY_CURRENCY)} capturé</span>
        <ChevronRight size={10} />
        <span>{formatAmount(netEur, DISPLAY_CURRENCY)} net</span>
      </div>
      {revenue.currency !== DISPLAY_CURRENCY && (
        <div className="text-[10px] text-muted mt-1 tabular-nums">
          source : {formatAmount(revenue.capturedAmount, revenue.currency)} →{" "}
          {formatAmount(capturedEur, DISPLAY_CURRENCY)}
        </div>
      )}
    </button>
  );
}

function RevenueDetail({
  revenue,
  onUpdate,
  onDelete,
}: {
  revenue: Revenue;
  onUpdate: (patch: Partial<Revenue>) => void;
  onDelete: () => void;
}) {
  const { businesses } = useStore();
  const biz = businesses.find((b) => b.id === revenue.businessId);
  const fileRef = useRef<HTMLInputElement>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  // Note : les anciens boutons "Importer PDF EMP" et "Importer depuis
  // Excel banque" ont été retirés — le seul fichier que l'utilisateur
  // fournit est le fichier transactions (statut/pays/montant). Tout ce
  // qu'on peut auto-remplir vient de là (counts + amounts par bucket).
  // Le reste (Interchange, Scheme, Released, Payout EUR) est saisi à la
  // main, optionnel.

  const locked = !!revenue.validatedAt;
  const withheldAmount =
    (revenue.capturedAmount * revenue.rollingReservePercent) / 100;
  const releasedAmount = revenue.txCounts.releasedReserveAmount ?? 0;
  // Net reserve impact pour ce period = retenue − libération.
  const netReserveImpact = withheldAmount - releasedAmount;
  // Frais calculés en live à partir des compteurs + tarifs + capturé.
  // Le champ revenue.fees stocké peut être obsolète tant que rien n'a
  // été ré-édité ; on l'ignore pour l'affichage.
  const computedFees = computeTotalFees(
    revenue.txCounts,
    revenue.feeRates,
    revenue.capturedAmount,
  );
  const refundAmt = revenue.txCounts.refundAmount ?? 0;
  const chargebackAmt = revenue.txCounts.chargebackAmount ?? 0;
  const net =
    revenue.capturedAmount -
    computedFees -
    netReserveImpact -
    refundAmt -
    chargebackAmt;
  const feesPct =
    revenue.capturedAmount > 0
      ? (computedFees / revenue.capturedAmount) * 100
      : 0;

  // Validation checklist — gives feedback to the user before they save.
  const missing: string[] = [];
  if (revenue.capturedAmount <= 0) missing.push("Montant capturé");
  if (revenue.fees <= 0) missing.push("Frais processeur");
  if (revenue.rollingReservePercent <= 0 && revenue.rollingReserveMonths <= 0)
    missing.push("Rolling reserve (ou 0 % explicite)");
  if (revenue.countryBreakdown.length === 0) missing.push("Fichier pays / revenus");
  const ready = missing.length === 0;

  const onCountryFile = async (f: File) => {
    const {
      rows,
      txCounts: parsedCounts,
      totalCaptured,
      totalsByBucket,
      warnings: w,
    } = await parseCountryFile(f);
    setWarnings(w);
    // On préserve `wires` (config user, pas dans le fichier).
    // On préserve aussi interchangeAmount / schemeAmount / releasedReserveAmount
    // / payoutAmountEur qui ne sont jamais dans le fichier (saisis à la main).
    const mergedCounts: TxCounts = {
      ...parsedCounts,
      wires: revenue.txCounts.wires || 4,
      // Auto-remplis depuis le fichier : montants refund/chargeback dérivés
      // des lignes ayant ce statut.
      refundAmount: totalsByBucket.refundAmount,
      chargebackAmount: totalsByBucket.chargebackAmount,
      // Préservation des champs qui ne sont pas dans le fichier.
      interchangeAmount: revenue.txCounts.interchangeAmount ?? 0,
      schemeAmount: revenue.txCounts.schemeAmount ?? 0,
      releasedReserveAmount: revenue.txCounts.releasedReserveAmount ?? 0,
      payoutAmountEur: revenue.txCounts.payoutAmountEur ?? 0,
    };
    const patch: Partial<Revenue> = {
      countryBreakdown: rows,
      countryFileName: f.name,
      txCounts: mergedCounts,
    };
    const captured =
      revenue.capturedAmount > 0 ? revenue.capturedAmount : totalCaptured;
    if (revenue.capturedAmount <= 0 && totalCaptured > 0) {
      patch.capturedAmount = totalCaptured;
    }
    patch.fees = computeTotalFees(mergedCounts, revenue.feeRates, captured);
    onUpdate(patch);
  };

  const onSave = () => onUpdate({ validatedAt: new Date().toISOString() });
  const onUnlock = () => onUpdate({ validatedAt: null });

  return (
    <div className={`card overflow-hidden ${locked ? "!border-ok/30" : ""}`}>
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <BusinessDot businessId={revenue.businessId} />
        <div className="text-[15px] font-semibold">{biz?.name}</div>
        <span className="text-[12px] text-muted">· {revenue.processor}</span>
        {locked && (
          <span className="badge ok flex items-center gap-1">
            <Lock size={10} />
            Enregistré le {new Date(revenue.validatedAt!).toLocaleDateString("fr-CH")}
          </span>
        )}
        <button
          onClick={onDelete}
          className="btn !px-2 text-[11px] ml-auto"
          title="Supprimer"
          disabled={locked}
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-6 p-5">
        <Field label="Business">
          <select
            className="input"
            value={revenue.businessId}
            onChange={(e) => onUpdate({ businessId: e.target.value })}
            disabled={locked}
          >
            {businesses.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Processeur de paiement">
          <input
            className="input"
            value={revenue.processor}
            onChange={(e) => onUpdate({ processor: e.target.value })}
            disabled={locked}
          />
        </Field>

        <Field label="Montant capturé" hint="Total brut traité par le processeur">
          <AmountInput
            value={revenue.capturedAmount}
            currency={revenue.currency}
            onChange={(v) => {
              // Recalcule les frais (IC++ % et total) en fonction du nouveau capturé.
              const newFees = computeTotalFees(
                revenue.txCounts,
                revenue.feeRates,
                v,
              );
              onUpdate({ capturedAmount: v, fees: newFees });
            }}
            disabled={locked}
          />
        </Field>

        <Field
          label="Frais processeur (auto)"
          hint={
            revenue.capturedAmount > 0
              ? `${feesPct.toFixed(2)} % du capturé · édite le détail ci-dessous`
              : "Calculé depuis le détail des frais ci-dessous"
          }
        >
          {/* Read-only : la valeur vient du détail ci-dessous. Pour ajuster, modifier les tarifs. */}
          <AmountInput
            value={computeTotalFees(
              revenue.txCounts,
              revenue.feeRates,
              revenue.capturedAmount,
            )}
            currency={revenue.currency}
            onChange={() => {}}
            disabled
          />
        </Field>

        <Field
          label="Rolling reserve (% du CA)"
          hint={
            revenue.capturedAmount > 0
              ? `≈ ${formatAmount(withheldAmount, revenue.currency)} retenu sur ${formatAmount(revenue.capturedAmount, revenue.currency)}`
              : "Sera calculé une fois le capturé renseigné"
          }
        >
          <PercentInput
            value={revenue.rollingReservePercent}
            onChange={(v) => onUpdate({ rollingReservePercent: v })}
            disabled={locked}
          />
        </Field>

        <Field label="Durée de la rolling reserve">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={36}
              className="input !w-24"
              value={revenue.rollingReserveMonths}
              onChange={(e) =>
                onUpdate({ rollingReserveMonths: parseInt(e.target.value, 10) || 0 })
              }
              disabled={locked}
            />
            <span className="text-[12px] text-muted">mois</span>
          </div>
        </Field>

        {/* Détails issus du billing statement EMP : montants débits + frais
            pass-through + payout EUR effectif (intègre le markup FX). */}
        <Field
          label="Refunds — montant"
          hint="Total des remboursements de la période (déduit du Net)"
        >
          <AmountInput
            value={refundAmt}
            currency={revenue.currency}
            onChange={(v) =>
              onUpdate({
                txCounts: { ...revenue.txCounts, refundAmount: v },
              })
            }
            disabled={locked}
          />
        </Field>
        <Field
          label="Chargebacks — montant"
          hint="Total des chargebacks de la période (déduit du Net)"
        >
          <AmountInput
            value={chargebackAmt}
            currency={revenue.currency}
            onChange={(v) =>
              onUpdate({
                txCounts: { ...revenue.txCounts, chargebackAmount: v },
              })
            }
            disabled={locked}
          />
        </Field>
        <Field
          label="Interchange Fees (pass-through)"
          hint="Ligne « Interchange Fees » du statement EMP. Frais payés aux banques émettrices, ~1,5% du gross, variable selon les cartes."
        >
          <AmountInput
            value={revenue.txCounts.interchangeAmount ?? 0}
            currency={revenue.currency}
            onChange={(v) =>
              onUpdate({
                txCounts: { ...revenue.txCounts, interchangeAmount: v },
              })
            }
            disabled={locked}
          />
        </Field>
        <Field
          label="Scheme Fees (pass-through)"
          hint="Ligne « Scheme Fees » du statement EMP. Frais payés à Visa/MC, ~1,5% du gross, variable selon les volumes."
        >
          <AmountInput
            value={revenue.txCounts.schemeAmount ?? 0}
            currency={revenue.currency}
            onChange={(v) =>
              onUpdate({
                txCounts: { ...revenue.txCounts, schemeAmount: v },
              })
            }
            disabled={locked}
          />
        </Field>
        <Field
          label="Rolling reserve libérée"
          hint="Ligne « Released Rolling Reserve » du statement — montant qui revient sur ton compte d'une période d'il y a ~6 mois (10% retenu il y a 26 semaines)."
        >
          <AmountInput
            value={revenue.txCounts.releasedReserveAmount ?? 0}
            currency={revenue.currency}
            onChange={(v) =>
              onUpdate({
                txCounts: { ...revenue.txCounts, releasedReserveAmount: v },
              })
            }
            disabled={locked}
          />
        </Field>
        <Field
          label="Payment Amount (EUR)"
          hint="Montant exact viré par le processeur sur ton compte bancaire. Si renseigné, écrase le calcul FX statique pour le Net en EUR (intègre le markup FX d'EMP)."
        >
          <AmountInput
            value={revenue.txCounts.payoutAmountEur ?? 0}
            currency="EUR"
            onChange={(v) =>
              onUpdate({
                txCounts: { ...revenue.txCounts, payoutAmountEur: v },
              })
            }
            disabled={locked}
          />
        </Field>
      </div>

      <div className="px-5 pb-5">
        <div className="card bg-panel2/50 p-4 flex items-center gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted">Net encaissé</div>
            <div className="text-[20px] font-semibold tabular-nums text-ok">
              {formatAmount(net, revenue.currency)}
            </div>
          </div>
          <div className="text-[11px] text-muted flex-1">
            = capturé{" "}
            <span className="font-mono">{formatAmount(revenue.capturedAmount, revenue.currency)}</span>{" "}
            − frais{" "}
            <span className="font-mono">{formatAmount(computedFees, revenue.currency)}</span> − reserve retenue{" "}
            <span className="font-mono">
              {formatAmount(withheldAmount, revenue.currency)}
            </span>{" "}
            <span className="text-muted">({revenue.rollingReservePercent}%)</span>
            {releasedAmount > 0 && (
              <>
                {" "}
                + reserve libérée{" "}
                <span className="font-mono text-ok">
                  {formatAmount(releasedAmount, revenue.currency)}
                </span>
              </>
            )}
            {(refundAmt > 0 || chargebackAmt > 0) && (
              <>
                {" "}
                − refunds{" "}
                <span className="font-mono">{formatAmount(refundAmt, revenue.currency)}</span>{" "}
                − chargebacks{" "}
                <span className="font-mono">{formatAmount(chargebackAmt, revenue.currency)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Transactions + frais détaillés */}
      <FeeBreakdownSection
        revenue={revenue}
        onUpdate={onUpdate}
        locked={locked}
      />

      {/* Country breakdown */}
      <div className="border-t border-border">
        <div className="px-5 py-4 flex items-center gap-3">
          <Globe size={14} className="text-muted" />
          <div className="text-[13px] font-medium">Répartition par pays</div>
          <span className="text-[11px] text-muted">
            {revenue.countryBreakdown.length} pays
            {revenue.countryFileName && ` · ${revenue.countryFileName}`}
          </span>
          <button
            onClick={() => fileRef.current?.click()}
            className="btn text-[11px] ml-auto"
            disabled={locked}
          >
            <Upload size={11} /> {revenue.countryBreakdown.length === 0 ? "Charger" : "Remplacer"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onCountryFile(f);
            }}
          />
        </div>

        {warnings.length > 0 && (
          <div className="px-5 pb-3">
            <div className="card bg-warn/5 border-warn/30 p-3 text-[11px] text-warn">
              {warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          </div>
        )}

        {revenue.countryBreakdown.length === 0 ? (
          <div className="px-5 pb-5">
            <div
              className={`card border-dashed p-8 text-center transition-colors ${
                locked ? "opacity-50" : "cursor-pointer hover:bg-panel2"
              }`}
              onClick={() => !locked && fileRef.current?.click()}
            >
              <Upload size={20} className="text-accent mx-auto mb-2" />
              <div className="text-[13px] font-medium">
                Charge le fichier des revenus par pays
              </div>
              <div className="text-[11px] text-muted mt-1">
                .xlsx / .xls / .csv — colonne 1 : pays, colonne 2 : revenu
              </div>
            </div>
          </div>
        ) : (
          <CountryTable revenue={revenue} />
        )}
      </div>

      {/* Save bar */}
      <div className="border-t border-border px-5 py-4 bg-panel2/30 flex items-center gap-4">
        {locked ? (
          <>
            <CheckCircle2 size={16} className="text-ok shrink-0" />
            <div className="text-[12px] flex-1">
              <div className="font-medium text-ok">Revenu enregistré</div>
              <div className="text-muted text-[11px]">
                {new Date(revenue.validatedAt!).toLocaleString("fr-CH", {
                  dateStyle: "long",
                  timeStyle: "short",
                })}
                . Les champs sont verrouillés. Clique sur « Modifier » pour rouvrir.
              </div>
            </div>
            <button onClick={onUnlock} className="btn">
              <Pencil size={12} /> Modifier
            </button>
          </>
        ) : (
          <>
            {ready ? (
              <CheckCircle2 size={16} className="text-ok shrink-0" />
            ) : (
              <span className="w-4 h-4 rounded-full border-2 border-warn shrink-0" />
            )}
            <div className="text-[12px] flex-1 min-w-0">
              <div className="font-medium">
                {ready ? "Prêt à enregistrer" : "Complète les champs avant d'enregistrer"}
              </div>
              {!ready && (
                <div className="text-muted text-[11px] truncate">
                  Manquant : {missing.join(", ")}
                </div>
              )}
              {ready && (
                <div className="text-muted text-[11px]">
                  Net du mois : {formatAmount(net, revenue.currency)} ·{" "}
                  {revenue.countryBreakdown.length} pays
                </div>
              )}
            </div>
            <button
              onClick={onSave}
              disabled={!ready}
              className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save size={12} /> Enregistrer l'entrée
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// --- Détail transactions + tarifs éditables ---

type PerTxRow = {
  countKey: keyof TxCounts;
  rateKey: keyof FeeRates;
  label: string;
  unit: string; // "tx", "mois", "wire", "%"
};

const PER_TX_ROWS: PerTxRow[] = [
  { countKey: "captured", rateKey: "captureFee", label: "Capture", unit: "tx" },
  { countKey: "declined", rateKey: "declinedFee", label: "Declined", unit: "tx" },
  { countKey: "refund", rateKey: "refundFee", label: "Refund", unit: "tx" },
  { countKey: "chargeback", rateKey: "chargebackFee", label: "Chargeback", unit: "tx" },
  { countKey: "retrievalRequest", rateKey: "retrievalFee", label: "Retrieval request", unit: "tx" },
  { countKey: "preArbitration", rateKey: "preArbitrationFee", label: "Pre-arbitration", unit: "tx" },
];

function FeeBreakdownSection({
  revenue,
  onUpdate,
  locked,
}: {
  revenue: Revenue;
  onUpdate: (patch: Partial<Revenue>) => void;
  locked: boolean;
}) {
  const counts = revenue.txCounts;
  const rates = revenue.feeRates;
  const captured = revenue.capturedAmount;
  const total = computeTotalFees(counts, rates, captured);
  // Devise affichée dans les tarifs (unitSuffix) — la même que le revenu,
  // sinon on affichait "€/tx" pour un revenu en CHF (confus).
  const currCode = revenue.currency || "USD";

  const setRate = (key: keyof FeeRates, value: number) => {
    const newRates: FeeRates = { ...rates, [key]: value };
    onUpdate({
      feeRates: newRates,
      fees: computeTotalFees(counts, newRates, captured),
    });
  };

  const setCount = (key: keyof TxCounts, value: number) => {
    const newCounts: TxCounts = { ...counts, [key]: value };
    onUpdate({
      txCounts: newCounts,
      fees: computeTotalFees(newCounts, rates, captured),
    });
  };

  const resetRatesToDefaults = () => {
    if (
      !confirm(
        "Remplacer les tarifs actuels par les tarifs par défaut (alignés EMP statement réel : auth 0, capture 0.27, declined 0.16, refund 0.55…) ?",
      )
    )
      return;
    onUpdate({
      feeRates: { ...DEFAULT_FEE_RATES },
      fees: computeTotalFees(counts, DEFAULT_FEE_RATES, captured),
    });
  };

  const percentFee = (captured * rates.percentRate) / 100;
  const interchangeAmt = counts.interchangeAmount ?? 0;
  const schemeAmt = counts.schemeAmount ?? 0;
  const releasedAmt = counts.releasedReserveAmount ?? 0;

  return (
    <div className="border-t border-border">
      <div className="px-5 py-4 flex items-center gap-3 flex-wrap">
        <Percent size={14} className="text-muted" />
        <div className="text-[13px] font-medium">Détail des frais processeur</div>
        <span className="text-[11px] text-muted">
          Tu modifies les tarifs ; les compteurs viennent du fichier.
        </span>
        {!locked && (
          <button
            onClick={resetRatesToDefaults}
            className="btn text-[11px] !px-2 !py-1"
            title="Remplace les tarifs par les valeurs par défaut actuelles (auth=0, capture=0.27, etc.)"
          >
            <RefreshCw size={11} /> Reset tarifs
          </button>
        )}
        <span className="ml-auto text-[12px] font-semibold tabular-nums">
          Total : {formatAmount(total, revenue.currency)}
        </span>
      </div>
      <div className="px-5 pb-5">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted">
              <th className="text-left py-2">Type</th>
              <th className="text-right py-2 w-32">Tarif</th>
              <th className="text-right py-2 w-24">Quantité</th>
              <th className="text-right py-2 w-36">Frais</th>
            </tr>
          </thead>
          <tbody>
            {/* Auth : facturé sur CHAQUE soumission au réseau (captured + declined + authorized) */}
            <tr className="border-t border-border">
              <td className="py-2">
                Auth
                <span className="text-[10px] text-muted ml-2">
                  (= captured + declined + auth-only)
                </span>
              </td>
              <td className="py-2 text-right">
                <RateInput
                  value={rates.authFee}
                  unitSuffix={`${currCode}/tx`}
                  onChange={(v) => setRate("authFee", v)}
                  disabled={locked}
                />
              </td>
              <td className="py-2 text-right tabular-nums">
                {authCount(counts)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatAmount(
                  roundCents(authCount(counts) * rates.authFee),
                  revenue.currency,
                )}
              </td>
            </tr>

            {/* Authorized-only : pre-auths qui n'ont jamais été capturées (info, pas de frais distinct) */}
            <tr className="border-t border-border text-muted">
              <td className="py-2 pl-4">
                ↳ dont auth seulement (non capturé)
              </td>
              <td></td>
              <td className="py-2 text-right tabular-nums">
                {counts.authorized}
              </td>
              <td></td>
            </tr>

            {PER_TX_ROWS.map((row) => {
              const c = counts[row.countKey];
              const r = rates[row.rateKey];
              const fee = roundCents(c * r);
              return (
                <tr key={row.countKey} className="border-t border-border">
                  <td className="py-2">{row.label}</td>
                  <td className="py-2 text-right">
                    <RateInput
                      value={r}
                      unitSuffix={`${currCode}/${row.unit}`}
                      onChange={(v) => setRate(row.rateKey, v)}
                      disabled={locked}
                    />
                  </td>
                  <td className="py-2 text-right tabular-nums">{c}</td>
                  <td className="py-2 text-right tabular-nums">
                    {formatAmount(fee, revenue.currency)}
                  </td>
                </tr>
              );
            })}

            {/* IC++ % du capturé */}
            <tr className="border-t border-border">
              <td className="py-2">IC++ (% du capturé)</td>
              <td className="py-2 text-right">
                <RateInput
                  value={rates.percentRate}
                  unitSuffix="%"
                  onChange={(v) => setRate("percentRate", v)}
                  disabled={locked}
                />
              </td>
              <td className="py-2 text-right text-muted tabular-nums">
                {formatAmount(captured, revenue.currency)}
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatAmount(roundCents(percentFee), revenue.currency)}
              </td>
            </tr>

            {/* Interchange Fees : pass-through, montant exact du statement */}
            <tr className="border-t border-border">
              <td className="py-2">
                Interchange Fees
                <span className="text-[10px] text-muted ml-2">
                  (pass-through, copié du statement)
                </span>
              </td>
              <td className="py-2 text-right" colSpan={2}>
                <AmountInput
                  value={interchangeAmt}
                  currency={currCode}
                  onChange={(v) => setCount("interchangeAmount", v)}
                  disabled={locked}
                />
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatAmount(interchangeAmt, revenue.currency)}
              </td>
            </tr>

            {/* Scheme Fees : pass-through Visa/MC */}
            <tr className="border-t border-border">
              <td className="py-2">
                Scheme Fees
                <span className="text-[10px] text-muted ml-2">
                  (pass-through Visa/MC)
                </span>
              </td>
              <td className="py-2 text-right" colSpan={2}>
                <AmountInput
                  value={schemeAmt}
                  currency={currCode}
                  onChange={(v) => setCount("schemeAmount", v)}
                  disabled={locked}
                />
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatAmount(schemeAmt, revenue.currency)}
              </td>
            </tr>

            {/* Frais fixes */}
            <tr className="border-t border-border">
              <td className="py-2">Monthly service fee</td>
              <td className="py-2 text-right">
                <RateInput
                  value={rates.monthlyServiceFee}
                  unitSuffix={`${currCode}/mois`}
                  onChange={(v) => setRate("monthlyServiceFee", v)}
                  disabled={locked}
                />
              </td>
              <td className="py-2 text-right text-muted">1</td>
              <td className="py-2 text-right tabular-nums">
                {formatAmount(rates.monthlyServiceFee, revenue.currency)}
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="py-2">VBV/MC Secure Code</td>
              <td className="py-2 text-right">
                <RateInput
                  value={rates.monthlySecureCodeFee}
                  unitSuffix={`${currCode}/mois`}
                  onChange={(v) => setRate("monthlySecureCodeFee", v)}
                  disabled={locked}
                />
              </td>
              <td className="py-2 text-right text-muted">1</td>
              <td className="py-2 text-right tabular-nums">
                {formatAmount(rates.monthlySecureCodeFee, revenue.currency)}
              </td>
            </tr>
            <tr className="border-t border-border">
              <td className="py-2">Wire transfer</td>
              <td className="py-2 text-right">
                <RateInput
                  value={rates.wireTransferFee}
                  unitSuffix={`${currCode}/wire`}
                  onChange={(v) => setRate("wireTransferFee", v)}
                  disabled={locked}
                />
              </td>
              <td className="py-2 text-right">
                <input
                  type="number"
                  min={0}
                  step={1}
                  className="input !py-1 !px-2 text-right tabular-nums w-20"
                  value={counts.wires}
                  onChange={(e) => {
                    const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                    const newCounts = { ...counts, wires: v };
                    onUpdate({
                      txCounts: newCounts,
                      fees: computeTotalFees(
                        newCounts,
                        rates,
                        revenue.capturedAmount,
                      ),
                    });
                  }}
                  disabled={locked}
                />
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatAmount(
                  roundCents(counts.wires * rates.wireTransferFee),
                  revenue.currency,
                )}
              </td>
            </tr>

            {/* Reserve libérée d'une période d'il y a 6 mois — pas un frais
                à proprement parler, c'est un cash-in. Affiché en vert et
                non sommé dans le Total des frais ci-dessous. */}
            <tr className="border-t border-border">
              <td className="py-2">
                Rolling reserve libérée
                <span className="text-[10px] text-muted ml-2">
                  (cash-in d&apos;il y a ~6 mois, pas un frais)
                </span>
              </td>
              <td className="py-2 text-right" colSpan={2}>
                <AmountInput
                  value={releasedAmt}
                  currency={currCode}
                  onChange={(v) => setCount("releasedReserveAmount", v)}
                  disabled={locked}
                />
              </td>
              <td className="py-2 text-right tabular-nums text-ok">
                + {formatAmount(releasedAmt, revenue.currency)}
              </td>
            </tr>

            <tr className="border-t border-border font-medium">
              <td className="py-2" colSpan={3}>
                Total
              </td>
              <td className="py-2 text-right tabular-nums">
                {formatAmount(total, revenue.currency)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RateInput({
  value,
  unitSuffix,
  onChange,
  disabled,
}: {
  value: number;
  unitSuffix: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative inline-block w-32">
      <input
        type="number"
        step="0.01"
        min={0}
        className="input !py-1 !px-2 pr-14 tabular-nums text-right"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        disabled={disabled}
      />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted pointer-events-none">
        {unitSuffix}
      </span>
    </div>
  );
}

function roundCents(n: number) {
  return Math.round(n * 100) / 100;
}

function CountryTable({ revenue }: { revenue: Revenue }) {
  const total = revenue.countryBreakdown.reduce((s, c) => s + c.amount, 0);
  const sorted = [...revenue.countryBreakdown].sort((a, b) => b.amount - a.amount);
  const max = sorted[0]?.amount ?? 1;

  return (
    <div className="px-5 pb-5">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted">
            <th className="text-left py-2 w-16">Pays</th>
            <th className="text-left py-2">Part</th>
            <th className="text-right py-2 w-28">Montant</th>
            <th className="text-right py-2 w-16">%</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((c) => {
            const pct = total > 0 ? (c.amount / total) * 100 : 0;
            const w = total > 0 ? (c.amount / max) * 100 : 0;
            return (
              <tr key={c.country} className="border-t border-border">
                <td className="py-2 font-mono">{c.country}</td>
                <td className="py-2 pr-4">
                  <div className="h-1.5 bg-panel2 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-accent rounded-full"
                      style={{ width: `${w}%` }}
                    />
                  </div>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatAmount(c.amount, revenue.currency)}
                </td>
                <td className="py-2 text-right text-muted tabular-nums">{pct.toFixed(1)}%</td>
              </tr>
            );
          })}
          <tr className="border-t border-border font-medium">
            <td className="py-2">Total</td>
            <td></td>
            <td className="py-2 text-right tabular-nums">
              {formatAmount(total, revenue.currency)}
            </td>
            <td className="py-2 text-right text-muted">100%</td>
          </tr>
        </tbody>
      </table>
      <div className="text-[11px] text-muted mt-3">
        Total pays : {formatAmount(total, revenue.currency)} · Capturé processeur :{" "}
        {formatAmount(revenue.capturedAmount, revenue.currency)}
        {Math.abs(total - revenue.capturedAmount) > 0.01 && (
          <span className="badge warn ml-2">
            écart : {formatAmount(total - revenue.capturedAmount, revenue.currency)}
          </span>
        )}
      </div>
    </div>
  );
}

function NewRevenueForm({
  businesses,
  defaultBusinessId,
  month,
  onCancel,
  onCreate,
}: {
  businesses: Business[];
  defaultBusinessId?: string;
  month: string;
  onCancel: () => void;
  onCreate: (r: Revenue) => void;
}) {
  const [draft, setDraft] = useState<Omit<Revenue, "id">>({
    businessId: defaultBusinessId ?? businesses[0]?.id ?? "",
    month,
    processor: "EMP",
    // Tous nos revenus sont en USD — plus de sélecteur dans le formulaire.
    currency: "USD",
    capturedAmount: 0,
    fees: 0,
    rollingReservePercent: 0,
    rollingReserveMonths: 0,
    releasedAt: null,
    validatedAt: null,
    countryBreakdown: [],
    countryFileName: null,
    txCounts: { ...EMPTY_TX_COUNTS },
    feeRates: { ...DEFAULT_FEE_RATES },
  });

  const submit = () => {
    if (!draft.businessId) return;
    onCreate({ id: `rev-${Date.now()}`, ...draft });
  };

  return (
    <div className="card p-5 border-accent2/40 bg-accent/5">
      <div className="flex items-center gap-2 mb-1">
        <div className="text-[13px] font-medium">Nouveau revenu</div>
        <span className="badge info">Un par business × processeur</span>
      </div>
      <div className="text-[11px] text-muted mb-4">
        Capturé, frais et rolling reserve se renseignent après création (après l'upload du fichier
        pays).
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Business">
          <Select
            value={draft.businessId}
            onChange={(v) => setDraft({ ...draft, businessId: v })}
            options={businesses.map((b) => ({ value: b.id, label: b.name }))}
          />
        </Field>
        <Field label="Processeur">
          <Select
            value={draft.processor}
            onChange={(v) => setDraft({ ...draft, processor: v })}
            options={PROCESSOR_OPTIONS}
          />
        </Field>
        <Field label="Mois" hint="Devise toujours USD">
          <input className="input" value={draft.month} disabled />
        </Field>
      </div>

      <div className="flex items-center justify-end gap-2 mt-4">
        <button onClick={onCancel} className="btn">
          Annuler
        </button>
        <button onClick={submit} className="btn btn-primary">
          <Plus size={12} /> Créer
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[11px] text-muted block mb-1">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-muted mt-1">{hint}</div>}
    </div>
  );
}

function AmountInput({
  value,
  currency,
  onChange,
  disabled,
}: {
  value: number;
  currency: string;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        step="0.01"
        min={0}
        className="input pr-12 tabular-nums"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        disabled={disabled}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted pointer-events-none">
        {currency}
      </span>
    </div>
  );
}

function PercentInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <input
        type="number"
        step="0.01"
        min={0}
        max={100}
        className="input pr-8 tabular-nums"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        disabled={disabled}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-muted pointer-events-none">
        %
      </span>
    </div>
  );
}
