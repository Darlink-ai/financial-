"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useStore } from "@/lib/store";
import { FALLBACK_CATEGORY_ID } from "@/lib/mock-data";
import { Plus, Trash2, FolderTree, FileQuestion, Info } from "lucide-react";
import type { FolderMapping } from "@/lib/types";

export default function MappingsPage() {
  const { mappings, addMapping, updateMapping, removeMapping } = useStore();
  const [draft, setDraft] = useState<Omit<FolderMapping, "id">>({
    creditorPattern: "",
    folderCode: "",
    folderLabel: "",
  });

  const handleAdd = () => {
    if (!draft.creditorPattern || !draft.folderCode || !draft.folderLabel) return;
    addMapping({ id: `fm-${Date.now()}`, ...draft });
    setDraft({ creditorPattern: "", folderCode: "", folderLabel: "" });
  };

  const normalCategories = mappings.filter((m) => m.id !== FALLBACK_CATEGORY_ID);
  const fallback = mappings.find((m) => m.id === FALLBACK_CATEGORY_ID);

  return (
    <>
      <PageHeader
        title="Classement comptable"
        subtitle="Catégories de charges et règles d'auto-classement. Pour chaque créditeur, on devine la catégorie grâce au motif (séparé par |). Le nom final suit le format JJ.MM.AA - Créditeur - Code."
        showMonthSelector={false}
      />

      <div className="p-8 space-y-6">
        <section>
          <div className="text-[11px] uppercase tracking-wider text-muted mb-2 px-1">
            Catégories actives
          </div>
          <div className="card overflow-hidden">
            <div className="grid grid-cols-[1.4fr_100px_1.6fr_1fr_60px] px-5 py-3 border-b border-border text-[10px] uppercase tracking-wider text-muted">
              <div>Créditeur (motif)</div>
              <div>Code</div>
              <div>Libellé dossier</div>
              <div>Notes</div>
              <div></div>
            </div>
            {normalCategories.map((m) => (
              <div
                key={m.id}
                className="grid grid-cols-[1.4fr_100px_1.6fr_1fr_60px] px-5 py-2.5 items-center border-b border-border last:border-b-0 gap-3"
              >
                <input
                  value={m.creditorPattern}
                  onChange={(e) => updateMapping(m.id, { creditorPattern: e.target.value })}
                  className="input"
                  placeholder="ex: Stripe|PayPal"
                />
                <input
                  value={m.folderCode}
                  onChange={(e) => updateMapping(m.id, { folderCode: e.target.value })}
                  className="input font-mono"
                  placeholder="TECH"
                />
                <input
                  value={m.folderLabel}
                  onChange={(e) => updateMapping(m.id, { folderLabel: e.target.value })}
                  className="input"
                  placeholder="Charges logicielles, R&D & Technologie"
                />
                <input
                  value={m.notes ?? ""}
                  onChange={(e) => updateMapping(m.id, { notes: e.target.value })}
                  className="input"
                  placeholder="—"
                />
                <button
                  onClick={() => removeMapping(m.id)}
                  className="btn !px-2 text-[11px]"
                  title="Supprimer"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {fallback && (
          <section>
            <div className="text-[11px] uppercase tracking-wider text-muted mb-2 px-1 flex items-center gap-2">
              <FileQuestion size={12} /> Catégorie de dernier recours
            </div>
            <div className="card border-warn/40 bg-warn/5 p-5">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-lg bg-warn/10 border border-warn/30 flex items-center justify-center shrink-0">
                  <FileQuestion size={18} className="text-warn" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <div className="font-mono text-[12px] text-warn">{fallback.folderCode}</div>
                    <div className="text-[14px] font-medium">{fallback.folderLabel}</div>
                  </div>
                  <div className="text-[12px] text-muted mt-2 leading-relaxed">
                    {fallback.notes}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 max-w-xl">
                    <div>
                      <label className="text-[11px] text-muted block mb-1">Code</label>
                      <input
                        value={fallback.folderCode}
                        onChange={(e) =>
                          updateMapping(fallback.id, { folderCode: e.target.value })
                        }
                        className="input font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-muted block mb-1">Libellé</label>
                      <input
                        value={fallback.folderLabel}
                        onChange={(e) =>
                          updateMapping(fallback.id, { folderLabel: e.target.value })
                        }
                        className="input"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="card p-4">
          <div className="text-[12px] font-medium mb-3 flex items-center gap-2">
            <FolderTree size={14} /> Nouvelle catégorie
          </div>
          <div className="grid grid-cols-[1.4fr_100px_1.6fr_1fr_auto] gap-3 items-end">
            <div>
              <label className="text-[11px] text-muted block mb-1">Créditeur (motif)</label>
              <input
                value={draft.creditorPattern}
                onChange={(e) => setDraft({ ...draft, creditorPattern: e.target.value })}
                placeholder="Stripe|PayPal|Adyen"
                className="input"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted block mb-1">Code</label>
              <input
                value={draft.folderCode}
                onChange={(e) => setDraft({ ...draft, folderCode: e.target.value })}
                placeholder="PROC"
                className="input font-mono"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted block mb-1">Libellé dossier</label>
              <input
                value={draft.folderLabel}
                onChange={(e) => setDraft({ ...draft, folderLabel: e.target.value })}
                placeholder="Commission et charges du processeur de paiement"
                className="input"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted block mb-1">Notes</label>
              <input
                value={draft.notes ?? ""}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="(optionnel)"
                className="input"
              />
            </div>
            <button onClick={handleAdd} className="btn btn-primary">
              <Plus size={12} /> Ajouter
            </button>
          </div>
        </section>

        <div className="card p-4 bg-panel2/30 flex gap-3">
          <Info size={14} className="text-muted shrink-0 mt-0.5" />
          <div className="text-[11px] text-muted leading-relaxed">
            <strong className="text-text">Astuces de motif :</strong> sépare plusieurs créditeurs
            avec <code className="font-mono">|</code> (ex: <code className="font-mono">Migros|Coop</code>
            ). Recherche insensible à la casse, sous-chaîne ou regex.{" "}
            <strong className="text-text">Code :</strong> abréviation courte qui finira dans le nom de
            fichier (ex: <code className="font-mono">22.05.26 - Runpod - TECH</code>).
          </div>
        </div>
      </div>
    </>
  );
}
