-- Credentials Google OAuth par boîte mail (au lieu de la table globale
-- app_settings). Plus simple à gérer pour le user : chaque boîte est
-- autonome.
ALTER TABLE mailboxes
  ADD COLUMN IF NOT EXISTS oauth_client_id     TEXT,
  ADD COLUMN IF NOT EXISTS oauth_client_secret TEXT;
