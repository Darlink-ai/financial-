-- Cache des classifications LLM par créancier : évite de re-appeler
-- l'API Anthropic pour chaque facture du même fournisseur.
-- Quand le regex statique des folder_mappings ne matche pas, on
-- consulte ce cache puis on appelle Claude en dernier recours.

CREATE TABLE IF NOT EXISTS creditor_classifications (
  creditor          TEXT PRIMARY KEY,           -- nom normalisé (lowercase)
  folder_mapping_id TEXT NOT NULL REFERENCES folder_mappings(id) ON DELETE CASCADE,
  classified_by     TEXT NOT NULL DEFAULT 'llm',-- 'llm' | 'manual'
  confidence        NUMERIC,                    -- 0.0 - 1.0 (LLM uniquement)
  reasoning         TEXT,                       -- explication courte fournie par le LLM
  classified_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creditor_classifications_mapping_idx
  ON creditor_classifications(folder_mapping_id);
