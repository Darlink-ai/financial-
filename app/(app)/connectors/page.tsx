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
  CheckCircle2,
  AlertCircle,
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

  useEffect(() => {
    if (successParam) void reloadFromDb();
  }, [successParam, reloadFromDb]);

  const handleAdd = () => {
    addMailbox({
      id: `mb-${Date.now()}`,
      email: "",
      provider: "gmail",
      connected: false,
      invoicesFound: 0,
      lastSync: null,
      oauthClientId: null,
      hasOauthSecret: false,
      oauthUserEmail: null,
      oauthExpiresAt: null,
      oauthScope: null,
      hasRefreshToken: false,
    });
  };

  return (
    <>
      <PageHeader
        title="Connexions"
        subtitle="Une carte par boîte Gmail Workspace. Renseigne email + Client ID + Client Secret, puis connecte via Google."
        showMonthSelector={false}
      />

      <div className="p-8 space-y-6">
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
                  Cette boîte n'a pas de Client ID/Secret enregistrés.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Mailboxes */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[15px] font-semibold flex items-center gap-2">
                <Mail size={16} /> Boîtes Gmail à surveiller
              </div>
              <div className="text-[12px] text-muted">
                Tu peux utiliser les <strong>mêmes</strong> Client ID/Secret pour toutes les
                boîtes de ton Workspace, ou des credentials différents par boîte.
              </div>
            </div>
            <button onClick={handleAdd} className="btn btn-primary">
              <Plus size={12} /> Ajouter une boîte
            </button>
          </div>

          {mailboxes.length === 0 && (
            <div className="card p-12 text-center text-[12px] text-muted">
              Aucune boîte déclarée.
            </div>
          )}

          <div className="space-y-3">
            {mailboxes.map((mb) => (
              <MailboxCard
                key={mb.id}
                mailbox={mb}
                onDelete={async () => {
                  if (!confirm(`Supprimer la boîte "${mb.email || "(sans nom)"}" ?`)) return;
                  removeMailbox(mb.id);
                }}
                onReload={reloadFromDb}
              />
            ))}
          </div>

          <div className="mt-4 card bg-panel2/40 p-3 text-[11px] text-muted leading-relaxed">
            <strong className="text-text">URI de redirection à configurer</strong> dans
            ton/tes app(s) OAuth Google Cloud Console :
            <div className="font-mono text-[12px] mt-1 text-text">
              https://financial.darlink.ai/api/auth/google/callback
            </div>
            <div className="mt-1">
              (et <code>http://localhost:3030/api/auth/google/callback</code> pour le dev local)
            </div>
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

function MailboxCard({
  mailbox,
  onDelete,
  onReload,
}: {
  mailbox: Mailbox;
  onDelete: () => void;
  onReload: () => void;
}) {
  const [email, setEmail] = useState(mailbox.email);
  const [clientId, setClientId] = useState(mailbox.oauthClientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty =
    email !== mailbox.email ||
    clientId !== (mailbox.oauthClientId ?? "") ||
    clientSecret.length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, string | null> = {};
      if (email !== mailbox.email) body.email = email;
      if (clientId !== (mailbox.oauthClientId ?? ""))
        body.oauthClientId = clientId || null;
      if (clientSecret) body.oauthClientSecret = clientSecret;

      await fetch(`/api/mailboxes/${mailbox.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setClientSecret("");
      setSavedAt(Date.now());
      onReload();
    } finally {
      setSaving(false);
    }
  };

  const connect = () => {
    window.location.href = `/api/auth/google/start?mailboxId=${encodeURIComponent(mailbox.id)}`;
  };

  const disconnect = async () => {
    if (!confirm(`Déconnecter Google pour "${mailbox.email}" ?`)) return;
    await fetch("/api/auth/google/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mailboxId: mailbox.id }),
    });
    onReload();
  };

  const hasCredentials = !!mailbox.oauthClientId && mailbox.hasOauthSecret;
  const isConnected = mailbox.hasRefreshToken;
  const credsHaveChanged =
    clientId !== (mailbox.oauthClientId ?? "") || clientSecret.length > 0;

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <div className="w-8 h-8 rounded-md bg-panel2 border border-border flex items-center justify-center">
          <Mail size={14} className="text-muted" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium truncate">
            {email || mailbox.email || "(nouvelle boîte)"}
          </div>
          <div className="text-[11px] text-muted">
            {isConnected ? (
              <span className="text-ok">
                ● Connectée
                {mailbox.oauthUserEmail &&
                  mailbox.oauthUserEmail.toLowerCase() !== email.toLowerCase() && (
                    <span className="text-warn ml-1">
                      (Google: {mailbox.oauthUserEmail})
                    </span>
                  )}
              </span>
            ) : hasCredentials ? (
              <span>○ Credentials OK, prête à connecter</span>
            ) : (
              <span>○ Credentials manquants</span>
            )}
            {mailbox.lastSync && (
              <span className="ml-2">· Dernière synchro {formatRelative(mailbox.lastSync)}</span>
            )}
          </div>
        </div>
        <button
          onClick={onDelete}
          className="btn !px-2 text-[11px]"
          title="Supprimer cette boîte"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <div className="p-5 grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="text-[11px] text-muted block mb-1">Adresse email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="comptabilite@famelink.ai"
            className="input"
          />
        </div>

        <div>
          <label className="text-[11px] text-muted block mb-1">Client ID Google</label>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="123456-abc.apps.googleusercontent.com"
            className="input font-mono text-[12px]"
          />
        </div>
        <div>
          <label className="text-[11px] text-muted block mb-1">
            Client Secret
            {mailbox.hasOauthSecret && (
              <span className="text-ok text-[10px] ml-1">● enregistré</span>
            )}
          </label>
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={
              mailbox.hasOauthSecret
                ? "•••• (laisse vide pour conserver)"
                : "GOCSPX-..."
            }
            className="input font-mono text-[12px]"
          />
        </div>

        <div className="col-span-2 flex items-center gap-2 pt-1">
          <div className="text-[11px] text-muted flex items-center gap-1.5 flex-1">
            <ShieldCheck size={11} /> Secret stocké en DB, jamais renvoyé au navigateur.
          </div>
          {savedAt && Date.now() - savedAt < 3000 && (
            <span className="text-[11px] text-ok">Enregistré ✓</span>
          )}
          <button
            onClick={save}
            disabled={saving || !dirty}
            className="btn disabled:opacity-50"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
          {isConnected ? (
            <button onClick={disconnect} className="btn">
              <Unlink size={12} /> Déconnecter Google
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={!hasCredentials || credsHaveChanged}
              title={
                !hasCredentials
                  ? "Enregistre d'abord Client ID + Secret"
                  : credsHaveChanged
                    ? "Enregistre avant de connecter"
                    : "Connecter via Google"
              }
              className="btn btn-primary disabled:opacity-50"
            >
              <Link2 size={12} /> Connecter via Google
            </button>
          )}
        </div>
      </div>
    </div>
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
    </div>
  );
}
