import postgres from "postgres";
import type {
  Business,
  CountryRevenue,
  DriveConfig,
  FeeRates,
  FolderMapping,
  Invoice,
  Mailbox,
  Revenue,
  TxCounts,
} from "./types";
import { DEFAULT_FEE_RATES, EMPTY_TX_COUNTS } from "./types";
import { initialData } from "./mock-data";

// Ordre de priorité :
// 1. DATABASE_URL — override manuel (gagne sur tout, utile si une intégration
//    pose un POSTGRES_URL qui pointe vers la mauvaise DB).
// 2. POSTGRES_URL — auto-posé par l'intégration Vercel ↔ Supabase.
// 3. Fallback local Supabase CLI.
const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  "postgres://postgres:postgres@127.0.0.1:54322/postgres";

// Module-level singleton client. `postgres` handles a pool internally.
let _sql: ReturnType<typeof postgres> | null = null;
let _seeded = false;

function client() {
  if (!_sql) {
    // Supabase exige TLS sur le pooler et la connexion directe.
    // On force ssl: 'require' partout sauf en local (127.0.0.1).
    const isLocal = /^(postgres(ql)?:\/\/)[^@]*@(127\.0\.0\.1|localhost)/.test(
      connectionString,
    );
    _sql = postgres(connectionString, {
      max: 10,
      idle_timeout: 20,
      prepare: false, // safer with Supabase pgbouncer
      ssl: isLocal ? false : "require",
    });
  }
  return _sql;
}

