import type {
  Invoice,
  Mailbox,
  FolderMapping,
  DriveConfig,
  Business,
  Revenue,
} from "./types";
import { DEFAULT_FEE_RATES, EMPTY_TX_COUNTS } from "./types";

export const mockBusinesses: Business[] = [
  { id: "biz-link", name: "Link", color: "#7c9cff", processor: "Stripe" },
  { id: "biz-ify", name: "Ify", color: "#f59e0b", processor: "Stripe" },
];

export const mockRevenues: Revenue[] = [
  {
    id: "rev-link-202605",
    businessId: "biz-link",
    month: "2026-05",
    processor: "Stripe",
    currency: "USD",
    capturedAmount: 48_500.0,
    fees: 1_456.5,
    rollingReservePercent: 10,
    rollingReserveMonths: 3,
    releasedAt: null,
    validatedAt: null,
    notes: "Volume normal, légère hausse vs avril.",
    countryBreakdown: [
      { country: "CH", amount: 18_200.0 },
      { country: "FR", amount: 12_400.0 },
      { country: "DE", amount: 9_800.0 },
      { country: "IT", amount: 3_900.0 },
      { country: "US", amount: 4_200.0 },
    ],
    countryFileName: "link-mai-2026-pays.xlsx",
    txCounts: EMPTY_TX_COUNTS,
    feeRates: DEFAULT_FEE_RATES,
  },
  {
    id: "rev-link-202605-paypal",
    businessId: "biz-link",
    month: "2026-05",
    processor: "PayPal",
    currency: "USD",
    capturedAmount: 12_800.0,
    fees: 512.0,
    rollingReservePercent: 0,
    rollingReserveMonths: 0,
    releasedAt: null,
    validatedAt: null,
    notes: "Second processeur sur Link — pas de reserve sur PayPal.",
    countryBreakdown: [
      { country: "CH", amount: 5_100.0 },
      { country: "FR", amount: 3_400.0 },
      { country: "DE", amount: 2_500.0 },
      { country: "US", amount: 1_800.0 },
    ],
    countryFileName: "link-mai-2026-paypal-pays.xlsx",
    txCounts: EMPTY_TX_COUNTS,
    feeRates: DEFAULT_FEE_RATES,
  },
  {
    id: "rev-ify-202605",
    businessId: "biz-ify",
    month: "2026-05",
    processor: "Stripe",
    currency: "USD",
    capturedAmount: 22_300.0,
    fees: 781.05,
    rollingReservePercent: 10,
    rollingReserveMonths: 6,
    releasedAt: null,
    validatedAt: null,
    countryBreakdown: [
      { country: "CH", amount: 6_400.0 },
      { country: "FR", amount: 5_100.0 },
      { country: "DE", amount: 4_700.0 },
      { country: "BE", amount: 2_200.0 },
      { country: "US", amount: 3_900.0 },
    ],
    countryFileName: "ify-mai-2026-pays.xlsx",
    txCounts: EMPTY_TX_COUNTS,
    feeRates: DEFAULT_FEE_RATES,
  },
  {
    id: "rev-link-202604",
    businessId: "biz-link",
    month: "2026-04",
    processor: "Stripe",
    currency: "USD",
    capturedAmount: 42_100.0,
    fees: 1_263.0,
    rollingReservePercent: 10,
    rollingReserveMonths: 3,
    releasedAt: null,
    validatedAt: "2026-05-02T08:30:00.000Z",
    countryBreakdown: [
      { country: "CH", amount: 16_800.0 },
      { country: "FR", amount: 10_900.0 },
      { country: "DE", amount: 8_500.0 },
      { country: "US", amount: 5_900.0 },
    ],
    countryFileName: "link-avril-2026-pays.xlsx",
    txCounts: EMPTY_TX_COUNTS,
    feeRates: DEFAULT_FEE_RATES,
  },
];

const EMPTY_MAILBOX_OAUTH = {
  syncEnabled: true,
  oauthClientId: null,
  hasOauthSecret: false,
  oauthUserEmail: null,
  oauthExpiresAt: null,
  oauthScope: null,
  hasRefreshToken: false,
};

