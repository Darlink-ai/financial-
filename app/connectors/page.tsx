"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { useStore } from "@/lib/store";
import { Mail, HardDrive, Plus, Trash2, Link2, Unlink, ShieldCheck } from "lucide-react";
import { formatRelative } from "@/lib/format";
import type { Mailbox, DriveConfig } from "@/lib/types";

export default function ConnectorsPage() {
  const { mailboxes, addMailbox, removeMailbox, toggleMailbox, drive, setDrive } = useStore();
  const [draftEmail, setDraftEmail] = useState("");
  const [draftProvider, setDraftProvider] = useState<Mailbox["provider"]>("gmail");

  const handleAdd = () => {
    if (!draftEmail.includes("@")) return;
    addMailbox({
      id: `mb-${Date.now()}`,
      email: draftEmail,
      provider: draftProvider,
      connected: false,
      invoicesFound: 0,
      lastSync: null,
    });
    setDraftEmail("");
  };

  return (
    <>
      <PageHeader
        title="Connexions"
        subtitle="Boîtes mail à surveiller et Drive de destination. Le branchement OAuth sera fait dans un second temps — pour l'instant on déclare les comptes."
        showMonthSelector={false}
      />

      <div className="p-8 space-y-8">
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[15px] font-semibold flex items-center gap-2">
                <Mail size={16} /> Boîtes mail à surveiller
              </div>
              <div className="text-[12px] text-muted">
                Chaque boîte sera scannée à intervalle régulier pour récupérer les factures (PDF en PJ ou liens).
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="grid grid-cols-[1fr_140px_100px_140px_120px] px-5 py-3 border-b border-border text-[10px] uppercase tracking-wider text-muted">
              <div>Adresse</div>
              <div>Fournisseur</div>
              <div className="text-right">Factures</div>
              <div>Dernière synchro</div>
              <div className="text-right">Actions</div>
            </div>
            {mailboxes.map((mb) => (
              <div
                key={mb.id}
                className="grid grid-cols-[1fr_140px_100px_140px_120px] px-5 py-3 items-center border-b border-border last:border-b-0 text-[13px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-7 h-7 rounded-md bg-panel2 border border-border flex items-center justify-center">
                    <Mail size={13} className="text-muted" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate">{mb.email}</div>
                    <div className="text-[11px] text-muted">
                      {mb.connected ? (
                        <span className="text-ok">● Connectée</span>
                      ) : (
                        <span>○ Non connectée</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-[12px] capitalize text-muted">{mb.provider}</div>
                <div className="text-right tabular-nums text-[12px]">{mb.invoicesFound}</div>
                <div className="text-[12px] text-muted">
                  {mb.lastSync ? formatRelative(mb.lastSync) : "—"}
                </div>
                <div className="flex items-center gap-1 justify-end">
                  <button
                    onClick={() => toggleMailbox(mb.id)}
                    className="btn text-[11px]"
                    title={mb.connected ? "Déconnecter" : "Connecter"}
                  >
                    {mb.connected ? <Unlink size={11} /> : <Link2 size={11} />}
                    {mb.connected ? "Déco." : "Conn."}
                  </button>
                  <button
                    onClick={() => removeMailbox(mb.id)}
                    className="btn text-[11px] !px-2"
                    title="Supprimer"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="card mt-3 p-4 flex items-center gap-3">
            <input
              value={draftEmail}
              onChange={(e) => setDraftEmail(e.target.value)}
              placeholder="nouvelle.adresse@bim-commune.ch"
              className="input flex-1"
            />
            <select
              value={draftProvider}
              onChange={(e) => setDraftProvider(e.target.value as Mailbox["provider"])}
              className="input !w-40"
            >
              <option value="gmail">Gmail</option>
              <option value="outlook">Outlook</option>
              <option value="imap">IMAP</option>
            </select>
            <button onClick={handleAdd} className="btn btn-primary">
              <Plus size={12} /> Ajouter
            </button>
          </div>

          <div className="mt-3 text-[11px] text-muted flex items-center gap-1.5">
            <ShieldCheck size={11} /> OAuth Gmail / Outlook sera branché ensuite — pour IMAP, mot de passe d'application requis.
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[15px] font-semibold flex items-center gap-2">
                <HardDrive size={16} /> Drive de destination
              </div>
              <div className="text-[12px] text-muted">
                Les factures classées et renommées seront déposées dans l'arborescence indiquée.
              </div>
            </div>
          </div>

          <DriveCard drive={drive} setDrive={setDrive} />
        </section>
      </div>
    </>
  );
}

function DriveCard({
  drive,
  setDrive,
}: {
  drive: DriveConfig;
  setDrive: (d: Partial<DriveConfig>) => void;
}) {
  return (
    <div className="card p-5">
      <div className="grid grid-cols-3 gap-4">
        {(["google", "dropbox", "onedrive"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setDrive({ provider: p })}
            className={`card p-4 text-left transition-colors ${
              drive.provider === p ? "!border-accent2 bg-panel2" : "hover:bg-panel2"
            }`}
          >
            <div className="text-[13px] font-medium capitalize">
              {p === "google" ? "Google Drive" : p === "dropbox" ? "Dropbox" : "OneDrive"}
            </div>
            <div className="text-[11px] text-muted mt-1">
              {drive.provider === p ? "Sélectionné" : "Cliquer pour sélectionner"}
            </div>
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-[1fr_auto] gap-3">
        <div>
          <label className="text-[11px] text-muted block mb-1">Dossier racine</label>
          <input
            value={drive.rootPath ?? ""}
            onChange={(e) => setDrive({ rootPath: e.target.value })}
            placeholder="/Comptabilité/{YYYY}/{MM}/{code} - {libellé}"
            className="input font-mono"
          />
          <div className="text-[11px] text-muted mt-1">
            Variables disponibles : <code>{"{YYYY}"}</code>, <code>{"{MM}"}</code>,{" "}
            <code>{"{code}"}</code>, <code>{"{libellé}"}</code>, <code>{"{créditeur}"}</code>.
          </div>
        </div>
        <div className="flex items-end">
          <button
            onClick={() => setDrive({ connected: !drive.connected })}
            className={`btn ${drive.connected ? "" : "btn-primary"}`}
          >
            {drive.connected ? (
              <>
                <Unlink size={12} /> Déconnecter
              </>
            ) : (
              <>
                <Link2 size={12} /> Connecter
              </>
            )}
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-[11px] text-muted">
        <ShieldCheck size={11} /> L'authentification OAuth sera ajoutée ensuite — pour l'instant on enregistre le chemin cible.
      </div>
    </div>
  );
}