async function ensureSeeded() {
  if (_seeded) return;
  const sql = client();
  const [{ count }] = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM businesses
  `;
  if (count === 0) {
    await sql.begin(async (tx) => {
      for (const b of initialData.businesses) {
        await tx`
          INSERT INTO businesses (id, name, color, processor)
          VALUES (${b.id}, ${b.name}, ${b.color}, ${b.processor})
        `;
      }
      for (const m of initialData.mailboxes) {
        await tx`
          INSERT INTO mailboxes (id, email, provider, connected, invoices_found, last_sync)
          VALUES (${m.id}, ${m.email}, ${m.provider}, ${m.connected}, ${m.invoicesFound}, ${m.lastSync})
        `;
      }
      for (const m of initialData.mappings) {
        await tx`
          INSERT INTO folder_mappings (id, creditor_pattern, folder_code, folder_label, notes)
          VALUES (${m.id}, ${m.creditorPattern}, ${m.folderCode}, ${m.folderLabel}, ${m.notes ?? null})
        `;
      }
      for (const i of initialData.invoices) {
        await tx`
          INSERT INTO invoices (
            id, subject, from_email, mailbox, received_at, creditor, invoice_date,
            amount, currency, folder_code, folder_label, final_name, drive_path,
            status, excel_row_matched, attachment, account_currency
          ) VALUES (
            ${i.id}, ${i.subject}, ${i.fromEmail}, ${i.mailbox}, ${i.receivedAt},
            ${i.creditor}, ${i.invoiceDate}, ${i.amount}, ${i.currency},
            ${i.folderCode}, ${i.folderLabel}, ${i.finalName}, ${i.drivePath},
            ${i.status}, ${i.excelRowMatched},
            ${i.attachment ? sql.json(i.attachment) : null},
            ${i.accountCurrency ?? "USD"}
          )
        `;
      }
      for (const r of initialData.revenues) {
        await tx`
          INSERT INTO revenues (
            id, business_id, month, processor, currency,
            captured_amount, fees, rolling_reserve_percent, rolling_reserve_months,
            released_at, validated_at, notes, country_breakdown, country_file_name,
            tx_counts, fee_rates
          ) VALUES (
            ${r.id}, ${r.businessId}, ${r.month}, ${r.processor}, ${r.currency},
            ${r.capturedAmount}, ${r.fees}, ${r.rollingReservePercent}, ${r.rollingReserveMonths},
            ${r.releasedAt}, ${r.validatedAt}, ${r.notes ?? null},
            ${sql.json(r.countryBreakdown ?? [])}, ${r.countryFileName},
            ${sql.json(r.txCounts ?? EMPTY_TX_COUNTS)},
            ${sql.json(r.feeRates ?? DEFAULT_FEE_RATES)}
          )
        `;
      }
      await tx`
        INSERT INTO drive_config (id, provider, connected, root_path)
        VALUES (1, ${initialData.drive.provider}, ${initialData.drive.connected}, ${initialData.drive.rootPath})
        ON CONFLICT (id) DO UPDATE SET
          provider = EXCLUDED.provider,
          connected = EXCLUDED.connected,
          root_path = EXCLUDED.root_path
      `;
    });
  }
  _seeded = true;
}

// ---------- mappers ----------

type RawBusiness = { id: string; name: string; color: string; processor: string };
const mapBusiness = (r: RawBusiness): Business => r;

type RawMailbox = {
  id: string;
  email: string;
  provider: Mailbox["provider"];
  connected: boolean;
  invoices_found: number;
  last_sync: Date | null;
  sync_enabled: boolean | null;
  oauth_client_id: string | null;
  oauth_client_secret: string | null;
  oauth_refresh_token: string | null;
  oauth_access_token: string | null;
  oauth_expires_at: Date | null;
  oauth_scope: string | null;
  oauth_user_email: string | null;
};
const mapMailbox = (r: RawMailbox): Mailbox => ({
  id: r.id,
  email: r.email,
  provider: r.provider,
  connected: r.connected,
  invoicesFound: r.invoices_found,
  lastSync: r.last_sync ? r.last_sync.toISOString() : null,
  syncEnabled: r.sync_enabled !== false, // default true
  oauthClientId: r.oauth_client_id,
  hasOauthSecret: !!r.oauth_client_secret,
  oauthUserEmail: r.oauth_user_email,
  oauthExpiresAt: r.oauth_expires_at ? r.oauth_expires_at.toISOString() : null,
  oauthScope: r.oauth_scope,
  hasRefreshToken: !!r.oauth_refresh_token,
});

type RawMapping = {
  id: string;
  creditor_pattern: string;
  folder_code: string;
  folder_label: string;
  notes: string | null;
};
const mapMapping = (r: RawMapping): FolderMapping => ({
  id: r.id,
  creditorPattern: r.creditor_pattern,
  folderCode: r.folder_code,
  folderLabel: r.folder_label,
  notes: r.notes ?? undefined,
});

type RawInvoice = {
  id: string;
  subject: string;
  from_email: string;
  mailbox: string;
  received_at: Date;
  creditor: string | null;
  invoice_date: Date | null;
  amount: string | null; // numeric returned as string by `postgres`
  currency: string | null;
  folder_code: string | null;
  folder_label: string | null;
  final_name: string | null;
  drive_path: string | null;
  status: Invoice["status"];
  excel_row_matched: number | null;
  attachment: Invoice["attachment"]; // JSONB → parsed
  account_currency: string | null;
};
const mapInvoice = (r: RawInvoice): Invoice => ({
  id: r.id,
  subject: r.subject,
  fromEmail: r.from_email,
  mailbox: r.mailbox,
  receivedAt: r.received_at.toISOString(),
  creditor: r.creditor,
  invoiceDate: r.invoice_date ? r.invoice_date.toISOString().slice(0, 10) : null,
  amount: r.amount != null ? Number(r.amount) : null,
  currency: r.currency,
  folderCode: r.folder_code,
  folderLabel: r.folder_label,
  finalName: r.final_name,
  drivePath: r.drive_path,
  status: r.status,
  excelRowMatched: r.excel_row_matched,
  attachment: r.attachment ?? null,
  accountCurrency: ((r.account_currency ?? "USD") as Invoice["accountCurrency"]),
});

type RawRevenue = {
  id: string;
  business_id: string;
  month: string;
  processor: string;
  currency: string;
  captured_amount: string;
  fees: string;
  rolling_reserve_percent: string;
  rolling_reserve_months: number;
  released_at: Date | null;
  validated_at: Date | null;
  notes: string | null;
  country_breakdown: CountryRevenue[];
  country_file_name: string | null;
  tx_counts: Partial<TxCounts> | null;
  fee_rates: Partial<FeeRates> | null;
};
const mapRevenue = (r: RawRevenue): Revenue => ({
  id: r.id,
  businessId: r.business_id,
  month: r.month,
  processor: r.processor,
  currency: r.currency,
  capturedAmount: Number(r.captured_amount),
  fees: Number(r.fees),
  rollingReservePercent: Number(r.rolling_reserve_percent),
  rollingReserveMonths: r.rolling_reserve_months,
  releasedAt: r.released_at ? r.released_at.toISOString() : null,
  validatedAt: r.validated_at ? r.validated_at.toISOString() : null,
  notes: r.notes ?? undefined,
  countryBreakdown: r.country_breakdown ?? [],
  countryFileName: r.country_file_name,
  txCounts: { ...EMPTY_TX_COUNTS, ...(r.tx_counts ?? {}) },
  feeRates: { ...DEFAULT_FEE_RATES, ...(r.fee_rates ?? {}) },
});

// ---------- public API ----------

export async function getAllState() {
  await ensureSeeded();
  const sql = client();
  const [bizRows, mbRows, mapRows, invRows, revRows, driveRow] = await Promise.all([
    sql<RawBusiness[]>`SELECT * FROM businesses ORDER BY name`,
    sql<RawMailbox[]>`SELECT * FROM mailboxes ORDER BY email`,
    sql<RawMapping[]>`SELECT * FROM folder_mappings`,
    sql<RawInvoice[]>`SELECT * FROM invoices ORDER BY received_at DESC`,
    sql<RawRevenue[]>`SELECT * FROM revenues ORDER BY month DESC, business_id`,
    sql<{ provider: string | null; connected: boolean; root_path: string | null }[]>`
      SELECT provider, connected, root_path FROM drive_config WHERE id = 1
    `,
  ]);
  const drive: DriveConfig = driveRow[0]
    ? {
        provider: (driveRow[0].provider as DriveConfig["provider"]) ?? null,
        connected: driveRow[0].connected,
        rootPath: driveRow[0].root_path,
      }
    : { provider: null, connected: false, rootPath: null };

  return {
    businesses: bizRows.map(mapBusiness),
    mailboxes: mbRows.map(mapMailbox),
    mappings: mapRows.map(mapMapping),
    invoices: invRows.map(mapInvoice),
    revenues: revRows.map(mapRevenue),
    drive,
  };
}

// ---- Revenues ----
export async function createRevenue(r: Revenue): Promise<Revenue> {
  const sql = client();
  await ensureSeeded();
  await sql`
    INSERT INTO revenues (
      id, business_id, month, processor, currency,
      captured_amount, fees, rolling_reserve_percent, rolling_reserve_months,
      released_at, validated_at, notes, country_breakdown, country_file_name,
      tx_counts, fee_rates
    ) VALUES (
      ${r.id}, ${r.businessId}, ${r.month}, ${r.processor}, ${r.currency},
      ${r.capturedAmount}, ${r.fees}, ${r.rollingReservePercent}, ${r.rollingReserveMonths},
      ${r.releasedAt}, ${r.validatedAt}, ${r.notes ?? null},
      ${sql.json(r.countryBreakdown ?? [])}, ${r.countryFileName},
      ${sql.json(r.txCounts ?? EMPTY_TX_COUNTS)},
      ${sql.json(r.feeRates ?? DEFAULT_FEE_RATES)}
    )
  `;
  return r;
}

export async function updateRevenue(id: string, patch: Partial<Revenue>): Promise<Revenue | null> {
  const sql = client();
  const [current] = await sql<RawRevenue[]>`SELECT * FROM revenues WHERE id = ${id}`;
  if (!current) return null;
  const merged: Revenue = { ...mapRevenue(current), ...patch, id };
  await sql`
    UPDATE revenues SET
      business_id = ${merged.businessId},
      month = ${merged.month},
      processor = ${merged.processor},
      currency = ${merged.currency},
      captured_amount = ${merged.capturedAmount},
      fees = ${merged.fees},
      rolling_reserve_percent = ${merged.rollingReservePercent},
      rolling_reserve_months = ${merged.rollingReserveMonths},
      released_at = ${merged.releasedAt},
      validated_at = ${merged.validatedAt},
      notes = ${merged.notes ?? null},
      country_breakdown = ${sql.json(merged.countryBreakdown ?? [])},
      country_file_name = ${merged.countryFileName},
      tx_counts = ${sql.json(merged.txCounts ?? EMPTY_TX_COUNTS)},
      fee_rates = ${sql.json(merged.feeRates ?? DEFAULT_FEE_RATES)}
    WHERE id = ${id}
  `;
  return merged;
}

export async function deleteRevenue(id: string) {
  await client()`DELETE FROM revenues WHERE id = ${id}`;
}

// ---- Mailboxes ----
export async function createMailbox(m: Mailbox): Promise<Mailbox> {
  await client()`
    INSERT INTO mailboxes (id, email, provider, connected, invoices_found, last_sync)
    VALUES (${m.id}, ${m.email}, ${m.provider}, ${m.connected}, ${m.invoicesFound}, ${m.lastSync})
  `;
  return m;
}
export async function updateMailbox(id: string, patch: Partial<Mailbox>): Promise<Mailbox | null> {
  const sql = client();
  const [current] = await sql<RawMailbox[]>`SELECT * FROM mailboxes WHERE id = ${id}`;
  if (!current) return null;
  const merged: Mailbox = { ...mapMailbox(current), ...patch, id };
  await sql`
    UPDATE mailboxes SET
      email = ${merged.email},
      provider = ${merged.provider},
      connected = ${merged.connected},
      invoices_found = ${merged.invoicesFound},
      last_sync = ${merged.lastSync},
      sync_enabled = ${merged.syncEnabled}
    WHERE id = ${id}
  `;
  return merged;
}
export async function deleteMailbox(id: string) {
  await client()`DELETE FROM mailboxes WHERE id = ${id}`;
}

// ---- Mailbox OAuth tokens (server-only) ----
export type MailboxOAuthTokens = {
  refreshToken: string;
  accessToken: string;
  expiresAt: string; // ISO
  scope: string;
  userEmail: string;
};
export async function saveMailboxOAuth(id: string, t: MailboxOAuthTokens) {
  const sql = client();
  await sql`
    UPDATE mailboxes SET
      oauth_refresh_token = ${t.refreshToken},
      oauth_access_token = ${t.accessToken},
      oauth_expires_at = ${t.expiresAt},
      oauth_scope = ${t.scope},
      oauth_user_email = ${t.userEmail},
      connected = TRUE
    WHERE id = ${id}
  `;
}
export async function clearMailboxOAuth(id: string) {
  const sql = client();
  await sql`
    UPDATE mailboxes SET
      oauth_refresh_token = NULL,
      oauth_access_token = NULL,
      oauth_expires_at = NULL,
      oauth_scope = NULL,
      oauth_user_email = NULL,
      connected = FALSE
    WHERE id = ${id}
  `;
}
export async function getMailboxWithTokens(id: string): Promise<{
  email: string;
  refreshToken: string | null;
  accessToken: string | null;
  expiresAt: Date | null;
} | null> {
  const sql = client();
  const [row] = await sql<{
    email: string;
    oauth_refresh_token: string | null;
    oauth_access_token: string | null;
    oauth_expires_at: Date | null;
  }[]>`
    SELECT email, oauth_refresh_token, oauth_access_token, oauth_expires_at
    FROM mailboxes WHERE id = ${id}
  `;
  if (!row) return null;
  return {
    email: row.email,
    refreshToken: row.oauth_refresh_token,
    accessToken: row.oauth_access_token,
    expiresAt: row.oauth_expires_at,
  };
}

// ---- OAuth credentials par mailbox (server-only) ----
export async function setMailboxOAuthCredentials(
  id: string,
  clientId: string | null,
  clientSecret: string | null,
) {
  const sql = client();
  if (clientSecret !== null) {
    await sql`
      UPDATE mailboxes
      SET oauth_client_id = ${clientId}, oauth_client_secret = ${clientSecret}
      WHERE id = ${id}
    `;
  } else {
    // Met à jour seulement l'id (préserve le secret existant).
    await sql`
      UPDATE mailboxes
      SET oauth_client_id = ${clientId}
      WHERE id = ${id}
    `;
  }
}

export async function getMailboxOAuthCredentials(
  id: string,
): Promise<{ clientId: string; clientSecret: string } | null> {
  const sql = client();
  const [row] = await sql<{
    oauth_client_id: string | null;
    oauth_client_secret: string | null;
  }[]>`
    SELECT oauth_client_id, oauth_client_secret
    FROM mailboxes WHERE id = ${id}
  `;
  if (!row?.oauth_client_id || !row?.oauth_client_secret) return null;
  return {
    clientId: row.oauth_client_id.trim(),
    clientSecret: row.oauth_client_secret.trim(),
  };
}

// ---- Sync (server-only) ----

export async function getMailboxesForSync(
  filterIds?: string[],
): Promise<Array<{
  id: string;
  email: string;
  oauth_refresh_token: string;
  oauth_access_token: string | null;
  oauth_expires_at: Date | null;
  oauth_client_id: string;
  oauth_client_secret: string;
}>> {
  const sql = client();
  if (filterIds && filterIds.length > 0) {
    return await sql<{
      id: string;
      email: string;
      oauth_refresh_token: string;
      oauth_access_token: string | null;
      oauth_expires_at: Date | null;
      oauth_client_id: string;
      oauth_client_secret: string;
    }[]>`
      SELECT id, email, oauth_refresh_token, oauth_access_token,
             oauth_expires_at, oauth_client_id, oauth_client_secret
      FROM mailboxes
      WHERE connected = TRUE
        AND oauth_refresh_token IS NOT NULL
        AND oauth_client_id IS NOT NULL
        AND oauth_client_secret IS NOT NULL
        AND id = ANY(${filterIds})
    `;
  }
  return await sql<{
    id: string;
    email: string;
    oauth_refresh_token: string;
    oauth_access_token: string | null;
    oauth_expires_at: Date | null;
    oauth_client_id: string;
    oauth_client_secret: string;
  }[]>`
    SELECT id, email, oauth_refresh_token, oauth_access_token,
           oauth_expires_at, oauth_client_id, oauth_client_secret
    FROM mailboxes
    WHERE connected = TRUE
      AND sync_enabled = TRUE
      AND oauth_refresh_token IS NOT NULL
      AND oauth_client_id IS NOT NULL
      AND oauth_client_secret IS NOT NULL
  `;
}

export async function updateMailboxAccessToken(
  id: string,
  accessToken: string,
  expiresAt: string,
) {
  await client()`
    UPDATE mailboxes
    SET oauth_access_token = ${accessToken}, oauth_expires_at = ${expiresAt}
    WHERE id = ${id}
  `;
}

export async function updateMailboxLastSync(id: string) {
  await client()`UPDATE mailboxes SET last_sync = now() WHERE id = ${id}`;
}

export async function incrementMailboxInvoicesFound(id: string, n: number) {
  await client()`
    UPDATE mailboxes SET invoices_found = invoices_found + ${n} WHERE id = ${id}
  `;
}

export async function invoiceExistsForMessage(
  mailboxId: string,
  sourceMessageId: string,
): Promise<boolean> {
  const sql = client();
  const [row] = await sql<{ id: string }[]>`
    SELECT id FROM invoices
    WHERE mailbox_id = ${mailboxId}
      AND source_message_id = ${sourceMessageId}
    LIMIT 1
  `;
  return !!row;
}

export type IncomingInvoice = {
  id: string;
  mailboxId: string;
  sourceMessageId: string;
  subject: string;
  fromEmail: string;
  mailbox: string;
  receivedAt: string;
  attachmentName: string;
  attachmentBytes: number;
  attachmentB64: string;
  accountCurrency?: string; // par défaut USD si non précisé
};

export async function insertIncomingInvoice(inv: IncomingInvoice) {
  const sql = client();
  await sql`
    INSERT INTO invoices (
      id, mailbox_id, source_message_id, subject, from_email, mailbox,
      received_at, creditor, invoice_date, amount, currency,
      folder_code, folder_label, final_name, drive_path,
      status, excel_row_matched, attachment, attachment_b64, account_currency
    ) VALUES (
      ${inv.id}, ${inv.mailboxId}, ${inv.sourceMessageId},
      ${inv.subject}, ${inv.fromEmail}, ${inv.mailbox}, ${inv.receivedAt},
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      'analyzing', NULL,
      ${sql.json({ name: inv.attachmentName, sizeBytes: inv.attachmentBytes, pages: 1 })},
      ${inv.attachmentB64},
      ${inv.accountCurrency ?? "USD"}
    )
    ON CONFLICT DO NOTHING
  `;
}

// --- Sync runs ---

export type SyncRunRow = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: "cron" | "manual";
  results: unknown[];
  totalAdded: number;
  totalSkipped: number;
  error: string | null;
};

export async function createSyncRun(
  id: string,
  trigger: "cron" | "manual",
): Promise<void> {
  await client()`
    INSERT INTO sync_runs (id, trigger, started_at)
    VALUES (${id}, ${trigger}, now())
  `;
}

export async function finishSyncRun(
  id: string,
  results: unknown[],
  totalAdded: number,
  totalSkipped: number,
  error: string | null,
): Promise<void> {
  const sql = client();
  await sql`
    UPDATE sync_runs
    SET finished_at = now(),
        results = ${JSON.stringify(results)}::jsonb,
        total_added = ${totalAdded},
        total_skipped = ${totalSkipped},
        error = ${error}
    WHERE id = ${id}
  `;
}

export async function getRecentSyncRuns(limit = 10): Promise<SyncRunRow[]> {
  const sql = client();
  const rows = await sql<{
    id: string;
    started_at: Date;
    finished_at: Date | null;
    trigger: "cron" | "manual";
    results: unknown[];
    total_added: number;
    total_skipped: number;
    error: string | null;
  }[]>`
    SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: r.id,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
    trigger: r.trigger,
    results: r.results ?? [],
    totalAdded: r.total_added,
    totalSkipped: r.total_skipped,
    error: r.error,
  }));
}

