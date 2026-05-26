"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import type {
  Invoice,
  Mailbox,
  FolderMapping,
  DriveConfig,
  Business,
  Revenue,
  AccountCurrency,
} from "./types";
import { DEFAULT_ACCOUNT_CURRENCY } from "./types";

function defaultMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export type DbInfo = {
  file: string;
  sizeBytes: number;
  counts: {
    businesses: number;
    mailboxes: number;
    mappings: number;
    invoices: number;
    revenues: number;
  };
};

export type DbError = { kind: "unreachable"; message: string } | null;

type Store = {
  ready: boolean;
  dbInfo: DbInfo | null;
  dbError: DbError;
  mailboxes: Mailbox[];
  invoices: Invoice[];
  mappings: FolderMapping[];
  drive: DriveConfig;
  businesses: Business[];
  revenues: Revenue[];
  selectedMonth: string;
  selectedBusinessId: string | "all";
  selectedAccountCurrency: AccountCurrency;
  setSelectedMonth: (m: string) => void;
  setSelectedBusinessId: (id: string | "all") => void;
  setSelectedAccountCurrency: (c: AccountCurrency) => void;
  updateInvoice: (id: string, patch: Partial<Invoice>) => void;
  addMailbox: (m: Mailbox) => void;
  removeMailbox: (id: string) => void;
  toggleMailbox: (id: string) => void;
  addMapping: (m: FolderMapping) => void;
  updateMapping: (id: string, patch: Partial<FolderMapping>) => void;
  removeMapping: (id: string) => void;
  setDrive: (d: Partial<DriveConfig>) => void;
  addRevenue: (r: Revenue) => void;
  updateRevenue: (id: string, patch: Partial<Revenue>) => void;
  removeRevenue: (id: string) => void;
  addBusiness: (b: Business) => void;
  updateBusiness: (id: string, patch: Partial<Business>) => void;
  removeBusiness: (id: string) => void;
  resetDatabase: () => Promise<void>;
  reloadFromDb: () => Promise<void>;
};

const StoreContext = createContext<Store | null>(null);

