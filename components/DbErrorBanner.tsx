"use client";

import { useStore } from "@/lib/store";
import { AlertCircle, Database } from "lucide-react";

export function DbErrorBanner() {
  const { dbError, reloadFromDb } = useStore();
  if (!dbError) return null;

  return (
    <div className="px-8 pt-6">
      <div className="card border-warn/40 bg-warn/5 p-4 flex items-start gap-3">
        <AlertCircle size={18} className="text-warn shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold text-warn flex items-center gap-2">
            <Database size={14} /> Base de données injoignable
          </div>
          <div className="text-[12px] text-muted mt-1 leading-relaxed">
            {dbError.message}
          </div>
          <div className="text-[11px] text-muted mt-3 font-mono leading-relaxed">
            Démarrage local : <code className="text-text">supabase start</code> puis{" "}
            <code className="text-text">supabase db reset</code>.<br />
            Voir <code className="text-text">DEPLOY.md</code> pour le détail.
          </div>
          <button onClick={reloadFromDb} className="btn text-[12px] mt-3">
            Réessayer
          </button>
        </div>
      </div>
    </div>
  );
}
