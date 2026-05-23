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

/**
 * Comptage des transactions extraites du fichier upload (colonne 1 = statut).
 * Les noms suivent la nomenclature processeur (Adyen / Stripe…).
 */
export type TxCounts = {
  authorized: number;
  captured: number;
  declined: number;
  refund: number;
  chargeback: number;
  retrievalRequest: number;
  preArbitration: number;
};

export const EMPTY_TX_COUNTS: TxCounts = {
  authorized: 0,
  captured: 0,
  declined: 0,
  refund: 0,
  chargeback: 0,
  retrievalRequest: 0,
  preArbitration: 0,
};

/**
 * Décomposition des frais processeur. Chaque ligne est éditable côté UI.
 * Par défaut on précalcule `count × tarif unitaire` à partir des rates.
 */
export type FeeBreakdown = {
  authFee: number;
  captureFee: number;
  declinedFee: number;
  refundFee: number;
  chargebackFee: number;
  retrievalFee: number;
  preArbitrationFee: number;
  percentFee: number; // IC++ % du capturé
  monthlyServiceFee: number;
  monthlySecureCodeFee: number;
  wireTransferFee: number;
};

export const DEFAULT_FEE_RATES = {
  authFee: 0.15,
  captureFee: 0.10,
  declinedFee: 0.15,
  refundFee: 0.50,
  chargebackFee: 35.0,
  retrievalFee: 9.0,
  preArbitrationFee: 24.95,
  percentRate: 3.0, // % IC++ Visa/MC
  monthlyServiceFee: 19.95,
  monthlySecureCodeFee: 19.95,
  wireTransferFee: 5.0,
};

export const EMPTY_FEE_BREAKDOWN: FeeBreakdown = {
  authFee: 0,
  captureFee: 0,
  declinedFee: 0,
  refundFee: 0,
  chargebackFee: 0,
  retrievalFee: 0,
  preArbitrationFee: 0,
  percentFee: 0,
  monthlyServiceFee: 0,
  monthlySecureCodeFee: 0,
  wireTransferFee: 0,
};

export function computeFeesFromCounts(
  counts: TxCounts,
  capturedAmount: number,
  rates = DEFAULT_FEE_RATES,
): FeeBreakdown {
  return {
    authFee: round2(counts.authorized * rates.authFee),
    captureFee: round2(counts.captured * rates.captureFee),
    declinedFee: round2(counts.declined * rates.declinedFee),
    refundFee: round2(counts.refund * rates.refundFee),
    chargebackFee: round2(counts.chargeback * rates.chargebackFee),
    retrievalFee: round2(counts.retrievalRequest * rates.retrievalFee),
    preArbitrationFee: round2(counts.preArbitration * rates.preArbitrationFee),
    percentFee: round2((capturedAmount * rates.percentRate) / 100),
    monthlyServiceFee: rates.monthlyServiceFee,
    monthlySecureCodeFee: rates.monthlySecureCodeFee,
    wireTransferFee: rates.wireTransferFee,
  };
}

export function sumFees(b: FeeBreakdown): number {
  return round2(
    b.authFee +
      b.captureFee +
      b.declinedFee +
      b.refundFee +
      b.chargebackFee +
      b.retrievalFee +
      b.preArbitrationFee +
      b.percentFee +
      b.monthlyServiceFee +
      b.monthlySecureCodeFee +
      b.wireTransferFee,
  );
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

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
  txCounts: TxCounts; // nombre de transactions par statut (auto depuis le fichier, éditable)
  feeBreakdown: FeeBreakdown; // décomposition des frais processeur (éditable)
};
