export type InvoiceStatus =
  | "fetched"
  | "analyzing"
  | "classified"
  | "renamed"
  | "uploaded"
  | "matched"
  | "manual";

export type Invoice = {
  id: string;
  subject: string;
  fromEmail: string;
  mailbox: string;
  receivedAt: string; // ISO
  creditor: string | null;
  invoiceDate: string | null; // YYYY-MM-DD
  amount: number | null;
  currency: string | null;
  folderCode: string | null; // e.g. "6100"
  folderLabel: string | null; // e.g. "Frais informatique"
  finalName: string | null; // "22.05.26 - Runpod - 6100"
  drivePath: string | null;
  status: InvoiceStatus;
  excelRowMatched: number | null;
  attachment: { name: string; sizeBytes: number; pages: number } | null;
};

export type Mailbox = {
  id: string;
  email: string;
  provider: "gmail" | "outlook" | "imap";
  connected: boolean;
  invoicesFound: number;
  lastSync: string | null;
};

export type FolderMapping = {
  id: string;
  creditorPattern: string; // e.g. "Runpod"
  folderCode: string; // e.g. "6100"
  folderLabel: string; // e.g. "Frais informatique"
  notes?: string;
};

export type DriveConfig = {
  provider: "google" | "dropbox" | "onedrive" | null;
  connected: boolean;
  rootPath: string | null;
};

export type ExcelMatch = {
  rowIndex: number;
  matched: boolean;
  invoiceId: string | null;
  cells: (string | number | null)[];
};

export type Business = {
  id: string;
  name: string; // "Link", "Ify"
  color: string; // hex / tailwind color for the badge
  processor: string; // default payment processor (Stripe, etc.)
};

export type CountryRevenue = {
  country: string;
  amount: number;
};

export type Revenue = {
  id: string;
  businessId: string;
  month: string; // "YYYY-MM"
  processor: string; // payment processor name
  currency: string;
  capturedAmount: number; // total captured by processor
  fees: number; // processor fees
  rollingReservePercent: number; // % du capturé retenu en réserve
  rollingReserveMonths: number; // duration of the reserve in months
  releasedAt: string | null; // ISO date when reserve will be released (optional, computed)
  notes?: string;
  countryBreakdown: CountryRevenue[]; // uploaded country/amount file
  countryFileName: string | null;
  validatedAt: string | null; // ISO timestamp when entry was locked-in (Enregistrer)
};
