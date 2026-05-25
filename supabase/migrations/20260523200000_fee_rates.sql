-- Renomme fee_breakdown (anciennement des totaux par ligne) en fee_rates :
-- la sémantique du champ change, on stocke maintenant les tarifs unitaires
-- éditables, et le total est calculé à la volée côté app.
ALTER TABLE revenues
  RENAME COLUMN fee_breakdown TO fee_rates;
