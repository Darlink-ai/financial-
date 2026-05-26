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
  Lock,
  Pencil,
  Save,
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
        subtitle="Une carte par boîte Gmail. Étape 1 : enregistrer email + credentials. Étape 2 : connecter à Google pour autoriser l'accès au mail."
        showMonthSelector={false}
      />

      <div className="p-8 space-y-6">
        {successParam && (
          <div className="card border-ok/40 bg-ok/5 p-3 text-[12px] text-ok flex items-center gap-2">
            <CheckCircle2 size={14} /> Boîte connectée à Google avec succès.
          </div>
        )}
        {errorParam && (
          <div className="card border-err/40 bg-err/5 p-3 text-[12px] text-err flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              Échec de la connexion : <code className="font-mono">{errorParam}</code>
            </div>
          </div>
        )}

        <section>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-[15px] font-semibold flex items-center gap-2">
                <Mail size={16} /> Boîtes Gmail à surveiller
              </div>
              <div className="text-[12px] text-muted">
                Tu peux mettre la même paire Client ID/Secret pour plusieurs boîtes du même
                Workspace, ou des credentials différents par boîte.
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
                  if (
                    !confirm(
                      `Supprimer définitivement la boîte "${mb.email || "(sans nom)"}" ? Les credentials et la connexion Google seront perdus.`,
                    )
                  )
                    return;
                  removeMailbox(mb.id);
                }}
                onReload={reloadFromDb}
              />
            ))}
          </div>

          <div className="mt-4 card bg-panel2/40 p-3 text-[11px] text-muted leading-relaxed">
            <strong className="text-text">URI de redirection à configurer</strong> dans ton/tes
            app(s) OAuth Google Cloud Console :
            <div className="font-mono text-[12px] mt-1 text-text">
              https://financial.darlink.ai/api/auth/google/callback
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
  const hasSavedCreds = !!mailbox.oauthClientId && mailbox.hasOauthSecret;
  const isConnected = mailbox.hasRefreshToken;

  // editing = true tant que les credentials ne sont pas sauvegardés.
  // Une fois saved, la carte se verrouille (vert), bouton "Modifier" pour la rouvrir.
  const [editing, setEditing] = useState(!hasSavedCreds);
  const [email, setEmail] = useState(mailbox.email);
  const [clientId, setClientId] = useState(mailbox.oauthClientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Si la boîte vient juste d'être créée (id mais aucune saved cred), force editing.
  useEffect(() => {
    if (!hasSavedCreds) setEditing(true);
  }, [hasSavedCreds]);

  const dirty =
    email !== mailbox.email ||
    clientId !== (mailbox.oauthClientId ?? "") ||
    clientSecret.length > 0;

  const canSave =
    editing &&
    email.trim().length > 0 &&
    clientId.trim().length > 0 &&
    // pour la 1ère save, le secret est requis ; pour modifier, il peut rester vide (on conserve)
    (mailbox.hasOauthSecret || clientSecret.length > 0);

  const save = async () => {
    setSaving(true);
    try {
      const body: Record<string, string | null> = {};
      if (email !== mailbox.email) body.email = email.trim();
      if (clientId !== (mailbox.oauthClientId ?? ""))
        body.oauthClientId = clientId.trim() || null;
      if (clientSecret) body.oauthClientSecret = clientSecret;

      await fetch(`/api/mailboxes/${mailbox.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setClientSecret("");
      setSavedAt(Date.now());
      setEditing(false);
      onReload();
    } finally {
      setSaving(false);
    }
  };

  const connect = () => {
    window.location.href = `/api/auth/google/start?mailboxId=${encodeURIComponent(mailbox.id)}`;
  };

  const disconnect = async () => {
    if (
      !confirm(
        `Déconnecter Google pour "${mailbox.email}" ? Les credentials restent enregistrés, tu pourras reconnecter ensuite.`,
      )
    )
      return;
    await fetch("/api/auth/google/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mailboxId: mailbox.id }),
    });
    onReload();
  };

  const cardBorder = isConnected
    ? "!border-ok/60"
    : !editing && hasSavedCreds
      ? "!border-ok/40"
      : "";

  return (
    <div className={`card overflow-hidden ${cardBorder}`}>
      <div className="px-5 py-4 border-b border-border flex items-center gap-3">
        <div className="w-8 h-8 rounded-md bg-panel2 border border-border flex items-center justify-center">
          <Mail size={14} className="text-muted" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium truncate flex items-center gap-2">
            {email || mailbox.email || "(nouvelle boîte)"}
            {!editing && hasSavedCreds && (
              <Lock size={11} className="text-muted" aria-label="Verrouillé" />
            )}
          </div>
          <div className="text-[11px] text-muted">
            {isConnected ? (
              <span className="text-ok flex items-center gap-1">
                <CheckCircle2 size={11} /> Connectée à Google
                {mailbox.oauthUserEmail &&
                  mailbox.oauthUserEmail.toLowerCase() !== email.toLowerCase() && (
                    <span className="text-warn ml-1">
                      (Google: {mailbox.oauthUserEmail})
                    </span>
                  )}
              </span>
            ) : hasSavedCreds ? (
              <span>○ Credentials enregistrés — manque la connexion Google</span>
            ) : (
              <span>○ Renseigne email + Client ID + Client Secret</span>
            )}
            {mailbox.lastSync && (
              <span className="ml-2">· Dernière synchro {formatRelative(mailbox.lastSync)}</span>
            )}
          </div>
        </div>
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
            disabled={!editing}
          />
        </div>

        <div>
          <label className="text-[11px] text-muted block mb-1">Client ID Google</label>
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="123456-abc.apps.googleusercontent.com"
            className="input font-mono text-[12px]"
            disabled={!editing}
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
            disabled={!editing}
          />
        </div>

        {/* Barre d'actions selon l'état */}
        <div className="col-span-2 pt-1 flex items-center gap-2">
          <button
            onClick={onDelete}
            className="btn !text-err hover:!border-err/40"
            title="Supprimer cette boîte définitivement"
          >
            <Trash2 size={12} /> Supprimer
          </button>

          <div className="flex-1" />

          {savedAt && Date.now() - savedAt < 3000 && (
            <span className="text-[11px] text-ok flex items-center gap-1">
              <CheckCircle2 size={11} /> Enregistré
            </span>
          )}

          {editing ? (
            <button
              onClick={save}
              disabled={saving || !canSave || !dirty}
              className="btn btn-primary disabled:opacity-50"
            >
              <Save size={12} /> {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          ) : (
            <button onClick={() => setEditing(true)} className="btn">
              <Pencil size={12} /> Modifier
            </button>
          )}

          {!editing && hasSavedCreds && (
            isConnected ? (
              <button onClick={disconnect} className="btn">
                <Unlink size={12} /> Déconnecter Google
              </button>
            ) : (
              <button
                onClick={connect}
                className="btn btn-primary"
                title="Ouvre le consent Google pour autoriser l'app à lire cette boîte"
              >
                <Link2 size={12} /> Connecter via Google
              </button>
            )
          )}
        </div>

        {!editing && hasSavedCreds && !isConnected && (
          <div className="col-span-2 -mt-2 text-[11px] text-muted leading-relaxed flex items-start gap-1.5">
            <ShieldCheck size={11} className="mt-0.5 shrink-0" />
            <span>
              <strong className="text-text">Pourquoi "Connecter via Google" ?</strong> Tes
              credentials sont enregistrés mais l'app n'a pas encore l'autorisation de lire la
              boîte. Ce bouton ouvre le consent Google où tu autorises explicitement l'accès.
            </span>
          </div>
        )}
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