// ---- App settings (key/value) ----
export async function getSetting(key: string): Promise<string | null> {
  const sql = client();
  const [row] = await sql<{ value: string }[]>`
    SELECT value FROM app_settings WHERE key = ${key}
  `;
  return row?.value ?? null;
}
export async function setSetting(key: string, value: string) {
  const sql = client();
  await sql`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (${key}, ${value}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
}

// ---- Mappings ----
// ---- Creditor classification cache (LLM fallback) ----

export function normalizeCreditor(c: string): string {
  return c
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[éèê]/g, "e")
    .replace(/[àâ]/g, "a")
    .replace(/[ç]/g, "c");
}

export async function getCreditorClassification(
  creditor: string,
): Promise<{ mappingId: string; classifiedBy: string } | null> {
  const sql = client();
  const rows = await sql<{
    folder_mapping_id: string;
    classified_by: string;
  }[]>`
    SELECT folder_mapping_id, classified_by
    FROM creditor_classifications
    WHERE creditor = ${normalizeCreditor(creditor)}
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return {
    mappingId: rows[0].folder_mapping_id,
    classifiedBy: rows[0].classified_by,
  };
}

export async function saveCreditorClassification(opts: {
  creditor: string;
  mappingId: string;
  classifiedBy: "llm" | "manual";
  confidence?: number | null;
  reasoning?: string | null;
}): Promise<void> {
  const sql = client();
  await sql`
    INSERT INTO creditor_classifications (
      creditor, folder_mapping_id, classified_by, confidence, reasoning
    ) VALUES (
      ${normalizeCreditor(opts.creditor)}, ${opts.mappingId},
      ${opts.classifiedBy}, ${opts.confidence ?? null}, ${opts.reasoning ?? null}
    )
    ON CONFLICT (creditor) DO UPDATE SET
      folder_mapping_id = EXCLUDED.folder_mapping_id,
      classified_by     = EXCLUDED.classified_by,
      confidence        = EXCLUDED.confidence,
      reasoning         = EXCLUDED.reasoning,
      classified_at     = now()
  `;
}

