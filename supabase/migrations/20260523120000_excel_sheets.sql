-- Persistance des fichiers Excel de rapprochement, un par mois.
CREATE TABLE IF NOT EXISTS excel_sheets (
  month        TEXT PRIMARY KEY,           -- "YYYY-MM"
  file_name    TEXT NOT NULL,
  headers      JSONB NOT NULL DEFAULT '[]'::jsonb,
  rows         JSONB NOT NULL DEFAULT '[]'::jsonb,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
