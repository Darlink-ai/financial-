"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { useStore } from "@/lib/store";
import {
  Mail,
  HardDrive,
  Plus,
  Trash2,
  Link2,
  Unlink,
  ShieldCheck,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { formatRelative } from "@/lib/format";
import type { Mailbox, DriveConfig } from "@/lib/types";

export default function ConnectorsPage() {
  return (
    <Suspense fallback={null}>
      <ConnectorsInner />
    </Suspense>
  );
}

function ConnectorsInner() {
  const searchParams = useSearchParams();
  const successParam = searchParams.get("connected");
  const errorParam = searchParams.get("error");

  const {
    mailboxes,
    addMailbox,
    removeMailbox,
    drive,
    setDrive,
    reloadFromDb,
  } = useStore();
  const [draftEmail, setDraftEmail] = useState("");

  // Settings Google OAuth
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [secretAlreadySet, setSecretAlreadySet] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSavedAt, setSettingsSavedAt] = useState<number | null>(null);

  const loadSettings = async () => {
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      if (!r.ok) return;
      const data = (await r.json()) as {
        googleClientId: string;
        googleClientSecretSet: boolean;
      };
      setClientId(data.googleClientId);
      setSecretAlreadySet(data.googleClientSecretSet);
    } catch {
      // silencieux
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  // Refresh la liste des mailboxes après un retour OAuth réussi.
  useEffect(() => {
    if (successParam) void reloadFromDb();
  }, [successParam, reloadFromDb]);

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const body: Record<string, string> = {};
      body.googleClientId = clientId;
      if (clientSecret) body.googleClientSecret = clientSecret;
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setClientSecret("");
      setSettingsSavedAt(Date.now());
      void loadSettings();
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAdd = () => {
    if (!draftEmail.includes("@")) return;
    addMailbox({
      id: `mb-${Date.now()}`,
      email: draftEmail.trim().toLowerCase(),
      provider: "gmail",
      connected: false,
      invoicesFound: 0,
      lastSync: null,
      oauthUserEmail: null,
      oauthExpiresAt: null,
      oauthScope: null,
      hasRefreshToken: false,
    });
    setDraftEmail("");
  };

  const connectMailbox = (mb: Mailbox) => {
    window.location.href = `/api/auth/google/start?mailboxId=${encodeURIComponent(mb.id)}`;
  };

  const disconnectMailbox = async (mb: Mailbox) => {
    if (!confirm(`Déconnecter ${mb.email} ?`)) return;
    await fetch("/api/auth/google/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mailboxId: mb.id }),
    });
    await reloadFromDb();
  };

  return (
    <>
      <PageHeader
        title="Connexions"
        subtitle="Boîtes mail à surveiller (Gmail Workspace via OAuth) et Drive de destination."
        showMonthSelector={false}
      />

      <div className="p-8 space-y-8">
        {/* Notifs OAuth */}
        {successParam && (
          <div className="card border-ok/40 bg-ok/5 p-3 text-[12px] text-ok flex items-center gap-2">
            <CheckCircle2 size={14} /> Boîte connectée avec succès.
          </div>
        )}
        {errorParam && (
          <div className="card border-err/40 bg-err/5 p-3 text-[12px] text-err flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              Échec de la connexion : <code className="font-mono">{errorParam}</code>
              {errorParam === "missing_google_credentials" && (
                <div className="mt-1 text-muted">
                  Renseigne d'abord ton Client ID et Client Secret Google ci-dessous.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Google OAuth credentials */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[15px] font-semibold flex items-center gap-2">
                <KeyRound size={16} /> Identifiants Google OAuth
              </div>
              <div className="text-[12px] text-muted">
                Crée une app OAuth sur{" "}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  Google Cloud Console
                </a>{" "}
                (User Type <strong>Internal</strong>) et colle les credentials ici. Active les
                APIs Gmail et Drive.
              </div>
            </div>
          </div>

          <div className="card p-5 grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] text-muted block mb-1">Client ID</label>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="123456789-abcdef.apps.googleusercontent.com"
                className="input font-mono text-[12px]"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted block mb-1">
                Client Secret{" "}
                {secretAlreadySet && (
                  <span className="text-ok text-[10px]">● enregistré</span>
                )}
              </label>
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder={
                  secretAlreadySet ? "•••••••••••• (laisse vide pour conserver)" : "GOCSPX-..."
                }
                className="input font-mono text-[12px]"
              />
            </div>

            <div className="col-span-2 flex items-center justify-between">
              <div className="text-[11px] text-muted flex items-center gap-1.5">
                <ShieldCheck size={11} /> Le secret est stocké en DB, jamais renvoyé au navigateur après save.
              </div>
              <div className="flex items-center gap-2">
                {settingsSavedAt && Date.now() - settingsSavedAt < 3000 && (
                  <span className="text-[11px] text-ok">Enregistré ✓</span>
                )}
                <button
                  onClick={saveSettings}
                  disabled={savingSettings || !clientId}
                  className="btn btn-primary disabled:opacity-50"
                >
                  {savingSettings ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            </div>

            <div className="col-span-2 card bg-panel2/40 p-3 text-[11px] text-muted leading-relaxed">
              <strong className="text-text">URI de redirection OAuth à ajouter</strong> dans
              ton app Google Cloud Console :
              <div className="font-mono text-[12px] mt-1 text-text">
                https://financial.darlink.ai/api/auth/google/callback
              </div>
              <div className="mt-1">
                (Et <code>http://localhost:3030/api/auth/google/callback</code> pour le dev local.)
              </div>
            </div>
          </div>
        </section>

        {/* Mailboxes */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[15px] font-semibold flex items-center gap-2">
                <Mail size={16} /> Boîtes Gmail à surveiller
              </div>
              <div className="text-[12px] text-muted">
                Une ligne par boîte. Le bouton <em>Connecter</em> ouvre le consent Google pour
                cette boîte précise.
              </div>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="grid grid-cols-[1fr_140px_180px_120px] px-5 py-3 border-b border-border text-[10px] uppercase tracking-wider text-muted">
              <div>Adresse souhaitée</div>
              <div>Factures</div>
              <div>Dernière synchro</div>
              <div className="text-right">Actions</div>
            </div>
            {mailboxes.length === 0 && (
              <div className="px-5 py-6 text-center text-[12px] text-muted">
                Aucune boîte déclarée. Ajoute-en une ci-dessous.
              </div>
            )}
            {mailboxes.map((mb) => (
              <div
                key={mb.id}
                className="grid grid-cols-[1fr_140px_180px_120px] px-5 py-3 items-center border-b border-border last:border-b-0 text-[13px]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-7 h-7 rounded-md bg-panel2 border border-border flex items-center justify-center">
                    <Mail size={13} className="text-muted" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate">{mb.email}</div>
                    <div className="text-[11px] text-muted">
                      {mb.hasRefreshToken ? (
                        <span className="text-ok">
                          ● Connectée
                          {mb.oauthUserEmail && mb.oauthUserEmail !== mb.email && (
                            <span className="text-warn ml-1">
                              (Google: {mb.oauthUserEmail})
                            </span>
                          )}
                        </span>
                      ) : (
                        <span>○ Non connectée</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right tabular-nums text-[12px]">
                  {mb.invoicesFound}
                </div>
                <div className="text-[12px] text-muted">
                  {mb.lastSync ? formatRelative(mb.lastSync) : "—"}
                </div>
                <div className="flex items-center gap-1 justify-end">
                  {mb.hasRefreshToken ? (
                    <button
                      onClick={() => disconnectMailbox(mb)}
                      className="btn text-[11px]"
                      title="Déconnecter Google"
                    >
                      <Unlink size={11} /> Déco.
                    </button>
                  ) : (
                    <button
                      onClick={() => connectMailbox(mb)}
                      className="btn btn-primary text-[11px]"
                      title="Connecter via Google"
                    >
                      <Link2 size={11} /> Connecter
                    </button>
                  )}
                  <button
                    onClick={() => removeMailbox(mb.id)}
                    className="btn text-[11px] !px-2"
                    title="Supprimer la ligne"
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
              placeholder="comptabilite@famelink.ai"
              className="input flex-1"
            />
            <button onClick={handleAdd} className="btn btn-primary">
              <Plus size={12} /> Ajouter
            </button>
          </div>

          <div className="mt-3 text-[11px] text-muted flex items-center gap-1.5">
            <RefreshCw size={11} /> Un cron sync les boîtes connectées (sera ajouté à l'étape suivante).
          </div>
        </section>

        {/* Drive */}
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
        <ShieldCheck size={11} /> L'auth Drive utilisera les mêmes credentials Google OAuth (scope drive.file).
      </div>
    </div>
  );
}
