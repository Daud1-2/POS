ALTER TABLE orders
ADD COLUMN IF NOT EXISTS customer_name_snapshot VARCHAR(160) NULL,
ADD COLUMN IF NOT EXISTS customer_phone_snapshot VARCHAR(20) NULL,
ADD COLUMN IF NOT EXISTS customer_email_snapshot VARCHAR(320) NULL;

DO $$
BEGIN
  IF to_regclass('public.customers') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'orders'::regclass
        AND conname = 'orders_customer_id_fkey'
    ) THEN
    ALTER TABLE orders
    ADD CONSTRAINT orders_customer_id_fkey
    FOREIGN KEY (customer_id)
    REFERENCES customers(id)
    DEFERRABLE INITIALLY DEFERRED
    NOT VALID;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_orders_outlet_customer_created_active
ON orders (outlet_id, customer_id, created_at)
WHERE deleted_at IS NULL;