export async function getAllMappings(): Promise<FolderMapping[]> {
  await ensureSeeded();
  const sql = client();
  const rows = await sql<RawMapping[]>`SELECT * FROM folder_mappings`;
  return rows.map(mapMapping);
}

export async function createMapping(m: FolderMapping): Promise<FolderMapping> {
  await client()`
    INSERT INTO folder_mappings (id, creditor_pattern, folder_code, folder_label, notes)
    VALUES (${m.id}, ${m.creditorPattern}, ${m.folderCode}, ${m.folderLabel}, ${m.notes ?? null})
  `;
  return m;
}
export async function updateMapping(id: string, patch: Partial<FolderMapping>): Promise<FolderMapping | null> {
  const sql = client();
  const [current] = await sql<RawMapping[]>`SELECT * FROM folder_mappings WHERE id = ${id}`;
  if (!current) return null;
  const merged: FolderMapping = { ...mapMapping(current), ...patch, id };
  await sql`
    UPDATE folder_mappings SET
      creditor_pattern = ${merged.creditorPattern},
      folder_code = ${merged.folderCode},
      folder_label = ${merged.folderLabel},
      notes = ${merged.notes ?? null}
    WHERE id = ${id}
  `;
  return merged;
}
export async function deleteMapping(id: string) {
  await client()`DELETE FROM folder_mappings WHERE id = ${id}`;
}

