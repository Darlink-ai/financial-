-- Convertit rolling_reserve_amount (CHF/USD) en rolling_reserve_percent (% du capturé).
-- Le montant réel se recalcule à la volée côté app : captured * percent / 100.

ALTER TABLE revenues
  ADD COLUMN IF NOT EXISTS rolling_reserve_percent NUMERIC(6, 2) NOT NULL DEFAULT 0;

UPDATE revenues
SET rolling_reserve_percent = CASE
  WHEN captured_amount IS NULL OR captured_amount <= 0 THEN 0
  ELSE ROUND((rolling_reserve_amount / captured_amount * 100)::numeric, 2)
END
WHERE rolling_reserve_percent = 0
  AND rolling_reserve_amount IS NOT NULL
  AND rolling_reserve_amount > 0;

ALTER TABLE revenues DROP COLUMN IF EXISTS rolling_reserve_amount;
