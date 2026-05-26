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
  Clock,
  PlayCircle,
  RefreshCw,
} from "lucide-react";
import { formatRelative } from "@/lib/format";
import type { Mailbox } from "@/lib/types";

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
      syncEnabled: true,
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

        {/* Cron Job */}
        <CronSection mailboxes={mailboxes} onReload={reloadFromDb} />

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
          <DriveCard />
        </section>
      </div>
    </>
  );
}

// --- Cron section ---

type SyncRun = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: "cron" | "manual";
  results: {
    mailboxId: string;
    mailboxEmail: string;
    added: number;
    skipped: number;
    totalMessages: number;
    error?: string;
  }[];
  totalAdded: number;
  totalSkipped: number;
  error: string | null;
};

function CronSection({
  mailboxes,
  onReload,
}: {
  mailboxes: Mailbox[];
  onReload: () => void;
}) {
  const eligible = mailboxes.filter((m) => m.hasRefreshToken);
  const [running, setRunning] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [afterDate, setAfterDate] = useState("");
  const [beforeDate, setBeforeDate] = useState("");
  const [runResult, setRunResult] = useState<{
    totalAdded: number;
    totalSkipped: number;
    results: SyncRun["results"];
    query?: string;
  } | null>(null);
  const [cronStatus, setCronStatus] = useState<{
    enabled: boolean;
    scheduleLabel: string;
    nextRun: string | null;
    lastCronRun: SyncRun | null;
  } | null>(null);
  const [toggling, setToggling] = useState(false);

  // Tic-tac chaque seconde quand le sync est en cours — pour que l'UI
  // montre clairement que ça tourne et combien ça prend.
  useEffect(() => {
    if (!running) {
      setElapsedSec(0);
      return;
    }
    const t0 = Date.now();
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - t0) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [running]);

  const loadRuns = async () => {
    try {
      const r = await fetch("/api/sync/runs", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as { runs: SyncRun[] };
      setRuns(d.runs);
    } catch {
      // silencieux
    }
  };

  const loadCronStatus = async () => {
    try {
      const r = await fetch("/api/cron/status", { cache: "no-store" });
      if (!r.ok) return;
      const d = (await r.json()) as {
        enabled: boolean;
        scheduleLabel: string;
        nextRun: string | null;
        lastCronRun: SyncRun | null;
      };
      setCronStatus(d);
    } catch {
      // silencieux
    }
  };

  useEffect(() => {
    void loadRuns();
    void loadCronStatus();
  }, []);

  const toggleCron = async () => {
    if (!cronStatus) return;
    setToggling(true);
    try {
      await fetch("/api/cron/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !cronStatus.enabled }),
      });
      await loadCronStatus();
    } finally {
      setToggling(false);
    }
  };

  const toggleSync = async (mb: Mailbox) => {
    await fetch(`/api/mailboxes/${mb.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ syncEnabled: !mb.syncEnabled }),
    });
    onReload();
  };

  const runNow = async (only?: string[]) => {
    setRunning(true);
    setRunResult(null);
    try {
      const r = await fetch("/api/sync/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mailboxIds: only,
          lookbackDays: 6,
          afterDate: afterDate || undefined,
          beforeDate: beforeDate || undefined,
        }),
      });
      if (!r.ok) {
        const txt = await r.text();
        alert(`Sync failed: HTTP ${r.status}\n${txt.slice(0, 300)}`);
        return;
      }
      const d = (await r.json()) as {
        results: SyncRun["results"];
        totalAdded: number;
        totalSkipped: number;
        query?: string;
      };
      setRunResult({
        totalAdded: d.totalAdded,
        totalSkipped: d.totalSkipped,
        results: d.results,
        query: d.query,
      });
      await loadRuns();
      onReload();
    } finally {
      setRunning(false);
    }
  };

  const lastRun = runs[0];

  const elapsedLabel =
    elapsedSec < 60
      ? `${elapsedSec}s`
      : `${Math.floor(elapsedSec / 60)} min ${elapsedSec % 60}s`;

  return (
    <section>
      {/* Bandeau "sync en cours" — sticky en haut du viewport, très visible,
          avec compteur de temps écoulé pour rassurer l'utilisateur. */}
      {running && (
        <div className="sticky top-0 z-30 -mx-8 -mt-8 mb-6 px-8 pt-3 pb-3 bg-bg/95 backdrop-blur border-b border-accent2/30">
          <div className="card-accent p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-accent2/15 border border-accent2/40 flex items-center justify-center shrink-0">
              <RefreshCw size={18} className="text-accent animate-spin" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-text flex items-center gap-2">
                Synchronisation en cours…
                <span className="badge info tabular-nums">{elapsedLabel}</span>
              </div>
              <div className="text-[12px] text-muted">
                Récupération des emails, extraction des PDF, classification et
                upload Drive. Ça peut prendre quelques minutes selon le nombre
                de factures — ne ferme pas l'onglet.
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[15px] font-semibold flex items-center gap-2">
            <Clock size={16} /> Cron de synchronisation
          </div>
          <div className="text-[12px] text-muted">
            Tous les 5 jours, le bot va chercher les factures (PJ PDF) des 6 derniers jours sur
            les boîtes activées. Dédup automatique par <code>messageId</code> Gmail.
          </div>
        </div>
        <button
          onClick={() => runNow()}
          disabled={running || eligible.length === 0}
          className="btn btn-primary disabled:opacity-50"
          title={
            eligible.length === 0
              ? "Aucune boîte connectée à Google"
              : "Lancer maintenant sur toutes les boîtes activées"
          }
        >
          {running ? (
            <>
              <RefreshCw size={12} className="animate-spin" />
              <span className="tabular-nums">Sync en cours · {elapsedLabel}</span>
            </>
          ) : (
            <>
              <PlayCircle size={12} /> Lancer maintenant
            </>
          )}
        </button>
      </div>

      {/* Status du cron auto */}
      {cronStatus && (
        <div
          className={`card p-4 mb-3 ${cronStatus.enabled ? "border-ok/30 bg-ok/5" : "border-warn/40 bg-warn/5"}`}
        >
          <div className="flex items-center gap-4">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center ${cronStatus.enabled ? "bg-ok/20 text-ok" : "bg-warn/20 text-warn"}`}
            >
              {cronStatus.enabled ? (
                <CheckCircle2 size={18} />
              ) : (
                <AlertCircle size={18} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div
                className={`text-[13px] font-semibold ${cronStatus.enabled ? "text-ok" : "text-warn"}`}
              >
                {cronStatus.enabled ? "Cron actif" : "Cron en pause"}
              </div>
              <div className="text-[11px] text-muted">
                {cronStatus.scheduleLabel}
                {cronStatus.enabled && cronStatus.nextRun && (
                  <>
                    {" · "}Prochain run :{" "}
                    <strong className="text-text">
                      {new Date(cronStatus.nextRun).toLocaleString("fr-CH", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </strong>
                  </>
                )}
                {cronStatus.lastCronRun && (
                  <>
                    {" · "}Dernier auto :{" "}
                    {formatRelative(cronStatus.lastCronRun.startedAt)} (+
                    {cronStatus.lastCronRun.totalAdded} factures)
                  </>
                )}
              </div>
            </div>
            <button
              onClick={toggleCron}
              disabled={toggling}
              className="btn disabled:opacity-50"
            >
              {toggling ? (
                "…"
              ) : cronStatus.enabled ? (
                <>
                  <AlertCircle size={12} /> Mettre en pause
                </>
              ) : (
                <>
                  <CheckCircle2 size={12} /> Activer le cron
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Plage de dates pour test / sync manuelle ciblée */}
      <div className="card p-4 mb-3 bg-panel2/30">
        <div className="text-[12px] font-medium mb-2 flex items-center gap-2">
          <Clock size={12} /> Plage de dates (optionnel — pour test)
        </div>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div>
            <label className="text-[11px] text-muted block mb-1">Date début (incluse)</label>
            <input
              type="date"
              value={afterDate}
              onChange={(e) => setAfterDate(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="text-[11px] text-muted block mb-1">Date fin (incluse)</label>
            <input
              type="date"
              value={beforeDate}
              onChange={(e) => setBeforeDate(e.target.value)}
              className="input"
            />
          </div>
          {(afterDate || beforeDate) && (
            <button
              onClick={() => {
                setAfterDate("");
                setBeforeDate("");
              }}
              className="btn text-[11px]"
              title="Effacer les dates pour revenir au lookback 6 jours"
            >
              ✕ Effacer
            </button>
          )}
        </div>
        <div className="text-[11px] text-muted mt-2">
          {afterDate || beforeDate ? (
            <>
              Sync ciblée :{" "}
              <code className="font-mono text-text">
                {afterDate ? `du ${afterDate}` : "depuis toujours"} jusqu&apos;à{" "}
                {beforeDate || "aujourd&apos;hui"}
              </code>{" "}
              · Les boutons "Lancer" utiliseront cette plage.
            </>
          ) : (
            <>Vide → utilise le lookback 6 jours du cron auto.</>
          )}
        </div>
      </div>

      {/* Liste des boîtes éligibles avec toggle */}
      <div className="card overflow-hidden">
        <div className="grid grid-cols-[1fr_140px_140px_120px] px-5 py-3 border-b border-border text-[10px] uppercase tracking-wider text-muted">
          <div>Boîte mail</div>
          <div className="text-center">Inclure dans cron</div>
          <div>Dernière synchro</div>
          <div className="text-right">Actions</div>
        </div>
        {eligible.length === 0 && (
          <div className="px-5 py-6 text-center text-[12px] text-muted">
            Aucune boîte connectée à Google pour l&apos;instant. Connecte une boîte via Google
            dans la section précédente.
          </div>
        )}
        {eligible.map((mb) => (
          <div
            key={mb.id}
            className="grid grid-cols-[1fr_140px_140px_120px] px-5 py-3 items-center border-b border-border last:border-b-0 text-[13px]"
          >
            <div className="min-w-0">
              <div className="truncate">{mb.email}</div>
              <div className="text-[11px] text-muted">
                {mb.invoicesFound} facture{mb.invoicesFound > 1 ? "s" : ""} importée
                {mb.invoicesFound > 1 ? "s" : ""} au total
              </div>
            </div>
            <div className="flex items-center justify-center">
              <button
                onClick={() => toggleSync(mb)}
                className="text-[12px]"
                title={mb.syncEnabled ? "Désactiver pour cette boîte" : "Activer pour cette boîte"}
              >
                <ToggleSwitch on={mb.syncEnabled} />
              </button>
            </div>
            <div className="text-[12px] text-muted">
              {mb.lastSync ? formatRelative(mb.lastSync) : "—"}
            </div>
            <div className="flex items-center gap-1 justify-end">
              <button
                onClick={() => runNow([mb.id])}
                disabled={running}
                className="btn text-[11px] disabled:opacity-50"
                title="Synchroniser uniquement cette boîte"
              >
                <PlayCircle size={11} /> Cette boîte
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Résultat du dernier run manuel */}
      {runResult && (
        <div className="card mt-3 border-ok/30 bg-ok/5 p-3">
          <div className="text-[13px] font-medium text-ok flex items-center gap-2">
            <CheckCircle2 size={14} /> Sync terminé : {runResult.totalAdded} ajoutée
            {runResult.totalAdded > 1 ? "s" : ""}, {runResult.totalSkipped} déjà connue
            {runResult.totalSkipped > 1 ? "s" : ""} (dédup)
          </div>
          {runResult.query && (
            <div className="text-[10px] font-mono text-muted mt-1">
              Gmail query : <span className="text-text">{runResult.query}</span>
            </div>
          )}
          <div className="text-[11px] text-muted mt-2 space-y-0.5">
            {runResult.results.map((r) => (
              <div key={r.mailboxId}>
                <strong className="text-text">{r.mailboxEmail}</strong> · {r.added} ajoutées
                · {r.skipped} skippées · {r.totalMessages} mails trouvés
                {r.error && <span className="text-err"> · ❌ {r.error}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Historique compact */}
      {lastRun && (
        <div className="mt-3 text-[11px] text-muted px-1">
          Dernier run : {formatRelative(lastRun.startedAt)} (
          {lastRun.trigger === "cron" ? "automatique" : "manuel"}) · +
          {lastRun.totalAdded} factures, {lastRun.totalSkipped} déjà connues
          {lastRun.error && <span className="text-err"> · ❌ {lastRun.error}</span>}
        </div>
      )}

      <div className="mt-3 text-[11px] text-muted flex items-start gap-1.5 max-w-2xl">
        <ShieldCheck size={11} className="mt-0.5 shrink-0" />
        <span>
          Dédup par identifiant Gmail unique → tu peux relancer autant que tu veux sans doublons.
        </span>
      </div>
    </section>
  );
}

function ToggleSwitch({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-flex items-center w-9 h-5 rounded-full transition-colors ${
        on ? "bg-ok" : "bg-panel2 border border-border"
      }`}
    >
      <span
        className={`w-4 h-4 rounded-full bg-white transition-transform ${
          on ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </span>
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
  const [saveError, setSaveError] = useState<string | null>(null);

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
    setSaveError(null);
    try {
      const body: Record<string, string | null> = {};
      if (email !== mailbox.email) body.email = email.trim();
      if (clientId !== (mailbox.oauthClientId ?? ""))
        body.oauthClientId = clientId.trim() || null;
      if (clientSecret) body.oauthClientSecret = clientSecret;

      const r = await fetch(`/api/mailboxes/${mailbox.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`HTTP ${r.status} — ${txt.slice(0, 200)}`);
      }
      setClientSecret("");
      setSavedAt(Date.now());
      setEditing(false);
      onReload();
    } catch (e) {
      setSaveError((e as Error).message);
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

          {saveError && (
            <span className="text-[11px] text-err flex items-center gap-1 max-w-md truncate" title={saveError}>
              <AlertCircle size={11} /> {saveError}
            </span>
          )}
          {!saveError && savedAt && Date.now() - savedAt < 3000 && (
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

type DriveState = {
  connected: boolean;
  hasCredentials: boolean;
  userEmail: string | null;
  rootFolderId: string | null;
  rootFolderName: string;
  expiresAt: string | null;
  scope: string | null;
};

function DriveCard() {
  const [state, setState] = useState<DriveState | null>(null);
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customFolderId, setCustomFolderId] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);

  const saveFolderId = async () => {
    const id = extractDriveFolderId(customFolderId);
    if (!id) {
      alert("Colle un ID de dossier Drive valide (ou laisse vide pour réinitialiser).");
      return;
    }
    setSavingFolder(true);
    try {
      const r = await fetch("/api/drive/root-folder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: id }),
      });
      const data = (await r.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;
      if (!r.ok) {
        alert(`❌ ${data?.message ?? `HTTP ${r.status}`}`);
        return;
      }
      alert(`✅ Dossier racine mis à jour. Tous les uploads futurs iront dans ce dossier.`);
      setCustomFolderId("");
      await reload();
    } finally {
      setSavingFolder(false);
    }
  };

  const resetFolderId = async () => {
    if (
      !confirm(
        "Réinitialiser le dossier racine ?\n\nLe prochain upload re-créera automatiquement le dossier « Comptabilité » à la racine de ton Drive.",
      )
    )
      return;
    setSavingFolder(true);
    try {
      const r = await fetch("/api/drive/root-folder", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: null }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as { message?: string } | null;
        alert(`❌ ${data?.message ?? `HTTP ${r.status}`}`);
        return;
      }
      await reload();
    } finally {
      setSavingFolder(false);
    }
  };

  const testUpload = async () => {
    setTesting(true);
    try {
      const r = await fetch("/api/drive/test-upload", { method: "POST" });
      const data = (await r.json().catch(() => null)) as
        | {
            ok?: boolean;
            driveFileId?: string;
            drivePath?: string;
            webViewLink?: string;
            rootFolderUrl?: string;
            message?: string;
            stack?: string;
          }
        | null;
      if (!r.ok) {
        alert(
          `❌ Test upload échoué\n\n${data?.message ?? `HTTP ${r.status}`}${
            data?.stack ? `\n\n${data.stack}` : ""
          }`,
        );
        return;
      }
      const summary = [
        `✅ Upload réussi.`,
        ``,
        `Compte Drive : ${state?.userEmail ?? "?"}`,
        `Chemin : ${data?.drivePath ?? "?"}`,
        ``,
        `Liens (s'ouvrent dans le compte Google actuellement connecté dans ton navigateur — assure-toi d'être sur ${state?.userEmail ?? "le bon compte"}) :`,
        data?.webViewLink ? `• Fichier test : ${data.webViewLink}` : null,
        data?.rootFolderUrl ? `• Dossier racine : ${data.rootFolderUrl}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      alert(summary);
      await reload();
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const reload = async () => {
    try {
      const r = await fetch("/api/drive/credentials", { cache: "no-store" });
      if (r.ok) setState((await r.json()) as DriveState);
    } catch {
      /* ignore */
    }
  };

  const saveCreds = async () => {
    if (!clientId.trim() || !clientSecret.trim()) {
      setError("client_id et client_secret requis");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/drive/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
        }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as
          | { message?: string }
          | null;
        setError(data?.message ?? `HTTP ${r.status}`);
        return;
      }
      setState((await r.json()) as DriveState);
      setEditing(false);
      setClientId("");
      setClientSecret("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Déconnecter le Drive ? L'arborescence Drive existante n'est pas supprimée — seuls les tokens locaux le sont.")) return;
    await fetch("/api/auth/drive/disconnect", { method: "POST" });
    await reload();
  };

  if (!state) {
    return (
      <div className="card p-5 text-[12px] text-muted">Chargement…</div>
    );
  }

  return (
    <div className={`card p-5 ${state.connected ? "!border-ok/60" : ""}`}>
      {/* Bandeau d'état */}
      {state.connected ? (
        <div className="flex items-center gap-2 mb-4 text-[12px] text-ok">
          <CheckCircle2 size={14} />
          <span>
            Drive connecté
            {state.userEmail && (
              <span className="text-muted">
                {" "}
                — <span className="font-mono">{state.userEmail}</span>
              </span>
            )}
          </span>
        </div>
      ) : state.hasCredentials ? (
        <div className="flex items-center gap-2 mb-4 text-[12px] text-warn">
          <AlertCircle size={14} />
          Credentials enregistrés — il reste à lancer l'OAuth Google.
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-4 text-[12px] text-muted">
          <AlertCircle size={14} />
          Pas encore configuré. Renseigne le client_id / client_secret OAuth Google.
        </div>
      )}

      {/* Section credentials */}
      <div className="rounded-lg border border-border p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[12px] font-medium">Credentials OAuth Google</div>
          {state.hasCredentials && !editing && (
            <span className="badge ok">
              <Lock size={11} /> Enregistrés
            </span>
          )}
        </div>

        {state.hasCredentials && !editing ? (
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-muted">
              client_id + client_secret en place. Tu peux relancer l'OAuth quand tu veux.
            </div>
            <button onClick={() => setEditing(true)} className="btn !py-1.5">
              <Pencil size={12} /> Modifier
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div>
              <label className="text-[11px] text-muted block mb-1">Client ID</label>
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="xxx.apps.googleusercontent.com"
                className="input font-mono text-[12px]"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted block mb-1">Client Secret</label>
              <input
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="GOCSPX-…"
                className="input font-mono text-[12px]"
              />
            </div>
            <div className="text-[10px] text-muted leading-relaxed pt-1">
              Dans Google Cloud Console, autorise l'URI de redirection :{" "}
              <code className="font-mono text-text">
                {typeof window !== "undefined" ? window.location.origin : ""}/api/auth/drive/callback
              </code>
            </div>
            {error && <div className="text-[11px] text-err">{error}</div>}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={saveCreds}
                disabled={saving}
                className="btn btn-primary !py-1.5 disabled:opacity-50"
              >
                <Save size={12} /> {saving ? "Sauvegarde…" : "Enregistrer"}
              </button>
              {editing && (
                <button
                  onClick={() => {
                    setEditing(false);
                    setClientId("");
                    setClientSecret("");
                    setError(null);
                  }}
                  className="btn !py-1.5"
                >
                  Annuler
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Lien direct + diagnostic */}
      {state.connected && (
        <div className="rounded-lg border border-border p-3 mb-3 space-y-2 text-[11px]">
          <div>
            <span className="text-muted">Dossier racine : </span>
            <span className="font-mono text-text">{state.rootFolderName}</span>
            {state.rootFolderId && (
              <span className="text-muted">
                {" "}
                · ID <span className="font-mono text-text">{state.rootFolderId.slice(0, 12)}…</span>
              </span>
            )}
          </div>
          {state.rootFolderId ? (
            <div>
              <a
                href={`https://drive.google.com/drive/folders/${state.rootFolderId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                → Ouvrir dans Drive
              </a>
              <span className="text-muted ml-2">
                (s'ouvre avec le compte Google actif dans ton navigateur — si tu es sur plusieurs
                comptes, switcher sur <span className="font-mono text-text">{state.userEmail}</span>)
              </span>
            </div>
          ) : (
            <div className="text-muted">
              Le dossier racine n'a pas encore été créé — il le sera au premier upload.
            </div>
          )}
          <div>
            <button
              onClick={testUpload}
              disabled={testing}
              className="btn !py-1 !px-2.5 text-[11px] disabled:opacity-50"
              title="Crée un mini PDF de test dans le dossier racine pour vérifier la connexion"
            >
              {testing ? "Test en cours…" : "🧪 Tester l'upload"}
            </button>
            {state.rootFolderId && (
              <button
                onClick={resetFolderId}
                disabled={savingFolder}
                className="btn !py-1 !px-2.5 text-[11px] disabled:opacity-50 ml-2"
                title="Oublier ce dossier racine — le prochain upload en créera un nouveau"
              >
                Réinitialiser
              </button>
            )}
          </div>

          {/* Champ pour pointer vers un dossier Drive existant. */}
          <div className="pt-2 border-t border-border/60 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted">
              Utiliser un dossier Drive existant
            </div>
            <div className="text-[11px] text-muted leading-relaxed">
              Colle l'ID d'un dossier Drive (ex.{" "}
              <span className="font-mono">1fcRTrPEREb6frpell6I2Gcb_iSA-Nteo</span> dans une URL
              <span className="font-mono"> drive.google.com/drive/folders/&lt;ID&gt;</span>). Le
              bot s'assure d'abord que tu y as l'accès en écriture.
            </div>
            <div className="flex gap-2 items-stretch">
              <input
                value={customFolderId}
                onChange={(e) => setCustomFolderId(e.target.value)}
                placeholder="Folder ID"
                className="input font-mono !text-[11px] flex-1"
              />
              <button
                onClick={saveFolderId}
                disabled={savingFolder || !customFolderId.trim()}
                className="btn btn-primary !py-1 !px-3 text-[11px] disabled:opacity-50"
              >
                {savingFolder ? "Sauvegarde…" : "Utiliser ce dossier"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bouton Connect / Disconnect */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] text-muted">
          {!state.connected && (
            <>Scope : <code>drive.file</code> — accès uniquement aux fichiers créés par l'app.</>
          )}
        </div>
        {state.connected ? (
          <button onClick={disconnect} className="btn">
            <Unlink size={12} /> Déconnecter
          </button>
        ) : (
          <a
            href="/api/auth/drive/start"
            className={`btn btn-primary ${
              state.hasCredentials ? "" : "pointer-events-none opacity-50"
            }`}
          >
            <Link2 size={12} /> Connecter Google Drive
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Extrait un Drive folder ID depuis ce que l'utilisateur a collé.
 * Accepte :
 *   - "1ov1T2woxFL78Z6ti7P6oO4zsuziejUCc"               (ID brut)
 *   - "1ov1T2woxFL78Z6ti7P6oO4zsuziejUCc?usp=sharing"   (avec params)
 *   - "https://drive.google.com/drive/folders/<ID>?…"   (URL complète)
 *   - "https://drive.google.com/drive/u/4/folders/<ID>" (URL multi-compte)
 */
function extractDriveFolderId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // URL contenant /folders/<ID>
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  // Sinon on prend tout ce qui est avant le premier ? ou /
  return trimmed.split(/[?/]/)[0];
}
