ALTER TABLE products
ADD COLUMN IF NOT EXISTS profit_value NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_profit_value_non_negative'
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_profit_value_non_negative CHECK (profit_value >= 0);
  END IF;
END$$;
