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
  /** Diagnostics : nombre d'essais auto, dernière erreur, dernier tic du pipeline. */
  retryCount?: number;
  lastError?: string | null;
  lastProcessedAt?: string | null;
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
  added: number;        // factures insérées initialement
  skipped: number;      // mails déjà vus (dedup Gmail)
  deduped?: number;     // factures supprimées par le dedup auto (facture+reçu)
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
 *
 * Cadence EMP : virements hebdomadaires. Chaque statement = 1 semaine.
 * EMP retient 10 % du gross en "Rolling Reserve", reversé 6 mois plus
 * tard. Donc pour chaque période on a à la fois :
 *  - une retenue (rollingReservePercent × capturedAmount)
 *  - une libération d'une période d'il y a ~26 semaines (releasedReserveAmount)
 *
 * Données financières supplémentaires (extraites du Billing Statement) :
 * - refundAmount / chargebackAmount : montants débités (déduits du gross).
 * - interchangeAmount / schemeAmount : frais pass-through Visa/MC, copiés
 *   depuis le statement (variables par période, pas un %).
 * - releasedReserveAmount : reserves libérées de la période ~6 mois en
 *   arrière (ajoutées au Net car argent qui revient sur le compte).
 * - payoutAmountEur : montant exact viré par EMP sur le compte bancaire EUR.
 *   Quand > 0, c'est la source de vérité pour l'affichage EUR (court-circuite
 *   le FX statique pour intégrer le markup FX du processeur).
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
  refundAmount: number;     // montant total remboursé sur la période
  chargebackAmount: number; // montant total des chargebacks sur la période
  interchangeAmount: number; // pass-through Interchange Fees (statement)
  schemeAmount: number;      // pass-through Scheme Fees (Visa/MC, statement)
  releasedReserveAmount: number; // reserves libérées d'une période d'il y a 6 mois
  payoutAmountEur: number;  // montant viré sur le compte bancaire EUR
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
  refundAmount: 0,
  chargebackAmount: 0,
  interchangeAmount: 0,
  schemeAmount: 0,
  releasedReserveAmount: 0,
  payoutAmountEur: 0,       // 0 = pas renseigné, on retombe sur le FX statique
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
  /** Taux Interchange (pass-through) — % du capturé. Variable selon les
   *  cartes utilisées. Sert de fallback quand interchangeAmount = 0. */
  interchangeRate: number;
  /** Taux Scheme (Visa/MC, pass-through) — % du capturé. Fallback. */
  schemeRate: number;
  monthlyServiceFee: number;
  monthlySecureCodeFee: number;
  wireTransferFee: number;
};

export const DEFAULT_FEE_RATES: FeeRates = {
  authFee: 0,            // EMP ne facture pas d'auth fee séparée pour ce compte
  captureFee: 0.27,      // EMP "Sale Approved" rate vu sur statement réel
  declinedFee: 0.16,     // EMP "Sale Declined"
  refundFee: 0.55,       // EMP "Refund Approved"
  chargebackFee: 35.0,
  retrievalFee: 9.0,
  preArbitrationFee: 24.95,
  percentRate: 3.0,
  interchangeRate: 1.5,  // ~1.5% du gross sur statements EMP réels
  schemeRate: 1.5,       // ~1.5% du gross sur statements EMP réels
  monthlyServiceFee: 19.95,
  monthlySecureCodeFee: 19.95,
  wireTransferFee: 5.0,
};

/**
 * Calcule le total des frais à partir des compteurs + rates + capturé.
 *
 * Le total inclut :
 * - frais par transaction (auth, capture, declined, refund, etc.)
 * - markup IC++ du processeur (% sur le capturé)
 * - pass-through Interchange + Scheme (montants exacts du statement)
 * - frais fixes mensuels (service, secure code, wires)
 */
export function computeTotalFees(
  counts: TxCounts,
  rates: FeeRates,
  capturedAmount: number,
): number {
  // Interchange + Scheme : si l'utilisateur a renseigné le montant exact
  // depuis le statement, on l'utilise. Sinon fallback à % × captured.
  const interchangeAuto = (capturedAmount * rates.interchangeRate) / 100;
  const schemeAuto = (capturedAmount * rates.schemeRate) / 100;
  const interchange =
    (counts.interchangeAmount ?? 0) > 0
      ? counts.interchangeAmount
      : interchangeAuto;
  const scheme =
    (counts.schemeAmount ?? 0) > 0 ? counts.schemeAmount : schemeAuto;

  return round2(
    authCount(counts) * rates.authFee + // toutes les soumissions au réseau
      counts.captured * rates.captureFee +
      counts.declined * rates.declinedFee +
      counts.refund * rates.refundFee +
      counts.chargeback * rates.chargebackFee +
      counts.retrievalRequest * rates.retrievalFee +
      counts.preArbitration * rates.preArbitrationFee +
      (capturedAmount * rates.percentRate) / 100 +
      interchange +
      scheme +
      rates.monthlyServiceFee +
      rates.monthlySecureCodeFee +
      counts.wires * rates.wireTransferFee, // 4 wires × tarif par défaut
  );
}

/**
 * Renvoie les montants effectifs d'Interchange / Scheme — soit l'override
 * utilisateur (counts), soit le calcul auto via % × captured.
 * Utile côté UI pour afficher les valeurs réellement utilisées dans le
 * Total des frais.
 */
export function effectiveInterchangeAmount(
  counts: TxCounts,
  rates: FeeRates,
  capturedAmount: number,
): number {
  const ovr = counts.interchangeAmount ?? 0;
  return ovr > 0
    ? ovr
    : round2((capturedAmount * rates.interchangeRate) / 100);
}

export function effectiveSchemeAmount(
  counts: TxCounts,
  rates: FeeRates,
  capturedAmount: number,
): number {
  const ovr = counts.schemeAmount ?? 0;
  return ovr > 0 ? ovr : round2((capturedAmount * rates.schemeRate) / 100);
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
