import type { InvoiceStatus } from "@/lib/types";

const map: Record<InvoiceStatus, { label: string; tone: "info" | "warn" | "ok" | "err" }> = {
  fetched: { label: "Récupérée", tone: "info" },
  analyzing: { label: "Analyse…", tone: "info" },
  classified: { label: "Classée", tone: "info" },
  renamed: { label: "Renommée", tone: "info" },
  uploaded: { label: "Sur Drive", tone: "ok" },
  matched: { label: "Excel ✓", tone: "ok" },
  manual: { label: "Manuel", tone: "warn" },
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  const cfg = map[status];
  return <span className={`badge ${cfg.tone}`}>{cfg.label}</span>;
}