// ---- Invoices ----
/**
 * Récupère une facture avec sa pièce jointe (base64) pour aperçu PDF
 * ou re-traitement. Retourne null si l'id n'existe pas.
 */
export async function getInvoiceWithAttachment(id: string): Promise<{
  invoice: Invoice;
  attachmentB64: string | null;
  fromEmail: string;
  subject: string;
} | null> {
  const sql = client();
  const rows = await sql<(RawInvoice & {
    attachment_b64: string | null;
  })[]>`SELECT * FROM invoices WHERE id = ${id} LIMIT 1`;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    invoice: mapInvoice(r),
    attachmentB64: r.attachment_b64,
    fromEmail: r.from_email,
    subject: r.subject,
  };
}

/**
 * Supprime toutes les factures (toutes statuts, tous mois confondus).
 * Ne touche pas aux mailboxes, mappings, businesses, revenues, Drive, etc.
 */
export async function deleteAllInvoices(): Promise<number> {
  const sql = client();
  const result = await sql`DELETE FROM invoices`;
  return result.count ?? 0;
}

export async function updateInvoice(id: string, patch: Partial<Invoice>): Promise<Invoice | null> {
  const sql = client();
  const [current] = await sql<RawInvoice[]>`SELECT * FROM invoices WHERE id = ${id}`;
  if (!current) return null;
  const merged: Invoice = { ...mapInvoice(current), ...patch, id };
  await sql`
    UPDATE invoices SET
      subject = ${merged.subject},
      from_email = ${merged.fromEmail},
      mailbox = ${merged.mailbox},
      received_at = ${merged.receivedAt},
      creditor = ${merged.creditor},
      invoice_date = ${merged.invoiceDate},
      amount = ${merged.amount},
      currency = ${merged.currency},
      folder_code = ${merged.folderCode},
      folder_label = ${merged.folderLabel},
      final_name = ${merged.finalName},
      drive_path = ${merged.drivePath},
      status = ${merged.status},
      excel_row_matched = ${merged.excelRowMatched},
      attachment = ${merged.attachment ? sql.json(merged.attachment) : null},
      account_currency = ${merged.accountCurrency ?? "USD"}
    WHERE id = ${id}
  `;
  return merged;
}

