-- Comptage par statut de transaction + décomposition des frais processeur.
-- Tout est en JSONB, éditable, sans contrainte de schéma stricte.

ALTER TABLE revenues
  ADD COLUMN IF NOT EXISTS tx_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS fee_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;
