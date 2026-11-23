-- Attribution d'une ligne Excel (debit) à une personne : Gauthier, Robin,
-- Jacqueline (Maman) ou « À créer ». Un enregistrement par ligne.
-- `creditor_key` est la description normalisée de la ligne, utilisée pour
-- propager l'attribution aux autres lignes futures du même fournisseur.
-- Idempotente.

CREATE TABLE IF NOT EXISTS row_assignments (
  month              TEXT        NOT NULL,
  account_currency   TEXT        NOT NULL,
  row_number         INT         NOT NULL,
  assignee           TEXT        NOT NULL,
  creditor_key       TEXT,
  assigned_by        TEXT,
  assigned_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  auto_cascaded      BOOLEAN     NOT NULL DEFAULT FALSE,
  PRIMARY KEY (month, account_currency, row_number)
);

CREATE INDEX IF NOT EXISTS idx_row_assignments_assignee
  ON row_assignments (assignee);

CREATE INDEX IF NOT EXISTS idx_row_assignments_creditor_key
  ON row_assignments (creditor_key)
  WHERE creditor_key IS NOT NULL;
