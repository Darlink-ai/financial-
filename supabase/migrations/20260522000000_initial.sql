-- Factura — schema initial (Postgres)
-- Tables alignées avec les types TS de lib/types.ts

CREATE TABLE IF NOT EXISTS businesses (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  color       TEXT NOT NULL,
  processor   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL,
  provider        TEXT NOT NULL,
  connected       BOOLEAN NOT NULL DEFAULT FALSE,
  invoices_found  INT NOT NULL DEFAULT 0,
  last_sync       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS folder_mappings (
  id                TEXT PRIMARY KEY,
  creditor_pattern  TEXT NOT NULL,
  folder_code       TEXT NOT NULL,
  folder_label      TEXT NOT NULL,
  notes             TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id                  TEXT PRIMARY KEY,
  subject             TEXT NOT NULL,
  from_email          TEXT NOT NULL,
  mailbox             TEXT NOT NULL,
  received_at         TIMESTAMPTZ NOT NULL,
  creditor            TEXT,
  invoice_date        DATE,
  amount              NUMERIC(14, 2),
  currency            TEXT,
  folder_code         TEXT,
  folder_label        TEXT,
  final_name          TEXT,
  drive_path          TEXT,
  status              TEXT NOT NULL,
  excel_row_matched   INT,
  attachment          JSONB
);

CREATE INDEX IF NOT EXISTS invoices_received_at_idx ON invoices(received_at DESC);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices(status);

CREATE TABLE IF NOT EXISTS revenues (
  id                        TEXT PRIMARY KEY,
  business_id               TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  month                     TEXT NOT NULL,  -- "YYYY-MM"
  processor                 TEXT NOT NULL,
  currency                  TEXT NOT NULL,
  captured_amount           NUMERIC(14, 2) NOT NULL DEFAULT 0,
  fees                      NUMERIC(14, 2) NOT NULL DEFAULT 0,
  rolling_reserve_amount    NUMERIC(14, 2) NOT NULL DEFAULT 0,
  rolling_reserve_months    INT NOT NULL DEFAULT 0,
  released_at               TIMESTAMPTZ,
  validated_at              TIMESTAMPTZ,
  notes                     TEXT,
  country_breakdown         JSONB NOT NULL DEFAULT '[]'::jsonb,
  country_file_name         TEXT
);

CREATE INDEX IF NOT EXISTS revenues_business_month_idx ON revenues(business_id, month);
CREATE INDEX IF NOT EXISTS revenues_month_idx ON revenues(month);

CREATE TABLE IF NOT EXISTS drive_config (
  id         INT PRIMARY KEY CHECK (id = 1),
  provider   TEXT,
  connected  BOOLEAN NOT NULL DEFAULT FALSE,
  root_path  TEXT
);

INSERT INTO drive_config (id, provider, connected, root_path)
VALUES (1, NULL, FALSE, NULL)
ON CONFLICT (id) DO NOTHING;
