"use client";

import { useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useStore } from "@/lib/store";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Trash2,
  ExternalLink,
} from "lucide-react";
import type { Invoice, AccountCurrency } from "@/lib/types";
import { formatAmount, formatSwissDate } from "@/lib/format";

/**
 * État de chaque brouillon :
 *  - uploading : POST en cours vers /api/invoices/upload?draft=1
 *  - drafted   : pipeline terminé, en attente de validation user
 *  - validating: POST vers /assign-row pour valider + uploader Drive
 *  - validated : Drive uploadé + marqué matched (succès final)
 *  - failed    : erreur (upload ou validation)
 */
type DraftStatus =
  | "uploading"
  | "drafted"
  | "validating"
  | "validated"
  | "failed";

type DraftItem = {
  /** Clé locale stable (filename + index au drop) */
  key: string;
  fileName: string;
  fileSize: number;
  status: DraftStatus;
  message?: string;
  /** Set après le POST upload : info renvoyée par le serveur. */
  invoice?: Invoice;
  /** N° de ligne Excel proposé par l'auto-match (null si pas trouvé). */
  proposedRow?: number | null;
  /** Devise du sheet où le match a été trouvé (USD/EUR/CHF). */
  proposedCurrency?: AccountCurrency | null;
  /** Valeur courante de l'input "N° ligne" (modifiable par l'user). */
  rowInput: string;
  /** Devise sélectionnée pour le rapprochement (modifiable). */
  currencyInput: AccountCurrency;
  /** Warnings ou erreurs renvoyés par autoProcess. */
  errors?: string[];
};

