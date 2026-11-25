"use client";

import { useEffect, useMemo, useState } from "react";
import { ListTodo, PlusCircle, Loader2, AlertTriangle, Search } from "lucide-react";
import { formatSignedAmount } from "@/lib/excel-row-display";

const TH = "px-4 py-2.5 text-left text-[10px] uppercase tracking-wider text-muted font-medium whitespace-nowrap";
const TD = "px-4 py-3";

type Assignee = "gauthier" | "robin" | "jacqueline" | "a_creer";
const ASSIGNEES: Assignee[] = ["gauthier", "robin", "jacqueline", "a_creer"];
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
  problem: boolean;
  description: string;
  label: string;
  amount: number | null;
  date: string;
  matchedCreditor: string | null;
};

type TasksPayload = {
  me: Assignee;
  mine: Enriched[];
  /** null : la section « À créer » n'est pas pour ce compte. */
  toCreate: Enriched[] | null;
};

const MONTHS_FR = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];
const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function formatMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return `${MONTHS_FR[m - 1]} ${y}`;
}

const rowRef = (a: Enriched) => ({
  month: a.month,
  currency: a.accountCurrency,
  row: a.rowNumber,
});

export default function TasksPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TasksPayload | null>(null);

  async function reload() {
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

  const [pending, setPending] = useState<{ row: Enriched; to: Assignee; count: number } | null>(null);
  const [query, setQuery] = useState("");

  async function act(a: Enriched, action: string, sameCreditor = false) {
    if (action === "problem" || action === "no-problem") {
      await fetch(`/api/row-assignments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rowRef(a), problem: action === "problem" }),
      });
    } else if (action.startsWith("to:")) {
      await fetch(`/api/row-assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...rowRef(a), assignee: action.slice(3), cascade: false, sameCreditor }),
      });
    }
    await reload();
  }

  if (loading) {
    return (
      <div className="px-8 py-10 text-muted text-[13px] flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" /> Chargement…
      </div>
    );
  }
  if (error) {
    return <div className="px-8 py-10 text-[13px] text-err">{error}</div>;
  }
  if (!data) return null;

  return (
    <div className="px-8 py-6 space-y-6 max-w-[1200px]">
      <div className="card !rounded-full px-4 py-2 flex items-center gap-2 max-w-md transition-shadow focus-within:!border-accent focus-within:ring-[3px] focus-within:ring-accent/15">
        <Search size={14} className="text-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une ligne (nom, montant, date…)"
          className="flex-1 min-w-0 bg-transparent !outline-none text-[13px] placeholder:text-muted"
          aria-label="Rechercher dans les tâches"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="text-[11px] text-muted hover:text-text px-1"
            title="Vider la recherche"
          >
            ✕
          </button>
        )}
      </div>
      <TasksSection
        title={`Pour ${ASSIGNEE_LABEL[data.me]}`}
        subtitle="Lignes du relevé à justifier. Dès qu'une facture est rapprochée, la ligne disparaît."
        icon={<ListTodo size={16} className="text-accent" />}
        items={data.mine}
        query={query}
        sendTo={ASSIGNEES.filter((x) => x !== data.me)}
        onAction={act}
        onAskSend={(row, to, count) => setPending({ row, to, count })}
      />
      {data.toCreate && (
      <TasksSection
        title="À créer"
        subtitle="Factures à créer."
        icon={<PlusCircle size={16} className="text-sky-400" />}
        items={data.toCreate}
        query={query}
        sendTo={ASSIGNEES.filter((x) => x !== "a_creer")}
        onAction={act}
        onAskSend={(row, to, count) => setPending({ row, to, count })}
      />
      )}
      {pending && (
        <SendDialog
          label={pending.row.label}
          to={ASSIGNEE_LABEL[pending.to]}
          count={pending.count}
          onCancel={() => setPending(null)}
          onChoose={async (all) => {
            const p = pending;
            setPending(null);
            await act(p.row, `to:${p.to}`, all);
          }}
        />
      )}
    </div>
  );
}

