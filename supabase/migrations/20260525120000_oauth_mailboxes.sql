-- Settings d'application (clé/valeur), notamment OAuth client_id/secret Google.
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tokens OAuth par boîte mail + état du dernier sync.
ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS oauth_refresh_token   TEXT,
  ADD COLUMN IF NOT EXISTS oauth_access_token    TEXT,
  ADD COLUMN IF NOT EXISTS oauth_expires_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS oauth_scope           TEXT,
  ADD COLUMN IF NOT EXISTS oauth_user_email      TEXT,   -- email réel renvoyé par Google
  ADD COLUMN IF NOT EXISTS last_history_id       TEXT;   -- pour sync incrémental Gmail
