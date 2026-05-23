import postgres from "postgres";
import type {
  Business,
  CountryRevenue,
  DriveConfig,
  FolderMapping,
  Invoice,
  Mailbox,
  Revenue,
} from "./types";
import { initialData } from "./mock-data";

const connectionString =
  process.env.DATABASE_URL ??
  // Default fallback = Supabase CLI local Postgres
  "postgres://postgres:postgres@127.0.0.1:54322/postgres";

// Module-level singleton client. `postgres` handles a pool internally.
let _sql: ReturnType<typeof postgres> | null = null;
let _seeded = false;

function client() {
  if (!_sql) {
    _sql = postgres(connectionString, {
      max: 10,
      idle_timeout: 20,
      prepare: false, // safer with Supabase pgbouncer
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
            status, excel_row_matched, attachment
          ) VALUES (
            ${i.id}, ${i.subject}, ${i.fromEmail}, ${i.mailbox}, ${i.receivedAt},
            ${i.creditor}, ${i.invoiceDate}, ${i.amount}, ${i.currency},
            ${i.folderCode}, ${i.folderLabel}, ${i.finalName}, ${i.drivePath},
            ${i.status}, ${i.excelRowMatched},
            ${i.attachment ? sql.json(i.attachment) : null}
          )
        `;
      }
      for (const r of initialData.revenues) {
        await tx`
          INSERT INTO revenues (
            id, business_id, month, processor, currency,
            captured_amount, fees, rolling_reserve_amount, rolling_reserve_months,
            released_at, validated_at, notes, country_breakdown, country_file_name
          ) VALUES (
            ${r.id}, ${r.businessId}, ${r.month}, ${r.processor}, ${r.currency},
            ${r.capturedAmount}, ${r.fees}, ${r.rollingReserveAmount}, ${r.rollingReserveMonths},
            ${r.releasedAt}, ${r.validatedAt}, ${r.notes ?? null},
            ${sql.json(r.countryBreakdown ?? [])}, ${r.countryFileName}
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
};
const mapMailbox = (r: RawMailbox): Mailbox => ({
  id: r.id,
  email: r.email,
  provider: r.provider,
  connected: r.connected,
  invoicesFound: r.invoices_found,
  lastSync: r.last_sync ? r.last_sync.toISOString() : null,
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
});

type RawRevenue = {
  id: string;
  business_id: string;
  month: string;
  processor: string;
  currency: string;
  captured_amount: string;
  fees: string;
  rolling_reserve_amount: string;
  rolling_reserve_months: number;
  released_at: Date | null;
  validated_at: Date | null;
  notes: string | null;
  country_breakdown: CountryRevenue[];
  country_file_name: string | null;
};
const mapRevenue = (r: RawRevenue): Revenue => ({
  id: r.id,
  businessId: r.business_id,
  month: r.month,
  processor: r.processor,
  currency: r.currency,
  capturedAmount: Number(r.captured_amount),
  fees: Number(r.fees),
  rollingReserveAmount: Number(r.rolling_reserve_amount),
  rollingReserveMonths: r.rolling_reserve_months,
  releasedAt: r.released_at ? r.released_at.toISOString() : null,
  validatedAt: r.validated_at ? r.validated_at.toISOString() : null,
  notes: r.notes ?? undefined,
  countryBreakdown: r.country_breakdown ?? [],
  countryFileName: r.country_file_name,
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
      captured_amount, fees, rolling_reserve_amount, rolling_reserve_months,
      released_at, validated_at, notes, country_breakdown, country_file_name
    ) VALUES (
      ${r.id}, ${r.businessId}, ${r.month}, ${r.processor}, ${r.currency},
      ${r.capturedAmount}, ${r.fees}, ${r.rollingReserveAmount}, ${r.rollingReserveMonths},
      ${r.releasedAt}, ${r.validatedAt}, ${r.notes ?? null},
      ${sql.json(r.countryBreakdown ?? [])}, ${r.countryFileName}
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
      rolling_reserve_amount = ${merged.rollingReserveAmount},
      rolling_reserve_months = ${merged.rollingReserveMonths},
      released_at = ${merged.releasedAt},
      validated_at = ${merged.validatedAt},
      notes = ${merged.notes ?? null},
      country_breakdown = ${sql.json(merged.countryBreakdown ?? [])},
      country_file_name = ${merged.countryFileName}
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
      last_sync = ${merged.lastSync}
    WHERE id = ${id}
  `;
  return merged;
}
export async function deleteMailbox(id: string) {
  await client()`DELETE FROM mailboxes WHERE id = ${id}`;
}

// ---- Mappings ----
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
      attachment = ${merged.attachment ? sql.json(merged.attachment) : null}
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
