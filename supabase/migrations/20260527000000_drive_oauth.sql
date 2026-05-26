-- Étend drive_config pour stocker les credentials OAuth Google Drive
-- (compte unique global, pas par mailbox) + le dossier racine où les
-- factures seront uploadées (créé automatiquement au premier upload).
-- Idempotent.

ALTER TABLE drive_config
  ADD COLUMN IF NOT EXISTS oauth_client_id     TEXT,
  ADD COLUMN IF NOT EXISTS oauth_client_secret TEXT,
  ADD COLUMN IF NOT EXISTS oauth_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS oauth_access_token  TEXT,
  ADD COLUMN IF NOT EXISTS oauth_expires_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS oauth_user_email    TEXT,
  ADD COLUMN IF NOT EXISTS oauth_scope         TEXT,
  ADD COLUMN IF NOT EXISTS root_folder_id      TEXT,
  ADD COLUMN IF NOT EXISTS root_folder_name    TEXT NOT NULL DEFAULT 'Comptabilité';