// ---- Businesses ----
export async function createBusiness(b: Business): Promise<Business> {
  await client()`
    INSERT INTO businesses (id, name, color, processor)
    VALUES (${b.id}, ${b.name}, ${b.color}, ${b.processor})
  `;
  return b;
}
export async function updateBusiness(id: string, patch: Partial<Business>): Promise<Business | null> {
  const sql = client();
  const [current] = await sql<RawBusiness[]>`SELECT * FROM businesses WHERE id = ${id}`;
  if (!current) return null;
  const merged: Business = { ...current, ...patch, id };
  await sql`
    UPDATE businesses SET
      name = ${merged.name},
      color = ${merged.color},
      processor = ${merged.processor}
    WHERE id = ${id}
  `;
  return merged;
}
export async function deleteBusiness(id: string) {
  await client()`DELETE FROM businesses WHERE id = ${id}`;
}

// ---- Drive ----

export type DriveCredentials = { clientId: string; clientSecret: string };
export type DriveOAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  userEmail: string;
  scope: string;
};

export async function setDriveCredentials(c: DriveCredentials) {
  const sql = client();
  await sql`
    UPDATE drive_config SET
      oauth_client_id = ${c.clientId},
      oauth_client_secret = ${c.clientSecret}
    WHERE id = 1
  `;
}

