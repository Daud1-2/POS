-- Add canonical UUID linkage in order_items while keeping legacy_order_id for transition.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'order_item_id'
  ) THEN
    ALTER TABLE order_items RENAME COLUMN order_item_id TO id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'order_items' AND column_name = 'order_id'
      AND data_type IN ('bigint', 'integer', 'numeric')
  ) THEN
    ALTER TABLE order_items RENAME COLUMN order_id TO legacy_order_id;
  END IF;
END$$;

ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS id BIGSERIAL;

DO $$
DECLARE
  current_pk TEXT;
BEGIN
  SELECT conname
  INTO current_pk
  FROM pg_constraint
  WHERE conrelid = 'order_items'::regclass
    AND contype = 'p'
  LIMIT 1;

  IF current_pk IS NULL THEN
    ALTER TABLE order_items ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);
  END IF;
END$$;

ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS order_id UUID;

ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS modifiers JSONB DEFAULT '{}'::jsonb;

UPDATE order_items oi
SET order_id = o.id
FROM orders o
WHERE oi.order_id IS NULL
  AND oi.legacy_order_id IS NOT NULL
  AND o.legacy_order_id = oi.legacy_order_id;

UPDATE order_items
SET modifiers = '{}'::jsonb
WHERE modifiers IS NULL;

ALTER TABLE order_items
ALTER COLUMN order_id SET NOT NULL,
ALTER COLUMN modifiers SET DEFAULT '{}'::jsonb,
ALTER COLUMN modifiers SET NOT NULL;

DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'order_items'::regclass
      AND contype = 'f'
      AND conname = 'order_items_order_id_fkey'
  LOOP
    EXECUTE format('ALTER TABLE order_items DROP CONSTRAINT IF EXISTS %I', rec.conname);
  END LOOP;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'order_items'::regclass
      AND contype = 'f'
      AND conname = 'order_items_order_id_fkey'
  ) THEN
    ALTER TABLE order_items
    ADD CONSTRAINT order_items_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;
  END IF;
END$$;
