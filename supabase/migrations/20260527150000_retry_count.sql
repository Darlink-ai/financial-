-- Compteur de tentatives de traitement automatique. Au-delà d'un seuil
-- (MAX_RETRIES côté code), on bascule l'invoice en `manual` au lieu
-- de la laisser indéfiniment en `analyzing`.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;
