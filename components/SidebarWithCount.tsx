"use client";

import { useStore } from "@/lib/store";
import { Sidebar } from "./Sidebar";

export function SidebarWithCount() {
  const { invoices, dbInfo, ready, resetDatabase } = useStore();
  const count = invoices.filter((i) => i.status === "manual").length;
  return (
    <Sidebar
      manualCount={count}
      dbInfo={dbInfo}
      ready={ready}
      onReset={resetDatabase}
    />
  );
}
