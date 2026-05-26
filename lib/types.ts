/** Comptes bancaires de l'utilisateur — chaque facture et chaque fichier
 *  de rapprochement Excel est rattaché à l'un d'eux. */
export type AccountCurrency = "USD" | "EUR" | "CHF";

export const ACCOUNT_CURRENCIES: AccountCurrency[] = ["USD", "EUR", "CHF"];
export const DEFAULT_ACCOUNT_CURRENCY: AccountCurrency = "USD";

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
  accountCurrency: AccountCurrency;
};

export type Mailbox = {
  id: string;
  email: string;
  provider: "gmail" | "outlook" | "imap";
  connected: boolean;
  invoicesFound: number;
  lastSync: string | null;
  syncEnabled: boolean;              // inclure dans le cron de synchro
  // OAuth (Google pour l'instant) — credentials et tokens stockés par boîte.
  oauthClientId: string | null;      // visible côté client (OK)
  hasOauthSecret: boolean;           // jamais le secret lui-même côté client
  oauthUserEmail: string | null;     // email tel que renvoyé par Google après consent
  oauthExpiresAt: string | null;     // ISO de l'expiration du access_token
  oauthScope: string | null;
  hasRefreshToken: boolean;          // jamais le token lui-même côté client
};

export type SyncRun = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: "cron" | "manual";
  results: SyncRunResult[];
  totalAdded: number;
  totalSkipped: number;
  error: string | null;
};

export type SyncRunResult = {
  mailboxId: string;
  mailboxEmail: string;
  added: number;
  skipped: number;
  totalMessages: number;
  error?: string;
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
  authorized: number;       // pre-auths qui n'ont jamais été capturées
  captured: number;
  declined: number;
  refund: number;
  chargeback: number;
  retrievalRequest: number;
  preArbitration: number;
  wires: number;            // nb de virements bancaires sortants / mois
};

export const EMPTY_TX_COUNTS: TxCounts = {
  authorized: 0,
  captured: 0,
  declined: 0,
  refund: 0,
  chargeback: 0,
  retrievalRequest: 0,
  preArbitration: 0,
  wires: 4,                 // 4 virements par défaut (modifiable)
};

/**
 * Total des transactions soumises au réseau (Visa/MC) — un frais d'auth
 * est facturé pour chaque soumission, peu importe l'issue.
 */
export function authCount(counts: TxCounts): number {
  return counts.captured + counts.declined + counts.authorized;
}

/**
 * Tarifs unitaires des frais processeur. Tout est éditable côté UI ;
 * les "frais" affichés ligne par ligne sont count × rate calculés.
 *
 * - per-tx fees : prix par transaction du bucket correspondant
 * - percentRate : % IC++ appliqué sur le capturé
 * - monthly* / wireTransfer : frais fixes (pas de count)
 */
export type FeeRates = {
  authFee: number;
  captureFee: number;
  declinedFee: number;
  refundFee: number;
  chargebackFee: number;
  retrievalFee: number;
  preArbitrationFee: number;
  percentRate: number;
  monthlyServiceFee: number;
  monthlySecureCodeFee: number;
  wireTransferFee: number;
};

export const DEFAULT_FEE_RATES: FeeRates = {
  authFee: 0.15,
  captureFee: 0.10,
  declinedFee: 0.15,
  refundFee: 0.50,
  chargebackFee: 35.0,
  retrievalFee: 9.0,
  preArbitrationFee: 24.95,
  percentRate: 3.0,
  monthlyServiceFee: 19.95,
  monthlySecureCodeFee: 19.95,
  wireTransferFee: 5.0,
};

/**
 * Calcule le total des frais à partir des compteurs + rates + capturé.
 */
export function computeTotalFees(
  counts: TxCounts,
  rates: FeeRates,
  capturedAmount: number,
): number {
  return round2(
    authCount(counts) * rates.authFee + // toutes les soumissions au réseau
      counts.captured * rates.captureFee +
      counts.declined * rates.declinedFee +
      counts.refund * rates.refundFee +
      counts.chargeback * rates.chargebackFee +
      counts.retrievalRequest * rates.retrievalFee +
      counts.preArbitration * rates.preArbitrationFee +
      (capturedAmount * rates.percentRate) / 100 +
      rates.monthlyServiceFee +
      rates.monthlySecureCodeFee +
      counts.wires * rates.wireTransferFee, // 4 wires × tarif par défaut
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
  txCounts: TxCounts; // compteurs par statut, depuis le fichier (lecture seule)
  feeRates: FeeRates; // tarifs unitaires éditables par revenu
};