export async function getDriveCredentials(): Promise<DriveCredentials | null> {
  const sql = client();
  const rows = await sql<{ oauth_client_id: string | null; oauth_client_secret: string | null }[]>`
    SELECT oauth_client_id, oauth_client_secret FROM drive_config WHERE id = 1
  `;
  if (!rows[0]?.oauth_client_id || !rows[0]?.oauth_client_secret) return null;
  return {
    clientId: rows[0].oauth_client_id,
    clientSecret: rows[0].oauth_client_secret,
  };
}

export async function saveDriveOAuth(t: DriveOAuthTokens) {
  const sql = client();
  await sql`
    UPDATE drive_config SET
      oauth_access_token  = ${t.accessToken},
      oauth_refresh_token = ${t.refreshToken},
      oauth_expires_at    = ${t.expiresAt},
      oauth_user_email    = ${t.userEmail},
      oauth_scope         = ${t.scope},
      provider            = 'google',
      connected           = TRUE
    WHERE id = 1
  `;
}

export async function clearDriveOAuth() {
  const sql = client();
  await sql`
    UPDATE drive_config SET
      oauth_access_token = NULL,
      oauth_refresh_token = NULL,
      oauth_expires_at = NULL,
      oauth_user_email = NULL,
      oauth_scope = NULL,
      connected = FALSE,
      root_folder_id = NULL
    WHERE id = 1
  `;
}

export type DriveOAuthState = {
  connected: boolean;
  hasCredentials: boolean;
  userEmail: string | null;
  rootFolderId: string | null;
  rootFolderName: string;
  expiresAt: string | null;
  scope: string | null;
};

export async function getDriveOAuthState(): Promise<DriveOAuthState> {
  const sql = client();
  const rows = await sql<{
    connected: boolean;
    oauth_client_id: string | null;
    oauth_client_secret: string | null;
    oauth_user_email: string | null;
    oauth_expires_at: Date | null;
    oauth_scope: string | null;
    root_folder_id: string | null;
    root_folder_name: string | null;
  }[]>`
    SELECT connected, oauth_client_id, oauth_client_secret, oauth_user_email,
           oauth_expires_at, oauth_scope, root_folder_id, root_folder_name
    FROM drive_config WHERE id = 1
  `;
  const r = rows[0];
  return {
    connected: !!r?.connected,
    hasCredentials: !!(r?.oauth_client_id && r?.oauth_client_secret),
    userEmail: r?.oauth_user_email ?? null,
    rootFolderId: r?.root_folder_id ?? null,
    rootFolderName: r?.root_folder_name ?? "Comptabilité",
    expiresAt: r?.oauth_expires_at ? r.oauth_expires_at.toISOString() : null,
    scope: r?.oauth_scope ?? null,
  };
}

export async function getDriveWithTokens(): Promise<{
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken: string | null;
  expiresAt: Date | null;
  rootFolderId: string | null;
  rootFolderName: string;
} | null> {
  const sql = client();
  const rows = await sql<{
    oauth_client_id: string | null;
    oauth_client_secret: string | null;
    oauth_refresh_token: string | null;
    oauth_access_token: string | null;
    oauth_expires_at: Date | null;
    root_folder_id: string | null;
    root_folder_name: string | null;
  }[]>`
    SELECT oauth_client_id, oauth_client_secret, oauth_refresh_token,
           oauth_access_token, oauth_expires_at, root_folder_id, root_folder_name
    FROM drive_config WHERE id = 1
  `;
  const r = rows[0];
  if (!r?.oauth_client_id || !r?.oauth_client_secret || !r?.oauth_refresh_token) {
    return null;
  }
  return {
    clientId: r.oauth_client_id,
    clientSecret: r.oauth_client_secret,
    refreshToken: r.oauth_refresh_token,
    accessToken: r.oauth_access_token,
    expiresAt: r.oauth_expires_at,
    rootFolderId: r.root_folder_id,
    rootFolderName: r.root_folder_name ?? "Comptabilité",
  };
}

export async function updateDriveAccessToken(
  accessToken: string,
  expiresAt: string,
) {
  const sql = client();
  await sql`
    UPDATE drive_config SET
      oauth_access_token = ${accessToken},
      oauth_expires_at = ${expiresAt}
    WHERE id = 1
  `;
}