function SendDialog({
  label,
  to,
  count,
  onCancel,
  onChoose,
}: {
  label: string;
  to: string;
  count: number;
  onCancel: () => void;
  onChoose: (all: boolean) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="card w-full max-w-md p-5 space-y-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[14px] font-medium">Renvoyer à {to}</div>
        <div className="text-[13px] text-muted">
          Il y a {count} lignes « {label} ». On renvoie lesquelles ?
        </div>
        <div className="flex flex-col gap-2">
          <button className="btn btn-primary justify-center" onClick={() => onChoose(true)}>
            Toutes les lignes « {label} » ({count})
          </button>
          <button className="btn justify-center" onClick={() => onChoose(false)}>
            Seulement cette ligne
          </button>
          <button className="text-[12px] text-muted hover:text-text py-1" onClick={onCancel}>
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

function TasksSection({
  title,
  subtitle,
  icon,
  items,
  query,
  sendTo,
  onAction,
  onAskSend,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  items: Enriched[];
  query: string;
  sendTo: Assignee[];
  onAction: (a: Enriched, action: string) => Promise<void>;
  onAskSend: (a: Enriched, to: Assignee, count: number) => void;
}) {
  const sameName = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of items) {
      const k = it.label.trim().toLowerCase();
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [items]);

  // Le compte des lignes de même nom (fenêtre « Renvoyer à ») reste fait
  // sur toute la liste ; la recherche ne filtre que l'affichage.
  const visible = useMemo(() => {
    const q = norm(query.trim());
    if (!q) return items;
    return items.filter((it) =>
      norm(
        [
          it.label,
          it.description,
          it.date,
          it.accountCurrency,
          String(it.rowNumber),
          formatSignedAmount(it.amount),
          it.amount != null ? String(Math.abs(it.amount)) : "",
          formatMonth(it.month),
        ].join(" "),
      ).includes(q),
    );
  }, [items, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Enriched[]>();
    for (const it of visible) {
      const arr = map.get(it.month) ?? [];
      arr.push(it);
      map.set(it.month, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [visible]);

  return (
    <section className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        {icon}
        <div className="text-[13px] font-medium">{title}</div>
        <span className="text-[11px] text-muted ml-2">
          {query.trim()
            ? `${visible.length} / ${items.length} ligne${items.length > 1 ? "s" : ""}`
            : `${items.length} ligne${items.length > 1 ? "s" : ""}`}
        </span>
        <span className="text-[11px] text-muted ml-auto">{subtitle}</span>
      </div>
      {visible.length === 0 ? (
        <div className="px-5 py-8 text-center text-muted text-[12px] italic">
          {items.length === 0
            ? "Aucune tâche pour l’instant."
            : `Aucune ligne ne correspond à « ${query.trim()} ».`}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {groups.map(([month, rows]) => (
            <div key={month}>
              <div className="px-5 py-2 bg-panel2/40 text-[11px] uppercase tracking-wider text-muted">
                {formatMonth(month)}
              </div>
              <table className="w-full text-[13px] border-collapse">
                <thead className="border-b border-border">
                  <tr>
                    <th className={`${TH} w-16`}>#</th>
                    <th className={`${TH} w-20`}>Compte</th>
                    <th className={`${TH} w-28`}>Date</th>
                    <th className={TH}>Description</th>
                    <th className={`${TH} text-right w-36`}>Montant</th>
                    <th className={`${TH} w-[190px]`}></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={`${r.accountCurrency}-${r.rowNumber}`}
                      className={
                        "border-b border-border/40 last:border-b-0 " +
                        (r.problem ? "bg-err/5 hover:bg-err/10" : "hover:bg-panel2")
                      }
                    >
                      <td
                        className={
                          `${TD} text-muted tabular-nums border-l-2 ` +
                          (r.problem ? "border-l-err" : "border-l-transparent")
                        }
                      >
                        {r.rowNumber}
                      </td>
                      <td className={`${TD} text-muted font-mono`}>{r.accountCurrency}</td>
                      <td className={`${TD} tabular-nums whitespace-nowrap`}>{r.date}</td>
                      <td className={`${TD} max-w-[420px]`} title={r.description}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="truncate">{r.label}</span>
                          {r.problem && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-err border border-err/40 bg-err/10 rounded px-1.5 py-0.5 shrink-0">
                              <AlertTriangle size={10} /> Problème
                            </span>
                          )}
                        </div>
                      </td>
                      <td
                        className={
                          `${TD} text-right tabular-nums whitespace-nowrap font-medium ` +
                          (r.amount != null && r.amount > 0 ? "text-ok" : "")
                        }
                      >
                        {formatSignedAmount(r.amount)}
                      </td>
                      <td className={`${TD} text-right`}>
                        <select
                          value=""
                          onChange={(e) => {
                            const v = e.target.value;
                            e.target.value = "";
                            if (!v) return;
                            const count = sameName.get(r.label.trim().toLowerCase()) ?? 1;
                            if (v.startsWith("to:") && count > 1) {
                              onAskSend(r, v.slice(3) as Assignee, count);
                            } else {
                              void onAction(r, v);
                            }
                          }}
                          className="input !py-1 !px-2 text-[12px] !w-[170px]"
                          title="Signaler un problème ou renvoyer la tâche"
                        >
                          <option value="">Action…</option>
                          {r.problem ? (
                            <option value="no-problem">Plus de problème</option>
                          ) : (
                            <option value="problem">Problème</option>
                          )}
                          {sendTo.map((x) => (
                            <option key={x} value={`to:${x}`}>
                              Renvoyer à {ASSIGNEE_LABEL[x]}
                            </option>
                          ))}
                        </select>
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
