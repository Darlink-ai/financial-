"use client";

import { useRef, useState } from "react";
import { Upload, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useStore } from "@/lib/store";
import { parseDirectFileName } from "@/lib/direct-file-name";
import { formatSignedAmount } from "@/lib/excel-row-display";

type Item = {
  key: string;
  fileName: string;
  target: string | null;
  status: "waiting" | "working" | "done" | "failed";
  message?: string;
  finalName?: string | null;
  amount?: number | null;
  driveOk?: boolean;
};

const MONTHS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/**
 * « Facture (renommée) » : les fichiers sont nommés « mois - devise - ligne ».
 * Chacun est classé directement sur cette ligne du relevé, sans lecture du PDF.
 */
export function DirectClassify() {
  const { reloadFromDb } = useStore();
  const [items, setItems] = useState<Item[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = (key: string, p: Partial<Item>) =>
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));

  const handleFiles = (files: FileList | File[]) => {
    const arr = Array.from(files).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (arr.length === 0) return;
    const stamp = Date.now();
    const fresh: Item[] = arr.map((f, i) => {
      const p = parseDirectFileName(f.name);
      return {
        key: `${stamp}-${i}-${f.name}`,
        fileName: f.name,
        target: p.ok
          ? `${MONTHS_FR[Number(p.month.slice(5)) - 1]} ${p.month.slice(0, 4)} · ${p.currency} · ligne ${p.row}`
          : null,
        status: p.ok ? "waiting" : "failed",
        message: p.ok ? undefined : p.reason,
      };
    });
    setItems((prev) => [...fresh, ...prev]);
    void (async () => {
      for (let i = 0; i < arr.length; i++) {
        const it = fresh[i];
        if (it.status === "failed") continue;
        patch(it.key, { status: "working" });
        try {
          const fd = new FormData();
          fd.append("file", arr[i]);
          const r = await fetch("/api/invoices/direct-classify", { method: "POST", body: fd });
          const data = (await r.json().catch(() => null)) as {
            ok?: boolean;
            message?: string;
            finalName?: string | null;
            amount?: number | null;
            drive?: { uploaded?: boolean; reason?: string };
          } | null;
          if (!r.ok || !data?.ok) {
            patch(it.key, { status: "failed", message: data?.message ?? `HTTP ${r.status}` });
            continue;
          }
          patch(it.key, {
            status: "done",
            finalName: data.finalName,
            amount: data.amount,
            driveOk: data.drive?.uploaded === true,
            message: data.drive?.uploaded
              ? undefined
              : `Classée, mais pas envoyée sur Drive (${data.drive?.reason ?? "raison inconnue"})`,
          });
        } catch (e) {
          patch(it.key, { status: "failed", message: (e as Error).message });
        }
      }
      await reloadFromDb();
    })();
  };

  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "failed").length;

  return (
    <>
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
        <div className="text-[15px] font-medium">Glisse tes factures renommées ici</div>
        <div className="text-[12px] text-muted mt-1">
          Nom du fichier : <span className="font-mono text-text">mois - devise - n° de ligne</span>,
          par exemple <span className="font-mono text-text">octobre - EUR - 185.pdf</span>. Chaque
          facture est classée directement sur cette ligne et envoyée sur Drive.
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
          <div className="px-5 py-3 border-b border-border text-[13px] flex items-center gap-3">
            <span className="font-medium">{items.length} fichier{items.length > 1 ? "s" : ""}</span>
            {done > 0 && <span className="badge ok">{done} classé{done > 1 ? "s" : ""}</span>}
            {failed > 0 && <span className="badge err">{failed} refusé{failed > 1 ? "s" : ""}</span>}
          </div>
          <div className="divide-y divide-border">
            {items.map((it) => (
              <div key={it.key} className="px-5 py-3 flex items-center gap-3 text-[13px]">
                <span className="shrink-0">
                  {it.status === "done" ? (
                    <CheckCircle2 size={16} className={it.driveOk ? "text-ok" : "text-warn"} />
                  ) : it.status === "failed" ? (
                    <AlertCircle size={16} className="text-err" />
                  ) : (
                    <Loader2 size={16} className={`text-muted ${it.status === "working" ? "animate-spin" : ""}`} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium" title={it.fileName}>
                    {it.status === "done" && it.finalName ? it.finalName : it.fileName}
                  </div>
                  <div className="text-[12px] text-muted truncate">
                    {it.target ?? it.fileName}
                    {it.message && (
                      <span className={it.status === "failed" ? "text-err" : "text-warn"}>
                        {" — "}
                        {it.message}
                      </span>
                    )}
                  </div>
                </div>
                {it.status === "done" && (
                  <span className="tabular-nums font-medium shrink-0">
                    {formatSignedAmount(it.amount ?? null)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
