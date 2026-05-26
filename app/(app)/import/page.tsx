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
  X,
  Trash2,
} from "lucide-react";

type ItemStatus = "pending" | "uploading" | "done" | "failed";

type FileItem = {
  file: File;
  status: ItemStatus;
  outcomeStatus?: string;
  message?: string;
};

export default function ImportPage() {
  const { reloadFromDb } = useStore();
  const [items, setItems] = useState<FileItem[]>([]);
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) =>
      f.name.toLowerCase().endsWith(".pdf"),
    );
    if (arr.length === 0) {
      alert("Seuls les fichiers .pdf sont acceptés.");
      return;
    }
    setItems((prev) => [
      ...prev,
      ...arr.map((f) => ({ file: f, status: "pending" as ItemStatus })),
    ]);
  };

  const removeItem = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const clearAll = () => {
    if (processing) return;
    setItems([]);
  };

  const updateItem = (idx: number, patch: Partial<FileItem>) => {
    setItems((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    );
  };

  const processAll = async () => {
    setProcessing(true);
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.status === "done") continue;
      updateItem(i, { status: "uploading", message: undefined });

      const fd = new FormData();
      fd.append("file", it.file);

      try {
        const r = await fetch("/api/invoices/upload", {
          method: "POST",
          body: fd,
        });
        const data = (await r.json().catch(() => null)) as
          | {
              ok?: boolean;
              outcome?: { status?: string; errors?: string[] };
              message?: string;
            }
          | null;
        if (!r.ok || !data?.ok) {
          updateItem(i, {
            status: "failed",
            message: data?.message ?? `HTTP ${r.status}`,
          });
        } else {
          updateItem(i, {
            status: "done",
            outcomeStatus: data.outcome?.status,
            message:
              data.outcome?.errors && data.outcome.errors.length > 0
                ? data.outcome.errors[0]
                : undefined,
          });
        }
      } catch (e) {
        updateItem(i, {
          status: "failed",
          message: (e as Error).message,
        });
      }
    }
    setProcessing(false);
    await reloadFromDb();
  };

  const pendingCount = items.filter(
    (i) => i.status === "pending" || i.status === "failed",
  ).length;
  const doneCount = items.filter((i) => i.status === "done").length;
  const failedCount = items.filter((i) => i.status === "failed").length;

  return (
    <>
      <PageHeader
        title="Ajout manuel"
        subtitle="Glisse-dépose des PDFs de factures que tu n'as pas reçues par mail. Chaque fichier passera par le même pipeline qu'un sync Gmail : extraction → classification → upload Drive → match Excel."
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
            if (e.dataTransfer.files.length > 0) addFiles(e.dataTransfer.files);
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
            Plusieurs fichiers acceptés. Tu peux en mettre 20+ d'un coup —
            ils seront traités séquentiellement.
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {/* Liste des fichiers staged */}
        {items.length > 0 && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-border gap-3 flex-wrap">
              <div className="text-[13px]">
                <span className="font-medium">
                  {items.length} fichier{items.length > 1 ? "s" : ""}
                </span>
                <span className="text-muted ml-2">
                  · {doneCount} traité{doneCount > 1 ? "s" : ""} · {pendingCount}{" "}
                  en attente
                  {failedCount > 0 && (
                    <span className="text-err"> · {failedCount} échec{failedCount > 1 ? "s" : ""}</span>
                  )}
                </span>
              </div>
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={clearAll}
                  disabled={processing}
                  className="btn disabled:opacity-50"
                >
                  <Trash2 size={12} /> Vider
                </button>
                <button
                  onClick={processAll}
                  disabled={processing || pendingCount === 0}
                  className="btn btn-primary disabled:opacity-50"
                >
                  {processing ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" /> Traitement…
                    </>
                  ) : (
                    <>
                      Traiter {pendingCount} fichier{pendingCount > 1 ? "s" : ""}
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="divide-y divide-border">
              {items.map((it, idx) => (
                <div
                  key={`${it.file.name}-${idx}`}
                  className="px-5 py-3 flex items-center gap-3"
                >
                  <FileText size={16} className="text-muted shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] truncate">{it.file.name}</div>
                    <div className="text-[11px] text-muted truncate">
                      {(it.file.size / 1024).toFixed(1)} ko
                      {it.outcomeStatus && (
                        <>
                          {" · "}
                          status{" "}
                          <span className="font-mono text-text">
                            {it.outcomeStatus}
                          </span>
                        </>
                      )}
                      {it.message && (
                        <span className="text-warn"> · {it.message}</span>
                      )}
                    </div>
                  </div>
                  {it.status === "pending" && (
                    <span className="badge">En attente</span>
                  )}
                  {it.status === "uploading" && (
                    <span className="badge info inline-flex items-center gap-1">
                      <RefreshCw size={11} className="animate-spin" /> En cours
                    </span>
                  )}
                  {it.status === "done" && (
                    <span className="badge ok inline-flex items-center gap-1">
                      <CheckCircle2 size={11} /> Traité
                    </span>
                  )}
                  {it.status === "failed" && (
                    <span className="badge err inline-flex items-center gap-1">
                      <AlertCircle size={11} /> Échec
                    </span>
                  )}
                  {(it.status === "pending" || it.status === "failed") &&
                    !processing && (
                      <button
                        onClick={() => removeItem(idx)}
                        className="btn !px-2 !py-1"
                        title="Retirer de la liste"
                      >
                        <X size={12} />
                      </button>
                    )}
                </div>
              ))}
            </div>
            {doneCount > 0 && !processing && (
              <div className="px-5 py-3 border-t border-border text-[12px] text-muted">
                {doneCount} facture{doneCount > 1 ? "s" : ""} traitée
                {doneCount > 1 ? "s" : ""}. Va sur{" "}
                <a
                  href="/invoices"
                  className="text-accent hover:underline"
                >
                  Factures
                </a>{" "}
                pour les voir, ou{" "}
                <a
                  href="/manual"
                  className="text-accent hover:underline"
                >
                  À traiter manuellement
                </a>{" "}
                pour celles dont l'extraction n'a pas pu aboutir.
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
