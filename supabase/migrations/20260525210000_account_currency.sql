-- Sépare les factures et les fichiers Excel par compte bancaire (USD / EUR / CHF).
-- Le default est USD pour tout ce qui existe déjà.

-- 1. Crée excel_sheets si absente avec PK composite (cas neuf)
CREATE TABLE IF NOT EXISTS excel_sheets (
  month             TEXT NOT NULL,
  account_currency  TEXT NOT NULL DEFAULT 'USD',
  file_name         TEXT NOT NULL,
  headers           JSONB NOT NULL DEFAULT '[]'::jsonb,
  rows              JSONB NOT NULL DEFAULT '[]'::jsonb,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (month, account_currency)
);

-- 2. Si la table existait déjà avec une PK simple sur month, on ajoute la colonne
-- et on bascule en PK composite. Idempotent.
ALTER TABLE excel_sheets
  ADD COLUMN IF NOT EXISTS account_currency TEXT NOT NULL DEFAULT 'USD';

DO $$
DECLARE
  pk_cols TEXT;
BEGIN
  SELECT string_agg(a.attname, ',' ORDER BY a.attnum) INTO pk_cols
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'excel_sheets' AND c.contype = 'p';

  IF pk_cols = 'month' THEN
    ALTER TABLE excel_sheets DROP CONSTRAINT excel_sheets_pkey;
    ALTER TABLE excel_sheets ADD PRIMARY KEY (month, account_currency);
  END IF;
END $$;

-- 3. Invoices : compte associé (USD par défaut)
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS account_currency TEXT NOT NULL DEFAULT 'USD';

CREATE INDEX IF NOT EXISTS invoices_account_currency_idx ON invoices(account_currency);
