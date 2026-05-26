"use client";

import { Wallet } from "lucide-react";
import { useStore } from "@/lib/store";
import { ACCOUNT_CURRENCIES } from "@/lib/types";

export function SidebarAccountSelector() {
  const { selectedAccountCurrency, setSelectedAccountCurrency } = useStore();

  return (
    <div className="px-3 pb-3 border-b border-border">
      <div className="text-[10px] uppercase tracking-wider text-muted px-1 pb-2 flex items-center gap-1.5">
        <Wallet size={11} />
        Compte
      </div>
      <div className="card p-1 flex items-center gap-1">
        {ACCOUNT_CURRENCIES.map((c) => (
          <button
            key={c}
            onClick={() => setSelectedAccountCurrency(c)}
            className={`flex-1 px-2 py-1 rounded-md text-[12px] font-medium font-mono transition-colors ${
              selectedAccountCurrency === c
                ? "bg-panel2 text-text border border-border"
                : "text-muted hover:text-text border border-transparent"
            }`}
          >
            {c}
          </button>
        ))}
      </div>
    </div>
  );
}