export async function setDriveRootFolderId(rootFolderId: string) {
  const sql = client();
  await sql`UPDATE drive_config SET root_folder_id = ${rootFolderId} WHERE id = 1`;
}

export async function updateDrive(patch: Partial<DriveConfig>): Promise<DriveConfig> {
  const sql = client();
  const [cur] = await sql<{ provider: string | null; connected: boolean; root_path: string | null }[]>`
    SELECT provider, connected, root_path FROM drive_config WHERE id = 1
  `;
  const current: DriveConfig = cur
    ? {
        provider: (cur.provider as DriveConfig["provider"]) ?? null,
        connected: cur.connected,
        rootPath: cur.root_path,
      }
    : { provider: null, connected: false, rootPath: null };
  const merged: DriveConfig = { ...current, ...patch };
  await sql`
    UPDATE drive_config SET
      provider = ${merged.provider},
      connected = ${merged.connected},
      root_path = ${merged.rootPath}
    WHERE id = 1
  `;
  return merged;
}

// ---- Excel sheets (1 par mois) ----
export type StoredExcelSheet = {
  month: string;
  accountCurrency: string;
  fileName: string;
  headers: string[];
  rows: (string | number | null)[][];
  uploadedAt: string;
};

type RawExcelSheet = {
  month: string;
  account_currency: string;
  file_name: string;
  headers: string[];
  rows: (string | number | null)[][];
  uploaded_at: Date;
};
const mapExcelSheet = (r: RawExcelSheet): StoredExcelSheet => ({
  month: r.month,
  accountCurrency: r.account_currency ?? "USD",
  fileName: r.file_name,
  headers: r.headers,
  rows: r.rows,
  uploadedAt: r.uploaded_at.toISOString(),
});

export async function getExcelSheet(
  month: string,
  accountCurrency: string,
): Promise<StoredExcelSheet | null> {
  const sql = client();
  const rows = await sql<RawExcelSheet[]>`
    SELECT month, account_currency, file_name, headers, rows, uploaded_at
    FROM excel_sheets
    WHERE month = ${month} AND account_currency = ${accountCurrency}
  `;
  return rows[0] ? mapExcelSheet(rows[0]) : null;
}

export async function saveExcelSheet(
  s: Omit<StoredExcelSheet, "uploadedAt">,
): Promise<StoredExcelSheet> {
  const sql = client();
  await sql`
    INSERT INTO excel_sheets (month, account_currency, file_name, headers, rows, uploaded_at)
    VALUES (${s.month}, ${s.accountCurrency}, ${s.fileName}, ${sql.json(s.headers)}, ${sql.json(s.rows)}, now())
    ON CONFLICT (month, account_currency) DO UPDATE SET
      file_name = EXCLUDED.file_name,
      headers = EXCLUDED.headers,
      rows = EXCLUDED.rows,
      uploaded_at = now()
  `;
  return { ...s, uploadedAt: new Date().toISOString() };
}

export async function deleteExcelSheet(month: string, accountCurrency: string) {
  await client()`
    DELETE FROM excel_sheets
    WHERE month = ${month} AND account_currency = ${accountCurrency}
  `;
}

// ---- Reset (dev) ----
export async function resetDatabase() {
  const sql = client();
  await sql.begin(async (tx) => {
    await tx`DELETE FROM revenues`;
    await tx`DELETE FROM invoices`;
    await tx`DELETE FROM folder_mappings`;
    await tx`DELETE FROM mailboxes`;
    await tx`DELETE FROM businesses`;
    await tx`UPDATE drive_config SET provider=NULL, connected=FALSE, root_path=NULL WHERE id = 1`;
  });
  _seeded = false;
  await ensureSeeded();
}

export async function dbInfo() {
  const sql = client();
  const [{ b }] = await sql<{ b: number }[]>`SELECT COUNT(*)::int AS b FROM businesses`;
  const [{ mb }] = await sql<{ mb: number }[]>`SELECT COUNT(*)::int AS mb FROM mailboxes`;
  const [{ map }] = await sql<{ map: number }[]>`SELECT COUNT(*)::int AS map FROM folder_mappings`;
  const [{ inv }] = await sql<{ inv: number }[]>`SELECT COUNT(*)::int AS inv FROM invoices`;
  const [{ rev }] = await sql<{ rev: number }[]>`SELECT COUNT(*)::int AS rev FROM revenues`;
  // Get DB size
  let sizeBytes = 0;
  try {
    const [{ size }] = await sql<{ size: number }[]>`
      SELECT pg_database_size(current_database())::int AS size
    `;
    sizeBytes = size;
  } catch {}
  const masked = connectionString.replace(/:[^:@/]+@/, ":****@");
  return {
    file: masked,
    sizeBytes,
    counts: { businesses: b, mailboxes: mb, mappings: map, invoices: inv, revenues: rev },
  };
}
