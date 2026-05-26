-- Diagnostics par facture pour comprendre les blocages en `analyzing`.
-- Idempotent (peut être relancée sans risque).

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS retry_count        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error         TEXT,
  ADD COLUMN IF NOT EXISTS last_processed_at  TIMESTAMPTZ;
