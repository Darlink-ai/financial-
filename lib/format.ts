export function formatSwissDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}.${mm}.${yy}`;
}

export function formatRelative(iso: string): string {
  const now = Date.now();
  const t = new Date(iso).getTime();
  const diffSec = Math.round((now - t) / 1000);
  if (diffSec < 60) return "à l'instant";
  if (diffSec < 3600) return `il y a ${Math.floor(diffSec / 60)} min`;
  if (diffSec < 86_400) return `il y a ${Math.floor(diffSec / 3600)} h`;
  const days = Math.floor(diffSec / 86_400);
  if (days === 1) return "hier";
  return `il y a ${days} j`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

export function formatAmount(amount: number | null, currency: string | null): string {
  if (amount == null) return "—";
  const f = new Intl.NumberFormat("fr-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${f.format(amount)} ${currency ?? ""}`.trim();
}

export function buildFinalName(
  invoiceDate: string | null,
  creditor: string | null,
  folderCode: string | null,
): string | null {
  if (!invoiceDate || !creditor || !folderCode) return null;
  // Format : "Créditeur - JJ.MM.AA - CODE"
  // (créditeur en tête pour faciliter la recherche alphabétique dans Drive)
  return `${creditor} - ${formatSwissDate(invoiceDate)} - ${folderCode}`;
}
