-- Supprime les factures de démo qui avaient été seedées au premier lancement.
-- Idempotent : si elles n'existent plus, la requête ne fait rien.
DELETE FROM invoices
WHERE id IN (
  'inv-1', 'inv-2', 'inv-3', 'inv-4', 'inv-5',
  'inv-6', 'inv-7', 'inv-8', 'inv-9'
);
