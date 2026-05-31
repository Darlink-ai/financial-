"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { formatAmount, buildFinalName } from "@/lib/format";

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
  /** Overrides éditables (pré-remplis depuis l'auto-extract, modifiables
   *  par l'utilisateur avant Valider). */
  creditorInput: string;
  folderCodeInput: string;
  invoiceDateInput: string; // YYYY-MM-DD
  finalNameInput: string;   // Sans .pdf
  /** Warnings ou erreurs renvoyés par autoProcess. */
  errors?: string[];
};

export default function ImportPage() {
  const { reloadFromDb, invoices } = useStore();
  const [items, setItems] = useState<DraftItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [purgingDb, setPurgingDb] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Option C : force un reloadFromDb au mount pour que la vue initiale
  // reflète exactement ce qui est en DB (brouillons "Ajout manuel" laissés
  // d'une session précédente). Sans ça, la première validation déclenche
  // un reload qui fait apparaître d'un coup des dizaines/centaines de
  // brouillons "fantômes" → effet de surprise (149 → 340) qu'on évite.
  useEffect(() => {
    void reloadFromDb();
    // On veut juste au mount — reloadFromDb est stable (zustand).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Drafts persistants : toutes les invoices créées via /import (mailbox
   *  "Ajout manuel") qui sont encore en status="renamed" (pas validées) et
   *  pas supprimées. On les "rehydrate" comme DraftItem au mount + à chaque
   *  changement du store, pour qu'on retrouve la review row si on a quitté
   *  la page sans Valider. */
  const persistedDrafts = useMemo<DraftItem[]>(() => {
    return invoices
      .filter(
        (inv) =>
          inv.mailbox === "Ajout manuel" &&
          (inv.status === "renamed" || inv.status === "manual"),
      )
      .map<DraftItem>((inv) => ({
        key: `db-${inv.id}`,
        fileName: inv.attachment?.name ?? inv.subject,
        fileSize: inv.attachment?.sizeBytes ?? 0,
        status: "drafted",
        invoice: inv,
        proposedRow: inv.excelRowMatched ?? null,
        proposedCurrency: inv.accountCurrency,
        rowInput:
          inv.excelRowMatched != null ? String(inv.excelRowMatched) : "",
        currencyInput: inv.accountCurrency,
        creditorInput: inv.creditor ?? "",
        folderCodeInput: inv.folderCode ?? "",
        invoiceDateInput: inv.invoiceDate ?? "",
        finalNameInput: inv.finalName ?? "",
      }));
  }, [invoices]);

  // Merge intelligent : on préserve les inputs locaux (rowInput, creditor,
  // etc.) en marchant la liste locale d'abord, puis on ajoute les nouveaux
  // drafts DB qui n'y sont pas encore. Si un item local n'a plus de
  // correspondance DB (= invoice supprimée), on le retire — sauf s'il est
  // dans un état post-action (validated/failed) qu'on veut garder visible.
  useEffect(() => {
    setItems((local) => {
      const persistedByInvoiceId = new Map<string, DraftItem>();
      for (const d of persistedDrafts) {
        if (d.invoice?.id) persistedByInvoiceId.set(d.invoice.id, d);
      }

      const localInvoiceIds = new Set<string>();
      const merged: DraftItem[] = [];

      for (const it of local) {
        const invoiceId = it.invoice?.id;
        if (!invoiceId) {
          // Item local sans invoice (uploading en cours) → on garde.
          merged.push(it);
          continue;
        }
        localInvoiceIds.add(invoiceId);
        const persisted = persistedByInvoiceId.get(invoiceId);
        if (persisted) {
          // Présent partout : on PRÉSERVE le local (rowInput, creditor,
          // folderCode, finalName tels que l'user les a tapés). On rafraîchit
          // juste les métadonnées d'invoice (au cas où l'auto-process a
          // recalculé un champ côté serveur entre temps).
          merged.push({ ...it, invoice: persisted.invoice });
        } else if (it.status === "validated" || it.status === "failed") {
          // L'invoice n'est plus dans persistedDrafts (probablement parce
          // qu'elle est passée à "matched" suite à un Valider), mais on
          // garde la row dans la vue pour que l'user voie le résultat.
          merged.push(it);
        }
        // Sinon : status="drafted" mais plus en DB → supprimée (clic
        // corbeille ou auto-clean doublon), on retire du tableau.
      }

      // Ajoute les nouveaux drafts DB qui n'étaient pas du tout en local.
      for (const d of persistedDrafts) {
        const id = d.invoice?.id;
        if (id && !localInvoiceIds.has(id)) merged.push(d);
      }
      return merged;
    });
  }, [persistedDrafts]);

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
      creditorInput: "",
      folderCodeInput: "",
      invoiceDateInput: "",
      finalNameInput: "",
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
        // Pré-remplit les champs éditables avec ce que l'auto-extract
        // a trouvé. L'utilisateur peut corriger avant de Valider.
        creditorInput: inv?.creditor ?? "",
        folderCodeInput: inv?.folderCode ?? "",
        invoiceDateInput: inv?.invoiceDate ?? "",
        finalNameInput: inv?.finalName ?? "",
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
    // Si la ligne ciblée est déjà occupée par une facture validée
    // (= verte dans le rapprochement Excel), on demande confirmation.
    const occupier = findOccupier(it);
    if (occupier) {
      const month = (it.invoiceDateInput || "").slice(0, 7);
      if (
        !confirm(
          `⚠ La ligne #${n} ${it.currencyInput} de ${month} est déjà rapprochée par :\n\n${occupier.finalName ?? occupier.creditor ?? occupier.id}\n\nValider cette facture va déplacer le match vers elle. L'ancienne facture rapprochée sera dégradée (status "renamed"). Continuer ?`,
        )
      ) {
        return;
      }
    }
    setItemByKey(it.key, { status: "validating", message: undefined });
    try {
      // Construit le payload avec les overrides éditables. On ne renvoie
      // que ceux qui ont changé OU qui sont remplis (sinon serveur garde
      // la valeur actuelle).
      const payload: Record<string, unknown> = {
        rowNumber: n,
        accountCurrency: it.currencyInput,
      };
      const creditor = it.creditorInput.trim();
      const folderCode = it.folderCodeInput.trim();
      const invoiceDate = it.invoiceDateInput.trim();
      const finalName = it.finalNameInput.trim();
      if (creditor) payload.creditor = creditor;
      if (folderCode) {
        payload.folderCode = folderCode;
        // On envoie aussi folderLabel si on l'a (depuis l'invoice originale,
        // sinon on déduit du code).
        payload.folderLabel = it.invoice.folderLabel ?? folderCode;
      }
      if (invoiceDate) payload.invoiceDate = invoiceDate;
      if (finalName) payload.finalName = finalName;

      const r = await fetch(`/api/invoices/${it.invoice.id}/assign-row`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

      // Auto-suppression des siblings qui ciblaient la même ligne Excel
      // (même rowNumber + currency + mois). Ils sont devenus obsolètes
      // car la ligne est maintenant prise par celle qu'on vient de valider.
      const siblings = collisionMap.get(it.key) ?? [];
      const deletedNames: string[] = [];
      for (const siblingKey of siblings) {
        const sibling = items.find((p) => p.key === siblingKey);
        if (!sibling || !sibling.invoice) continue;
        try {
          const dr = await fetch(`/api/invoices/${sibling.invoice.id}`, {
            method: "DELETE",
          });
          if (dr.ok) {
            deletedNames.push(sibling.fileName);
            setItems((prev) => prev.filter((p) => p.key !== siblingKey));
          }
        } catch {
          /* silent — pas bloquant */
        }
      }
      await reloadFromDb();
      if (deletedNames.length > 0) {
        alert(
          `Facture validée sur ligne #${n}.\n\n${deletedNames.length} doublon(s) supprimé(s) automatiquement (même ligne Excel) :\n• ${deletedNames.join("\n• ")}`,
        );
      }
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

  /**
   * Option B : supprime EN DB tous les brouillons issus de "Ajout manuel"
   * qui sont encore en status renamed/manual (= non rapprochés). N'agit
   * QUE sur mailbox='Ajout manuel' — les factures Gmail-synced, les
   * rapprochées Excel (status='matched'), les factures en cours d'analyse,
   * etc. ne sont absolument pas touchées.
   *
   * Filtre strict côté SQL → garanti côté serveur même si l'UI est buggée.
   */
  const purgeAllManualDrafts = async () => {
    // 1) Lecture du nombre exact côté serveur (pas du count local — peut
    //    être divergent si la session est restée ouverte longtemps).
    let serverCount = 0;
    try {
      const r = await fetch("/api/invoices/bulk-manual-drafts", {
        cache: "no-store",
      });
      const data = (await r.json().catch(() => null)) as
        | { ok?: boolean; count?: number }
        | null;
      if (!r.ok || !data?.ok) {
        alert(`Impossible de compter les brouillons : HTTP ${r.status}`);
        return;
      }
      serverCount = data.count ?? 0;
    } catch (e) {
      alert(`Erreur réseau : ${(e as Error).message}`);
      return;
    }

    if (serverCount === 0) {
      alert("Aucun brouillon Ajout manuel à supprimer.");
      return;
    }

    const ok = confirm(
      [
        `⚠ Supprimer définitivement ${serverCount} brouillon(s) issus de "Ajout manuel" ?`,
        "",
        "Seuls les brouillons NON rapprochés (status renamed/manual) seront effacés.",
        "",
        "RIEN d'autre n'est touché :",
        "  • les factures rapprochées Excel (vertes) restent intactes",
        "  • les factures Gmail-synced ne sont pas concernées",
        "  • les mailboxes, mappings, Drive, revenus, etc. ne bougent pas",
        "",
        "Action irréversible. Continuer ?",
      ].join("\n"),
    );
    if (!ok) return;

    setPurgingDb(true);
    try {
      const r = await fetch("/api/invoices/bulk-manual-drafts", {
        method: "DELETE",
      });
      const data = (await r.json().catch(() => null)) as
        | { ok?: boolean; deleted?: number; ids?: string[] }
        | null;
      if (!r.ok || !data?.ok) {
        alert(`Échec suppression : HTTP ${r.status}`);
        return;
      }
      const deletedIds = new Set(data.ids ?? []);
      // Nettoie aussi la liste locale : tous les items dont l'invoice
      // vient d'être supprimée disparaissent de la vue. Les items en cours
      // d'upload (pas encore d'invoice.id) restent — on n'a aucune raison
      // de les retirer.
      setItems((prev) =>
        prev.filter((p) => {
          const id = p.invoice?.id;
          if (!id) return true;
          return !deletedIds.has(id);
        }),
      );
      await reloadFromDb();
      alert(`${data.deleted ?? 0} brouillon(s) supprimé(s) de la DB.`);
    } catch (e) {
      alert(`Erreur : ${(e as Error).message}`);
    } finally {
      setPurgingDb(false);
    }
  };

  /** Index des lignes Excel déjà occupées par une facture en status="matched"
   *  (= verte dans le rapprochement Excel). Clé : `${currency}|${row}|${month}`.
   *  Sert à signaler aux drafts de /import qu'ils ciblent une ligne déjà
   *  prise par une autre facture. */
  const occupiedRows = useMemo(() => {
    const map = new Map<string, Invoice>();
    for (const inv of invoices) {
      if (inv.status !== "matched") continue;
      if (!inv.excelRowMatched) continue;
      const month = inv.invoiceDate?.slice(0, 7);
      if (!month) continue;
      const key = `${inv.accountCurrency}|${inv.excelRowMatched}|${month}`;
      // Si déjà un occupant pour cette clé (multiple matches → dédupe en
      // cours), on garde le 1er trouvé — peu importe pour l'avertissement.
      if (!map.has(key)) map.set(key, inv);
    }
    return map;
  }, [invoices]);

  /** Renvoie la facture déjà rapprochée à la cible d'un draft donné, ou
   *  null si la ligne est libre. */
  const findOccupier = (it: DraftItem): Invoice | null => {
    const row = parseInt(it.rowInput.trim(), 10);
    if (!Number.isFinite(row) || row < 2) return null;
    const month = it.invoiceDateInput.slice(0, 7);
    if (!month) return null;
    const occupier = occupiedRows.get(
      `${it.currencyInput}|${row}|${month}`,
    );
    if (occupier && occupier.id === it.invoice?.id) return null; // soi-même
    return occupier ?? null;
  };

  const draftedCount = items.filter((i) => i.status === "drafted").length;
  const [validatingAll, setValidatingAll] = useState(false);

  /** Validation en batch de tous les drafts éligibles. Skip ceux qui :
   *   - n'ont pas de n° ligne renseigné
   *   - ciblent une ligne déjà prise par une facture matched (pour pas
   *     écraser sans confirmation)
   *  Les doublons entre brouillons (siblings) sont auto-nettoyés par
   *  validateItem au fil du traitement. Récap final dans une alert. */
  const validateAll = async () => {
    type Skipped = { name: string; reason: string };
    const eligibles: DraftItem[] = [];
    const skipped: Skipped[] = [];
    for (const it of items) {
      if (it.status !== "drafted" || !it.invoice?.id) continue;
      const n = parseInt(it.rowInput.trim(), 10);
      if (!Number.isFinite(n) || n < 2) {
        skipped.push({ name: it.fileName, reason: "n° ligne vide ou invalide" });
        continue;
      }
      if (findOccupier(it)) {
        skipped.push({
          name: it.fileName,
          reason: "ligne déjà prise par une autre facture",
        });
        continue;
      }
      eligibles.push(it);
    }

    if (eligibles.length === 0) {
      alert(
        `Aucun brouillon prêt à valider.\n\n${skipped.length} skip(s) :\n• ${skipped.map((s) => `${s.name} (${s.reason})`).join("\n• ") || "(rien)"}`,
      );
      return;
    }

    const msg = [
      `Valider ${eligibles.length} facture(s) en séquence ?`,
      `Les doublons entre brouillons seront auto-supprimés.`,
      skipped.length > 0
        ? `\n${skipped.length} skip(s) prévu(s) :\n• ${skipped.map((s) => `${s.name} (${s.reason})`).join("\n• ")}`
        : "",
    ].join("\n");
    if (!confirm(msg)) return;

    setValidatingAll(true);
    // Track des invoice IDs traités (= validés OU auto-supprimés comme
    // siblings) pour skip dans les itérations suivantes.
    const handled = new Set<string>();
    let processed = 0;
    for (const it of eligibles) {
      if (handled.has(it.invoice!.id)) continue;
      handled.add(it.invoice!.id);
      // Marque les siblings comme handled — ils seront auto-supprimés
      // par validateItem.
      const siblingKeys = collisionMap.get(it.key) ?? [];
      for (const sk of siblingKeys) {
        const sib = items.find((p) => p.key === sk);
        if (sib?.invoice?.id) handled.add(sib.invoice.id);
      }
      await validateItem(it);
      processed++;
    }
    setValidatingAll(false);

    // Petit récap. Les badges sur les rows reflètent le résultat de
    // chaque ligne — on ne ré-itère pas le détail ici.
    const summary = [
      `${processed} facture(s) traitée(s).`,
      skipped.length > 0
        ? `${skipped.length} skip(s) (ligne vide / ligne déjà prise — voir le détail au démarrage).`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    alert(`Validation en lot terminée.\n\n${summary}`);
  };

  /** Détecte les collisions de cible (même rowNumber + currency + mois).
   *  Renvoie pour chaque draft "drafted" la clé partagée + la liste des
   *  autres clés en collision avec elle. Permet d'afficher un badge ⚠️
   *  et de supprimer automatiquement les siblings à la Validation. */
  const collisionMap = useMemo(() => {
    const byTarget = new Map<string, string[]>(); // target key → [item.key]
    for (const it of items) {
      if (it.status !== "drafted") continue;
      const row = parseInt(it.rowInput.trim(), 10);
      if (!Number.isFinite(row) || row < 2) continue;
      const month = (it.invoiceDateInput || "").slice(0, 7);
      if (!month) continue;
      const target = `${it.currencyInput}|${row}|${month}`;
      const arr = byTarget.get(target) ?? [];
      arr.push(it.key);
      byTarget.set(target, arr);
    }
    // Inverse : key item → liste des keys siblings (siblings = même cible
    // mais autre PDF).
    const siblings = new Map<string, string[]>();
    for (const [, keys] of byTarget) {
      if (keys.length < 2) continue;
      for (const k of keys) {
        siblings.set(
          k,
          keys.filter((x) => x !== k),
        );
      }
    }
    return siblings;
  }, [items]);
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
              <div className="flex items-center gap-2 ml-auto">
                {draftedCount > 0 && (
                  <button
                    onClick={validateAll}
                    disabled={validatingAll || purgingDb}
                    className="btn btn-primary disabled:opacity-50"
                    title={`Valider en séquence les ${draftedCount} brouillon(s) qui ont une ligne Excel renseignée. Skip ceux qui ciblent une ligne déjà prise.`}
                  >
                    {validatingAll ? (
                      <>
                        <RefreshCw size={12} className="animate-spin" /> Validation
                        en cours…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={12} /> Valider tout ({draftedCount})
                      </>
                    )}
                  </button>
                )}
                <button
                  onClick={clearAll}
                  disabled={validatingAll || purgingDb}
                  className="btn disabled:opacity-50"
                  title="Vide la liste affichée. N'efface rien en base — les brouillons réapparaîtront au prochain reload."
                >
                  <Trash2 size={12} /> Vider la vue
                </button>
                <button
                  onClick={purgeAllManualDrafts}
                  disabled={validatingAll || purgingDb}
                  className="btn disabled:opacity-50 hover:!border-err hover:text-err"
                  title="Supprime EN BASE tous les brouillons Ajout manuel non rapprochés. Aucune autre facture n'est touchée (Gmail, rapprochées, etc. intactes)."
                >
                  {purgingDb ? (
                    <>
                      <RefreshCw size={12} className="animate-spin" /> Suppression…
                    </>
                  ) : (
                    <>
                      <Trash2 size={12} /> Vider tous les brouillons (DB)
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="divide-y divide-border">
              {items.map((it) => {
                const siblingKeys = collisionMap.get(it.key) ?? [];
                const siblingNames = siblingKeys
                  .map((k) => items.find((p) => p.key === k)?.fileName)
                  .filter((n): n is string => !!n);
                const occupier = findOccupier(it);
                return (
                  <DraftRow
                    key={it.key}
                    item={it}
                    siblingNames={siblingNames}
                    occupier={occupier}
                    onChange={(patch) => setItemByKey(it.key, patch)}
                    onValidate={() => validateItem(it)}
                    onDelete={() => deleteItem(it)}
                    onDismiss={() => dismissItem(it.key)}
                  />
                );
              })}
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
  siblingNames,
  occupier,
  onChange,
  onValidate,
  onDelete,
  onDismiss,
}: {
  item: DraftItem;
  /** Noms des autres drafts qui ciblent la même ligne Excel (collision).
   *  Quand non-vide → badge ⚠️ + warning visible dans la review. */
  siblingNames: string[];
  /** Facture déjà rapprochée à la même ligne (verte dans Excel). Quand
   *  présente → badge rouge "ligne déjà prise" + confirm à la validation. */
  occupier: Invoice | null;
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
            {siblingNames.length > 0 && item.status === "drafted" && (
              <span
                className="badge warn inline-flex items-center gap-1 text-[10px]"
                title={`Cette facture cible la même ligne Excel que ${siblingNames.length} autre(s) : ${siblingNames.join(", ")}. Valider celle-ci supprimera automatiquement les autres.`}
              >
                <AlertCircle size={10} /> Doublon avec {siblingNames.length} autre
                {siblingNames.length > 1 ? "s" : ""}
              </span>
            )}
            {occupier && item.status === "drafted" && (
              <span
                className="badge err inline-flex items-center gap-1 text-[10px]"
                title={`La ligne Excel #${item.rowInput} ${item.currencyInput} ${item.invoiceDateInput.slice(0, 7)} est déjà prise par ${occupier.finalName ?? occupier.creditor ?? occupier.id}. Valider va remplacer ce match — l'ancienne facture sera dégradée.`}
              >
                <AlertCircle size={10} /> Ligne déjà prise par{" "}
                {occupier.creditor ?? "une autre facture"}
              </span>
            )}
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

          {/* Ligne 2 : données extraites éditables. L'utilisateur peut
              corriger ce que l'auto-extract a sorti, et la correction
              propage : 1) nom Drive recalculé, 2) folder mapping sauvé
              en cache (créditeur → code) au moment du Valider. */}
          {inv && item.status === "drafted" && (
            <EditableExtractedFields item={item} onChange={onChange} />
          )}

          {/* Ligne 2bis : montant (pas éditable — vient de l'Excel à la
              validation, l'override ici n'aurait pas d'effet utile). */}
          {inv && (
            <div className="text-[11px] text-muted">
              <span>Montant extrait : </span>
              <span className="text-text">
                {formatAmount(inv.amount, inv.currency)}
              </span>
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

/**
 * Champs éditables pour Créditeur / Date / Code dossier / Nom Drive.
 * Pré-remplis depuis l'auto-extract. Si l'utilisateur modifie un des 3
 * premiers, on recalcule automatiquement le finalName (sauf s'il a
 * déjà été édité manuellement, auquel cas on respecte son override).
 */
function EditableExtractedFields({
  item,
  onChange,
}: {
  item: DraftItem;
  onChange: (patch: Partial<DraftItem>) => void;
}) {
  // Si l'utilisateur a édité le finalName manuellement, on ne le réécrase
  // pas en changeant créditeur/date/code. Heuristique : si finalName diffère
  // du calcul auto à partir des champs courants, c'est qu'il a été modifié.
  const autoName = buildFinalName(
    item.invoiceDateInput,
    item.creditorInput,
    item.folderCodeInput,
  );
  const finalNameWasEdited =
    item.finalNameInput.trim() !== "" &&
    item.finalNameInput !== autoName;

  const recompute = (patch: Partial<DraftItem>) => {
    const next: DraftItem = { ...item, ...patch };
    if (!finalNameWasEdited) {
      const newAuto = buildFinalName(
        next.invoiceDateInput,
        next.creditorInput,
        next.folderCodeInput,
      );
      if (newAuto) next.finalNameInput = newAuto;
    }
    onChange(next);
  };

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr_120px_120px] gap-2">
        <label className="text-[11px] flex items-center gap-2">
          <span className="text-muted w-16 shrink-0">Créditeur</span>
          <input
            type="text"
            value={item.creditorInput}
            onChange={(e) => recompute({ creditorInput: e.target.value })}
            placeholder="Nom du fournisseur"
            className="input !py-1 !px-2 text-[11px] flex-1"
            title="Modifie si le nom extrait du PDF est faux. Le mapping créditeur → code sera sauvé pour le prochain upload du même fournisseur."
          />
        </label>
        <label className="text-[11px] flex items-center gap-2">
          <span className="text-muted shrink-0">Date</span>
          <input
            type="date"
            value={item.invoiceDateInput}
            onChange={(e) => recompute({ invoiceDateInput: e.target.value })}
            className="input !py-1 !px-2 text-[11px] flex-1"
            title="Date de la facture (YYYY-MM-DD)"
          />
        </label>
        <label className="text-[11px] flex items-center gap-2">
          <span className="text-muted shrink-0">Code</span>
          <input
            type="text"
            value={item.folderCodeInput}
            onChange={(e) => recompute({ folderCodeInput: e.target.value })}
            placeholder="6100"
            className="input !py-1 !px-2 text-[11px] font-mono flex-1"
            title="Code comptable (ex. 6100). Sera utilisé pour le mapping créditeur → code en cache."
          />
        </label>
      </div>
      <label className="text-[11px] flex items-center gap-2">
        <span className="text-muted w-16 shrink-0">Nom Drive</span>
        <input
          type="text"
          value={item.finalNameInput}
          onChange={(e) => onChange({ finalNameInput: e.target.value })}
          placeholder={
            autoName ?? "Sera construit depuis date / créditeur / code"
          }
          className="input !py-1 !px-2 text-[11px] font-mono flex-1"
          title="Nom final sur Drive (sans .pdf). Édite si la composition auto ne te convient pas."
        />
        <span className="text-[10px] text-muted shrink-0">.pdf</span>
      </label>
    </div>
  );
}
