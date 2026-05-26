"use client";

import { useInvoicesForCurrentMonth } from "@/lib/store";
import { Sidebar } from "./Sidebar";

export function SidebarWithCount({ userEmail = null }: { userEmail?: string | null }) {
  // On compte les factures "manual" du MOIS COURANT — comme ça le badge
  // de la sidebar reflète exactement ce que l'utilisateur verra en
  // cliquant sur "À traiter manuellement" (qui filtre aussi par mois).
  const monthInvoices = useInvoicesForCurrentMonth();
  const count = monthInvoices.filter((i) => i.status === "manual").length;
  return <Sidebar manualCount={count} userEmail={userEmail} />;
}
