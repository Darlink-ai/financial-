"use client";

import { useStore } from "@/lib/store";
import { Layers } from "lucide-react";

export function BusinessSelector() {
  const { businesses, selectedBusinessId, setSelectedBusinessId } = useStore();

  return (
    <div className="card p-1 flex items-center gap-1">
      <button
        onClick={() => setSelectedBusinessId("all")}
        className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors flex items-center gap-1.5 ${
          selectedBusinessId === "all"
            ? "bg-panel2 text-text"
            : "text-muted hover:text-text"
        }`}
      >
        <Layers size={12} />
        Tout
      </button>
      {businesses.map((b) => (
        <button
          key={b.id}
          onClick={() => setSelectedBusinessId(b.id)}
          className={`px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors flex items-center gap-1.5 ${
            selectedBusinessId === b.id ? "bg-panel2 text-text" : "text-muted hover:text-text"
          }`}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: b.color }}
            aria-hidden
          />
          {b.name}
        </button>
      ))}
    </div>
  );
}

export function BusinessDot({ businessId, withName = false }: { businessId: string; withName?: boolean }) {
  const { businesses } = useStore();
  const b = businesses.find((x) => x.id === businessId);
  if (!b) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px]">
      <span
        className="w-2 h-2 rounded-full"
        style={{ background: b.color }}
        aria-hidden
      />
      {withName && <span>{b.name}</span>}
    </span>
  );
}
