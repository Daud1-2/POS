-- Add source column to classify order origin
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS source VARCHAR(20);

ALTER TABLE orders
ALTER COLUMN source SET DEFAULT 'pos';

UPDATE orders
SET source = 'pos'
WHERE source IS NULL;

ALTER TABLE orders
ALTER COLUMN source SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'orders_source_check'
  ) THEN
    ALTER TABLE orders
    ADD CONSTRAINT orders_source_check
    CHECK (source IN ('pos', 'website', 'app'));
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_orders_source_created_at ON orders(source, created_at);