export const mockMailboxes: Mailbox[] = [
  {
    id: "mb-1",
    email: "comptabilite@bim-commune.ch",
    provider: "gmail",
    connected: false,
    invoicesFound: 0,
    lastSync: null,
    ...EMPTY_MAILBOX_OAUTH,
  },
  {
    id: "mb-2",
    email: "factures@bim-commune.ch",
    provider: "gmail",
    connected: false,
    invoicesFound: 0,
    lastSync: null,
    ...EMPTY_MAILBOX_OAUTH,
  },
  {
    id: "mb-3",
    email: "achat@bim-commune.ch",
    provider: "outlook",
    connected: false,
    invoicesFound: 0,
    lastSync: null,
    ...EMPTY_MAILBOX_OAUTH,
  },
];

// Code = abréviation utilisée dans le nom du fichier final
// (ex: "22.05.26 - Runpod - TECH"). Tu peux le changer dans Classement comptable.
export const mockFolderMappings: FolderMapping[] = [
  {
    id: "fm-proc",
    creditorPattern: "Stripe|PayPal|Adyen|Square|SumUp|Worldline|Twint",
    folderCode: "PROC",
    folderLabel: "Commission et charges du processeur de paiement",
  },
  {
    id: "fm-sal",
    creditorPattern: "Salaire|AVS|LPP|Caisse|Suva|Assurance perte de gain",
    folderCode: "SAL",
    folderLabel: "Salaires & charges sociales",
  },
  {
    id: "fm-mkt",
    creditorPattern: "Meta|Google Ads|LinkedIn|TikTok|Mailchimp|Brevo|HubSpot",
    folderCode: "MKT",
    folderLabel: "Marketing & Publicité",
  },
  {
    id: "fm-tech",
    creditorPattern: "Runpod|OpenAI|Anthropic|AWS|GCP|Azure|Vercel|GitHub|Notion|Figma|Slack|Linear",
    folderCode: "TECH",
    folderLabel: "Charges logicielles, R&D & Technologie",
  },
  {
    id: "fm-loc",
    creditorPattern: "Loyer|Régie|SIG|Romande Energie|Services Industriels|Eau",
    folderCode: "LOC",
    folderLabel: "Charges de locaux",
  },
  {
    id: "fm-adm",
    creditorPattern: "Swisscom|Sunrise|Salt|La Poste|CFF|Office Suisse|Migros|Coop|Fiduciaire|Comptable",
    folderCode: "ADM",
    folderLabel: "Administration",
  },
  {
    id: "fm-ass",
    creditorPattern: "Helvetia|Vaudoise|Bâloise|Zurich|Mobilière|AXA|Impôts|TVA|Administration fiscale",
    folderCode: "ASS",
    folderLabel: "Assurances & Taxes",
  },
  {
    id: "fm-nc",
    creditorPattern: "(jamais — réservé au tri manuel)",
    folderCode: "NC",
    folderLabel: "Charges non classées",
    notes:
      "Catégorie de dernier recours. Ne pas l'attribuer automatiquement — uniquement via l'onglet À traiter manuellement, quand aucune autre catégorie ne convient.",
  },
];

export const FALLBACK_CATEGORY_ID = "fm-nc";

export const mockDrive: DriveConfig = {
  provider: null,
  connected: false,
  rootPath: null,
};

// Plus de factures mock : la table `invoices` reste vide au seed,
// elle se remplira via les synchros Gmail réelles.
export const mockInvoices: Invoice[] = [];


export type AppData = {
  mailboxes: Mailbox[];
  invoices: Invoice[];
  mappings: FolderMapping[];
  drive: DriveConfig;
  businesses: Business[];
  revenues: Revenue[];
};

export const initialData: AppData = {
  mailboxes: mockMailboxes,
  invoices: mockInvoices,
  mappings: mockFolderMappings,
  drive: mockDrive,
  businesses: mockBusinesses,
  revenues: mockRevenues,
};
