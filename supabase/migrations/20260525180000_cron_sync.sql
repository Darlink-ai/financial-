-- Cron de synchronisation des boîtes Gmail :
-- * sync_enabled sur chaque mailbox (toggle UI pour inclure/exclure)
-- * dédup des invoices par (mailbox_id, source_message_id) — index UNIQUE
-- * historique des runs dans sync_runs (succès / erreurs / décomptes)

ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS mailbox_id          TEXT,
  ADD COLUMN IF NOT EXISTS source_message_id   TEXT,
  ADD COLUMN IF NOT EXISTS attachment_b64      TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_source_msg_uniq
  ON invoices(mailbox_id, source_message_id)
  WHERE source_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS sync_runs (
  id            TEXT PRIMARY KEY,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  trigger       TEXT NOT NULL,           -- 'cron' | 'manual'
  results       JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_added   INT NOT NULL DEFAULT 0,
  total_skipped INT NOT NULL DEFAULT 0,
  error         TEXT
);

CREATE INDEX IF NOT EXISTS sync_runs_started_at_idx ON sync_runs(started_at DESC);