export default function ImportPage() {
  const { reloadFromDb } = useStore();
  const [items, setItems] = useState<DraftItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /** Lance l'upload draft de chaque fichier en parallèle (3 en même temps
   *  pour pas saturer le serveur). */
  const handleFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf"),
    );
    if (arr.length === 0) {
      alert("Seuls les fichiers .pdf sont acceptés.");
      return;
    }
    const newItems: DraftItem[] = arr.map((f, idx) => ({
      key: `${Date.now()}-${idx}-${f.name}`,
      fileName: f.name,
      fileSize: f.size,
      status: "uploading",
      rowInput: "",
      currencyInput: "USD",
    }));
    setItems((prev) => [...prev, ...newItems]);
    // Upload séquentiel pour pas saturer le serveur (chaque autoProcess
    // peut prendre 5-10s avec l'extraction PDF + LLM fallback éventuel).
    void (async () => {
      for (let i = 0; i < arr.length; i++) {
        await uploadDraft(newItems[i].key, arr[i]);
      }
    })();
  };

  const setItemByKey = (key: string, patch: Partial<DraftItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, ...patch } : it)),
    );
  };

  const uploadDraft = async (key: string, file: File) => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("draft", "1");
      const r = await fetch("/api/invoices/upload", {
        method: "POST",
        body: fd,
      });
      const data = (await r.json().catch(() => null)) as
        | {
            ok?: boolean;
            invoice?: Invoice;
            outcome?: {
              status?: string;
              matchedExcelRow?: number | null;
              errors?: string[];
            };
            message?: string;
          }
        | null;
      if (!r.ok || !data?.ok) {
        setItemByKey(key, {
          status: "failed",
          message: data?.message ?? `HTTP ${r.status}`,
        });
        return;
      }
      const inv = data.invoice ?? undefined;
      const proposedRow = data.outcome?.matchedExcelRow ?? null;
      setItemByKey(key, {
        status: "drafted",
        invoice: inv,
        proposedRow,
        proposedCurrency: inv?.accountCurrency ?? "USD",
        rowInput: proposedRow != null ? String(proposedRow) : "",
        currencyInput: inv?.accountCurrency ?? "USD",
        errors: data.outcome?.errors,
      });
    } catch (e) {
      setItemByKey(key, {
        status: "failed",
        message: (e as Error).message,
      });
    }
  };

  const validateItem = async (it: DraftItem) => {
    if (!it.invoice) return;
    const n = parseInt(it.rowInput.trim(), 10);
    if (!Number.isFinite(n) || n < 2) {
      alert(
        "Tape un n° de ligne Excel valide (≥ 2 — la ligne 1 est l'en-tête).",
      );
      return;
    }
    setItemByKey(it.key, { status: "validating", message: undefined });
    try {
      const r = await fetch(`/api/invoices/${it.invoice.id}/assign-row`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rowNumber: n,
          accountCurrency: it.currencyInput,
        }),
      });
      const data = (await r.json().catch(() => null)) as
        | {
            ok?: boolean;
            drive?: { uploaded?: boolean; reason?: string };
            message?: string;
          }
        | null;
      if (!r.ok || !data?.ok) {
        setItemByKey(it.key, {
          status: "drafted",
          message: data?.message ?? `HTTP ${r.status}`,
        });
        return;
      }
      const driveOk = data.drive?.uploaded === true;
      setItemByKey(it.key, {
        status: "validated",
        message: driveOk
          ? undefined
          : `Match OK, Drive non envoyé (${data.drive?.reason ?? "raison inconnue"})`,
      });
      await reloadFromDb();
    } catch (e) {
      setItemByKey(it.key, {
        status: "drafted",
        message: (e as Error).message,
      });
    }
  };

  const deleteItem = async (it: DraftItem) => {
    if (
      !confirm(
        `Supprimer cette facture du système ? Pour les faux positifs (mail qui n'est pas une vraie facture).\n\n${it.invoice?.creditor ?? ""} — ${it.fileName}`,
      )
    )
      return;
    if (it.invoice) {
      try {
        const r = await fetch(`/api/invoices/${it.invoice.id}`, {
          method: "DELETE",
        });
        if (!r.ok) {
          alert(`Échec suppression : HTTP ${r.status}`);
          return;
        }
        await reloadFromDb();
      } catch (e) {
        alert(`Erreur : ${(e as Error).message}`);
        return;
      }
    }
    setItems((prev) => prev.filter((p) => p.key !== it.key));
  };

  /** Retire seulement de la liste locale (sans supprimer en DB) — pour
   *  les items déjà validés qu'on veut juste masquer de la vue. */
  const dismissItem = (key: string) => {
    setItems((prev) => prev.filter((p) => p.key !== key));
  };

  const clearAll = () => {
    if (!confirm("Vider la liste des brouillons en cours ?")) return;
    setItems((prev) => prev.filter((p) => p.status === "uploading"));
  };

  const draftedCount = items.filter((i) => i.status === "drafted").length;
  const validatedCount = items.filter((i) => i.status === "validated").length;

  return (
    <>
      <PageHeader
        title="Ajout manuel"
        subtitle="Glisse-dépose tes PDFs. Chaque fichier est analysé (extraction, classification, proposition de ligne Excel) puis présenté ci-dessous pour review. Rien ne part sur Drive tant que tu n'as pas cliqué sur Valider."
      />

      <div className="p-8 space-y-4">
        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileRef.current?.click()}
          className={`card border-dashed cursor-pointer transition-colors p-12 text-center ${
            dragOver ? "!border-accent2 bg-panel2" : "hover:bg-panel2"
          }`}
        >
          <div className="w-14 h-14 rounded-full bg-panel2 border border-border mx-auto mb-4 flex items-center justify-center">
            <Upload size={22} className="text-accent" />
          </div>
          <div className="text-[15px] font-medium">
            Glisse tes PDFs ici ou clique pour parcourir
          </div>
          <div className="text-[12px] text-muted mt-1">
            Plusieurs fichiers acceptés. Le traitement démarre dès le drop.
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {items.length > 0 && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border gap-3 flex-wrap">
              <div className="text-[13px]">
                <span className="font-medium">
                  {items.length} fichier{items.length > 1 ? "s" : ""}
                </span>
                <span className="text-muted ml-2">
                  · {draftedCount} en attente de validation · {validatedCount}{" "}
                  validé{validatedCount > 1 ? "s" : ""}
                </span>
              </div>
              <button onClick={clearAll} className="btn ml-auto">
                <Trash2 size={12} /> Vider la vue
              </button>
            </div>
            <div className="divide-y divide-border">
              {items.map((it) => (
                <DraftRow
                  key={it.key}
                  item={it}
                  onChange={(patch) => setItemByKey(it.key, patch)}
                  onValidate={() => validateItem(it)}
                  onDelete={() => deleteItem(it)}
                  onDismiss={() => dismissItem(it.key)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/** Une ligne de review pour 1 PDF. Affiche tous les champs extraits +
 *  un input N° ligne (pré-rempli avec le match auto si trouvé) + bouton
 *  Valider qui déclenche /assign-row → Drive upload. */
function DraftRow({
  item,
  onChange,
  onValidate,
  onDelete,
  onDismiss,
}: {
  item: DraftItem;
  onChange: (patch: Partial<DraftItem>) => void;
  onValidate: () => void;
  onDelete: () => void;
  onDismiss: () => void;
}) {
  const inv = item.invoice;
  const accentBorder =
    item.status === "validated"
      ? "border-l-2 border-l-ok"
      : item.status === "failed"
      ? "border-l-2 border-l-err"
      : item.status === "drafted" && item.proposedRow != null
      ? "border-l-2 border-l-accent"
      : "";

  return (
    <div className={`px-5 py-3 ${accentBorder}`}>
      <div className="flex items-start gap-3">
        <FileText size={16} className="text-muted shrink-0 mt-1" />
        <div className="min-w-0 flex-1 space-y-1">
          {/* Ligne 1 : nom du fichier + status */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-medium truncate">
              {item.fileName}
            </span>
            <span className="text-[10px] text-muted">
              ({(item.fileSize / 1024).toFixed(0)} ko)
            </span>
            <StatusBadge status={item.status} />
            {inv && (
              <a
                href={`/api/invoices/${inv.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-accent hover:underline inline-flex items-center gap-1 ml-auto"
                title="Ouvrir le PDF dans un nouvel onglet"
              >
                Ouvrir PDF <ExternalLink size={10} />
              </a>
            )}
          </div>

          {/* Ligne 2 : données extraites */}
          {inv && (
            <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-x-4 gap-y-1 text-[11px] text-muted tabular-nums">
              <div>
                <span className="text-muted">Créditeur : </span>
                <span className="text-text">{inv.creditor ?? "—"}</span>
              </div>
              <div>
                <span className="text-muted">Date : </span>
                <span className="text-text">
                  {formatSwissDate(inv.invoiceDate)}
                </span>
              </div>
              <div>
                <span className="text-muted">Montant : </span>
                <span className="text-text">
                  {formatAmount(inv.amount, inv.currency)}
                </span>
              </div>
              <div>
                <span className="text-muted">Code : </span>
                <span className="text-text font-mono">
                  {inv.folderCode
                    ? `${inv.folderCode} — ${inv.folderLabel}`
                    : "—"}
                </span>
              </div>
            </div>
          )}

          {/* Ligne 3 : nom final proposé */}
          {inv?.finalName && (
            <div className="text-[11px]">
              <span className="text-muted">Nom Drive proposé : </span>
              <span className="font-mono text-text">{inv.finalName}.pdf</span>
            </div>
          )}

          {/* Ligne 4 : erreur/warning si présent */}
          {item.message && (
            <div className="text-[11px] text-warn">{item.message}</div>
          )}
          {item.errors && item.errors.length > 0 && (
            <div className="text-[10px] text-warn">
              {item.errors.join(" · ")}
            </div>
          )}
        </div>
      </div>

      {/* Ligne d'action : input ligne Excel + devise + Valider/Supprimer */}
      {item.status === "drafted" && inv && (
        <div className="mt-2 ml-7 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-muted">Rapprochement Excel :</span>
          <input
            type="number"
            min={2}
            placeholder="N° ligne"
            value={item.rowInput}
            onChange={(e) => onChange({ rowInput: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") onValidate();
            }}
            className="input !py-1 !px-2 text-[11px] !w-24"
            title={
              item.proposedRow != null
                ? `Match auto proposé : ligne ${item.proposedRow}`
                : "Pas de match auto trouvé — tape la ligne manuellement"
            }
          />
          <select
            className="input !py-1 !px-2 text-[11px] !w-20"
            value={item.currencyInput}
            onChange={(e) =>
              onChange({
                currencyInput: e.target.value as AccountCurrency,
              })
            }
            title="Devise du compte bancaire (sheet Excel à utiliser)"
          >
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="CHF">CHF</option>
          </select>
          {item.proposedRow != null && (
            <span className="text-[10px] text-muted">
              auto : ligne {item.proposedRow} ({item.proposedCurrency})
            </span>
          )}
          <button
            onClick={onValidate}
            disabled={!item.rowInput.trim()}
            className="btn btn-primary !py-1 !px-3 text-[11px] disabled:opacity-50"
            title="Marquer la facture comme rapprochée et l'envoyer sur Drive"
          >
            <CheckCircle2 size={11} /> Valider la facture
          </button>
          <button
            onClick={onDelete}
            className="btn !py-1 !px-2 text-[11px] hover:!border-err hover:text-err"
            title="Ce n'est pas une vraie facture — supprimer du système"
          >
            <Trash2 size={11} />
          </button>
        </div>
      )}
      {item.status === "validated" && (
        <div className="mt-2 ml-7 flex items-center gap-3">
          <span className="text-[11px] text-ok">
            ✓ Facture validée, ajoutée au Drive et marquée verte dans le
            rapprochement Excel.
          </span>
          <button
            onClick={onDismiss}
            className="btn !py-1 !px-2 text-[10px] ml-auto"
            title="Retirer de la vue (la facture reste en DB)"
          >
            Masquer
          </button>
        </div>
      )}
      {item.status === "failed" && (
        <div className="mt-2 ml-7 flex items-center gap-3">
          <button
            onClick={onDelete}
            className="btn !py-1 !px-2 text-[11px] hover:!border-err hover:text-err"
          >
            <Trash2 size={11} /> Supprimer
          </button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: DraftStatus }) {
  if (status === "uploading")
    return (
      <span className="badge info inline-flex items-center gap-1">
        <RefreshCw size={10} className="animate-spin" /> Traitement…
      </span>
    );
  if (status === "drafted")
    return <span className="badge warn">À valider</span>;
  if (status === "validating")
    return (
      <span className="badge info inline-flex items-center gap-1">
        <RefreshCw size={10} className="animate-spin" /> Validation…
      </span>
    );
  if (status === "validated")
    return (
      <span className="badge ok inline-flex items-center gap-1">
        <CheckCircle2 size={10} /> Validé
      </span>
    );
  return (
    <span className="badge err inline-flex items-center gap-1">
      <AlertCircle size={10} /> Échec
    </span>
  );
}
