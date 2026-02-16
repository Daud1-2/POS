-- Canonicalize orders table to UUID primary key and data-authority fields.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'order_id'
  ) THEN
    ALTER TABLE orders RENAME COLUMN order_id TO legacy_order_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'branch_id'
  ) THEN
    ALTER TABLE orders RENAME COLUMN branch_id TO outlet_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'total_amount'
  ) THEN
    ALTER TABLE orders RENAME COLUMN total_amount TO total;
  END IF;
END$$;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

UPDATE orders
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE orders
ALTER COLUMN id SET NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.order_items') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'order_items'::regclass
        AND conname = 'order_items_order_id_fkey'
    ) THEN
      ALTER TABLE order_items DROP CONSTRAINT order_items_order_id_fkey;
    END IF;
  END IF;
END$$;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS legacy_order_id BIGINT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_legacy_order_id_unique
ON orders(legacy_order_id);

DO $$
DECLARE
  current_pk TEXT;
  pk_is_already_id BOOLEAN := FALSE;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'orders'::regclass
      AND c.contype = 'p'
    GROUP BY c.oid
    HAVING COUNT(*) = 1
       AND BOOL_AND(a.attname = 'id')
  )
  INTO pk_is_already_id;

  SELECT conname
  INTO current_pk
  FROM pg_constraint
  WHERE conrelid = 'orders'::regclass
    AND contype = 'p'
  LIMIT 1;

  IF current_pk IS NOT NULL AND NOT pk_is_already_id THEN
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT %I', current_pk);
  END IF;

  IF NOT pk_is_already_id AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'orders'::regclass
      AND contype = 'p'
      AND conname = 'orders_pkey'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
  END IF;
END$$;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS order_number TEXT;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'unpaid';

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS external_order_id TEXT;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS external_source TEXT;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'orders'::regclass
      AND contype = 'c'
  LOOP
    EXECUTE format('ALTER TABLE orders DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;
END$$;

UPDATE orders
SET source = 'kiosk'
WHERE source = 'app';

UPDATE orders
SET status = 'open'
WHERE status = 'new';

UPDATE orders
SET status = 'cancelled'
WHERE status = 'rejected';

UPDATE orders
SET source = 'pos'
WHERE source IS NULL OR source NOT IN ('pos', 'website', 'phone', 'kiosk');

UPDATE orders
SET status = 'open'
WHERE status IS NULL OR status NOT IN (
  'open',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
  'refunded'
);

UPDATE orders
SET payment_method = 'cash'
WHERE payment_method IS NULL OR payment_method NOT IN ('cash', 'card', 'online');

UPDATE orders
SET payment_status = CASE
  WHEN status = 'completed' THEN 'paid'
  ELSE 'unpaid'
END
WHERE payment_status IS NULL OR payment_status NOT IN ('unpaid', 'paid', 'partially_paid');

UPDATE orders
SET outlet_id = 1
WHERE outlet_id IS NULL;

UPDATE orders
SET metadata = '{}'::jsonb
WHERE metadata IS NULL;

UPDATE orders
SET updated_at = created_at
WHERE updated_at IS NULL;

UPDATE orders
SET order_number = 'ORD-' || LPAD(legacy_order_id::TEXT, 9, '0')
WHERE order_number IS NULL AND legacy_order_id IS NOT NULL;

ALTER TABLE orders
ALTER COLUMN source SET DEFAULT 'pos',
ALTER COLUMN source SET NOT NULL,
ALTER COLUMN order_type SET NOT NULL,
ALTER COLUMN status SET DEFAULT 'open',
ALTER COLUMN status SET NOT NULL,
ALTER COLUMN subtotal SET DEFAULT 0,
ALTER COLUMN subtotal SET NOT NULL,
ALTER COLUMN tax SET DEFAULT 0,
ALTER COLUMN tax SET NOT NULL,
ALTER COLUMN discount SET DEFAULT 0,
ALTER COLUMN discount SET NOT NULL,
ALTER COLUMN total SET DEFAULT 0,
ALTER COLUMN total SET NOT NULL,
ALTER COLUMN payment_status SET DEFAULT 'unpaid',
ALTER COLUMN payment_status SET NOT NULL,
ALTER COLUMN payment_method SET DEFAULT 'cash',
ALTER COLUMN payment_method SET NOT NULL,
ALTER COLUMN metadata SET DEFAULT '{}'::jsonb,
ALTER COLUMN metadata SET NOT NULL,
ALTER COLUMN updated_at SET DEFAULT now(),
ALTER COLUMN updated_at SET NOT NULL,
ALTER COLUMN outlet_id SET DEFAULT 1,
ALTER COLUMN outlet_id SET NOT NULL;

ALTER TABLE orders
ADD CONSTRAINT orders_source_check
CHECK (source IN ('pos', 'website', 'phone', 'kiosk'));

ALTER TABLE orders
ADD CONSTRAINT orders_type_check
CHECK (order_type IN ('dine_in', 'takeaway', 'delivery'));

ALTER TABLE orders
ADD CONSTRAINT orders_status_check
CHECK (status IN (
  'open',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
  'refunded'
));

ALTER TABLE orders
ADD CONSTRAINT orders_payment_status_check
CHECK (payment_status IN ('unpaid', 'paid', 'partially_paid'));

ALTER TABLE orders
ADD CONSTRAINT orders_payment_method_check
CHECK (payment_method IN ('cash', 'card', 'online'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_order_number_unique
ON orders(order_number);
