ALTER TABLE orders
ADD COLUMN IF NOT EXISTS promo_code_id BIGINT NULL,
ADD COLUMN IF NOT EXISTS promo_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS bulk_discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF to_regclass('public.promo_codes') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'orders'::regclass
        AND conname = 'orders_promo_code_id_fkey'
    ) THEN
    ALTER TABLE orders
    ADD CONSTRAINT orders_promo_code_id_fkey
    FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id);
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'orders'::regclass
      AND conname = 'orders_promo_discount_amount_non_negative'
  ) THEN
    ALTER TABLE orders
    ADD CONSTRAINT orders_promo_discount_amount_non_negative
    CHECK (promo_discount_amount >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'orders'::regclass
      AND conname = 'orders_bulk_discount_amount_non_negative'
  ) THEN
    ALTER TABLE orders
    ADD CONSTRAINT orders_bulk_discount_amount_non_negative
    CHECK (bulk_discount_amount >= 0);
  END IF;
END$$;
