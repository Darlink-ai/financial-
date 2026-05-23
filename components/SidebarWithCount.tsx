"use client";

import { useStore } from "@/lib/store";
import { Sidebar } from "./Sidebar";

export function SidebarWithCount({ userEmail = null }: { userEmail?: string | null }) {
  const { invoices } = useStore();
  const count = invoices.filter((i) => i.status === "manual").length;
  return <Sidebar manualCount={count} userEmail={userEmail} />;
}