async function api<T>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T | null> {
  try {
    const r = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      console.error(`API ${method} ${url} failed`, r.status);
      return null;
    }
    return (await r.json()) as T;
  } catch (e) {
    console.error(`API ${method} ${url} error`, e);
    return null;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [dbError, setDbError] = useState<DbError>(null);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [mappings, setMappings] = useState<FolderMapping[]>([]);
  const [drive, setDriveState] = useState<DriveConfig>({
    provider: null,
    connected: false,
    rootPath: null,
  });
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [revenues, setRevenues] = useState<Revenue[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>(defaultMonth());
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | "all">("all");
  const [selectedAccountCurrency, setSelectedAccountCurrency] = useState<AccountCurrency>(
    DEFAULT_ACCOUNT_CURRENCY,
  );

  const reloadFromDb = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.status === 401) {
        // Session expirée → renvoie au login.
        if (typeof window !== "undefined") window.location.href = "/login";
        return;
      }
      if (!r.ok) {
        const body = (await r.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        setDbError({
          kind: "unreachable",
          message:
            body?.message ??
            "Postgres injoignable. Lance `supabase start` localement ou vérifie DATABASE_URL.",
        });
        setReady(false);
        return;
      }
      const data = await r.json();
      setMailboxes(data.mailboxes);
      setInvoices(data.invoices);
      setMappings(data.mappings);
      setDriveState(data.drive);
      setBusinesses(data.businesses);
      setRevenues(data.revenues);
      setDbInfo(data._info ?? null);
      setDbError(null);
      setReady(true);
    } catch (e) {
      setDbError({
        kind: "unreachable",
        message: `Erreur réseau : ${(e as Error).message}`,
      });
      setReady(false);
    }
  }, []);

  useEffect(() => {
    void reloadFromDb();
  }, [reloadFromDb]);

  // ---- Revenues ----
  const addRevenue = useCallback((r: Revenue) => {
    setRevenues((prev) => [...prev, r]);
    void api("/api/revenues", "POST", r);
  }, []);
  const updateRevenue = useCallback((id: string, patch: Partial<Revenue>) => {
    setRevenues((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    void api(`/api/revenues/${id}`, "PATCH", patch);
  }, []);
  const removeRevenue = useCallback((id: string) => {
    setRevenues((prev) => prev.filter((r) => r.id !== id));
    void api(`/api/revenues/${id}`, "DELETE");
  }, []);

  // ---- Businesses ----
  const addBusiness = useCallback((b: Business) => {
    setBusinesses((prev) => [...prev, b]);
    void api("/api/businesses", "POST", b);
  }, []);
  const updateBusiness = useCallback((id: string, patch: Partial<Business>) => {
    setBusinesses((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    void api(`/api/businesses/${id}`, "PATCH", patch);
  }, []);
  const removeBusiness = useCallback((id: string) => {
    setBusinesses((prev) => prev.filter((b) => b.id !== id));
    void api(`/api/businesses/${id}`, "DELETE");
  }, []);

  // ---- Mailboxes ----
  const addMailbox = useCallback((m: Mailbox) => {
    setMailboxes((prev) => [...prev, m]);
    void api("/api/mailboxes", "POST", m);
  }, []);
  const removeMailbox = useCallback((id: string) => {
    setMailboxes((prev) => prev.filter((m) => m.id !== id));
    void api(`/api/mailboxes/${id}`, "DELETE");
  }, []);
  const toggleMailbox = useCallback((id: string) => {
    setMailboxes((prev) => {
      const next = prev.map((m) =>
        m.id === id
          ? {
              ...m,
              connected: !m.connected,
              lastSync: !m.connected ? new Date().toISOString() : m.lastSync,
            }
          : m,
      );
      const target = next.find((m) => m.id === id);
      if (target) {
        void api(`/api/mailboxes/${id}`, "PATCH", {
          connected: target.connected,
          lastSync: target.lastSync,
        });
      }
      return next;
    });
  }, []);

  // ---- Mappings ----
  const addMapping = useCallback((m: FolderMapping) => {
    setMappings((prev) => [...prev, m]);
    void api("/api/mappings", "POST", m);
  }, []);
  const updateMapping = useCallback((id: string, patch: Partial<FolderMapping>) => {
    setMappings((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
    void api(`/api/mappings/${id}`, "PATCH", patch);
  }, []);
  const removeMapping = useCallback((id: string) => {
    setMappings((prev) => prev.filter((m) => m.id !== id));
    void api(`/api/mappings/${id}`, "DELETE");
  }, []);

  // ---- Invoices ----
  const updateInvoice = useCallback((id: string, patch: Partial<Invoice>) => {
    setInvoices((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    void api(`/api/invoices/${id}`, "PATCH", patch);
  }, []);

  // ---- Drive ----
  const setDrive = useCallback((d: Partial<DriveConfig>) => {
    setDriveState((prev) => ({ ...prev, ...d }));
    void api("/api/drive", "PATCH", d);
  }, []);

  // ---- Reset ----
  const resetDatabase = useCallback(async () => {
    const r = await fetch("/api/reset", { method: "POST" });
    if (!r.ok) return;
    await reloadFromDb();
  }, [reloadFromDb]);

  const value = useMemo<Store>(
    () => ({
      ready,
      dbInfo,
      dbError,
      mailboxes,
      invoices,
      mappings,
      drive,
      businesses,
      revenues,
      selectedMonth,
      selectedBusinessId,
      selectedAccountCurrency,
      setSelectedMonth,
      setSelectedBusinessId,
      setSelectedAccountCurrency,
      updateInvoice,
      addMailbox,
      removeMailbox,
      toggleMailbox,
      addMapping,
      updateMapping,
      removeMapping,
      setDrive,
      addRevenue,
      updateRevenue,
      removeRevenue,
      addBusiness,
      updateBusiness,
      removeBusiness,
      resetDatabase,
      reloadFromDb,
    }),
    [
      ready,
      dbInfo,
      dbError,
      mailboxes,
      invoices,
      mappings,
      drive,
      businesses,
      revenues,
      selectedMonth,
      selectedBusinessId,
      selectedAccountCurrency,
      updateInvoice,
      addMailbox,
      removeMailbox,
      toggleMailbox,
      addMapping,
      updateMapping,
      removeMapping,
      setDrive,
      addRevenue,
      updateRevenue,
      removeRevenue,
      addBusiness,
      updateBusiness,
      removeBusiness,
      resetDatabase,
      reloadFromDb,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}

export function useInvoicesForCurrentMonth(): Invoice[] {
  const { invoices, selectedMonth, selectedAccountCurrency } = useStore();
  return useMemo(
    () =>
      invoices.filter((i) => {
        const ref = i.invoiceDate ?? i.receivedAt;
        if (monthOf(ref) !== selectedMonth) return false;
        // Si l'invoice n'a pas de account_currency (legacy), on la traite
        // comme USD (le default DB).
        const acc = i.accountCurrency ?? "USD";
        return acc === selectedAccountCurrency;
      }),
    [invoices, selectedMonth, selectedAccountCurrency],
  );
}

export function useRevenuesForCurrentMonth(): Revenue[] {
  const { revenues, selectedMonth, selectedBusinessId } = useStore();
  return useMemo(
    () =>
      revenues
        .filter((r) => r.month === selectedMonth)
        .filter((r) =>
          selectedBusinessId === "all" ? true : r.businessId === selectedBusinessId,
        ),
    [revenues, selectedMonth, selectedBusinessId],
  );
}

export function monthOf(isoDate: string): string {
  const d = new Date(isoDate);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(y, m - 1, 1);
  const label = d.toLocaleDateString("fr-CH", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
