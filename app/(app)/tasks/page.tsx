"use client";

import { useEffect, useMemo, useState } from "react";
import { ListTodo, PlusCircle, Loader2, CheckCircle2 } from "lucide-react";
import { formatSignedAmount } from "@/lib/excel-row-display";

const TH = "px-3 py-2 text-left text-[10px] uppercase tracking-wider text-muted font-medium whitespace-nowrap";

type Assignee = "gauthier" | "robin" | "jacqueline" | "a_creer";
const ASSIGNEE_LABEL: Record<Assignee, string> = {
  gauthier: "Gauthier",
  robin: "Robin",
  jacqueline: "Maman",
  a_creer: "À créer",
};

type Enriched = {
  month: string;
  accountCurrency: string;
  rowNumber: number;
  assignee: Assignee;
  creditorKey: string | null;
  assignedBy: string | null;
  assignedAt: string;
  autoCascaded: boolean;
  description: string;
  label: string;
  amount: number | null;
  date: string;
  matchedCreditor: string | null;
};

type TasksPayload = {
  me: Assignee;
  mine: Enriched[];
  toCreate: Enriched[];
};

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
function formatMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return `${MONTHS_FR[m - 1]} ${y}`;
}

export default function TasksPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TasksPayload | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch("/api/tasks", { cache: "no-store" });
      if (r.status === 403) {
        setError("Tu n'as pas de tâches sur ce compte.");
        setData(null);
        return;
      }
      if (!r.ok) {
        setError(`Chargement impossible (HTTP ${r.status}).`);
        setData(null);
        return;
      }
      setData((await r.json()) as TasksPayload);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  if (loading) {
    return (
      <div className="px-8 py-10 text-muted text-[13px] flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" /> Chargement…
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-8 py-10 text-[13px] text-err">{error}</div>
    );
  }
  if (!data) return null;

  return (
    <div className="px-8 py-6 space-y-8 max-w-[1200px]">
      <TasksSection
        title={`Pour ${ASSIGNEE_LABEL[data.me]}`}
        subtitle="Lignes Excel qu'on t'a attribuées — ouvre la page Rapprochement Excel pour les traiter."
        icon={<ListTodo size={16} className="text-accent" />}
        items={data.mine}
        onUnassign={async (a) => {
          await fetch(`/api/row-assignments`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              month: a.month,
              currency: a.accountCurrency,
              row: a.rowNumber,
            }),
          });
          await reload();
        }}
      />
      <TasksSection
        title="À créer"
        subtitle="Factures à émettre — visibles pour tout le monde."
        icon={<PlusCircle size={16} className="text-sky-400" />}
        items={data.toCreate}
        onUnassign={async (a) => {
          await fetch(`/api/row-assignments`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              month: a.month,
              currency: a.accountCurrency,
              row: a.rowNumber,
            }),
          });
          await reload();
        }}
      />
    </div>
  );
}

function TasksSection({
  title,
  subtitle,
  icon,
  items,
  onUnassign,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  items: Enriched[];
  onUnassign: (a: Enriched) => Promise<void>;
}) {
  // Groupé par mois décroissant.
  const groups = useMemo(() => {
    const map = new Map<string, Enriched[]>();
    for (const it of items) {
      const arr = map.get(it.month) ?? [];
      arr.push(it);
      map.set(it.month, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [items]);

  return (
    <section className="card">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        {icon}
        <div className="text-[13px] font-medium">{title}</div>
        <span className="text-[11px] text-muted ml-2">
          {items.length} ligne{items.length > 1 ? "s" : ""}
        </span>
        <span className="text-[11px] text-muted ml-auto">{subtitle}</span>
      </div>
      {items.length === 0 ? (
        <div className="px-5 py-8 text-center text-muted text-[12px] italic">
          Aucune tâche pour l&apos;instant.
        </div>
      ) : (
        <div className="divide-y divide-border">
          {groups.map(([month, rows]) => (
            <div key={month}>
              <div className="px-5 py-2 bg-panel2/40 text-[11px] uppercase tracking-wider text-muted">
                {formatMonth(month)}
              </div>
              <table className="w-full text-[12px] border-collapse">
                <thead className="border-b border-border">
                  <tr>
                    <th className={`${TH} w-14`}>#</th>
                    <th className={`${TH} w-14`}>Compte</th>
                    <th className={`${TH} w-24`}>Date</th>
                    <th className={TH}>Description</th>
                    <th className={`${TH} text-right w-32`}>Montant</th>
                    <th className={TH}>Facture</th>
                    <th className={`${TH} w-24`}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={`${r.accountCurrency}-${r.rowNumber}`}
                      className={
                        "border-b border-border/40 " +
                        (r.matchedCreditor
                          ? "bg-[rgba(34,197,94,0.12)] hover:bg-[rgba(34,197,94,0.18)]"
                          : "hover:bg-panel2")
                      }
                    >
                      <td
                        className={
                          "px-3 py-1 text-muted tabular-nums border-l-2 " +
                          (r.matchedCreditor ? "border-l-ok" : "border-l-transparent")
                        }
                      >
                        {r.rowNumber}
                      </td>
                      <td className="px-3 py-1 text-muted font-mono">{r.accountCurrency}</td>
                      <td className="px-3 py-1 tabular-nums whitespace-nowrap">{r.date}</td>
                      <td className="px-3 py-1 max-w-[420px] truncate" title={r.description}>
                        {r.label}
                      </td>
                      <td
                        className={
                          "px-3 py-1 text-right tabular-nums whitespace-nowrap font-medium " +
                          (r.amount != null && r.amount > 0 ? "text-ok" : "")
                        }
                      >
                        {formatSignedAmount(r.amount)}
                      </td>
                      <td className="px-3 py-1 max-w-[220px] truncate">
                        {r.matchedCreditor ? (
                          <span className="inline-flex items-center gap-1.5 text-ok" title={r.matchedCreditor}>
                            <CheckCircle2 size={12} className="shrink-0" />
                            <span className="truncate">{r.matchedCreditor}</span>
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-1 text-right">
                        {r.autoCascaded && (
                          <span className="text-[10px] text-muted italic mr-2" title="Attribuée automatiquement d'après un fournisseur déjà classé.">
                            auto
                          </span>
                        )}
                        <button
                          onClick={() => void onUnassign(r)}
                          className="text-[11px] text-muted hover:text-err"
                          title="Retirer l'attribution"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
