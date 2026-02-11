CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'price'
  ) THEN
    ALTER TABLE products RENAME COLUMN price TO base_price;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'stock'
  ) THEN
    ALTER TABLE products RENAME COLUMN stock TO stock_quantity;
  END IF;
END$$;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS product_uid UUID;

UPDATE products
SET product_uid = gen_random_uuid()
WHERE product_uid IS NULL;

ALTER TABLE products
ALTER COLUMN product_uid SET DEFAULT gen_random_uuid(),
ALTER COLUMN product_uid SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_product_uid
ON products(product_uid);

ALTER TABLE products
ADD COLUMN IF NOT EXISTS description TEXT,
ADD COLUMN IF NOT EXISTS barcode VARCHAR(120),
ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS section_id UUID,
ADD COLUMN IF NOT EXISTS tax_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS track_inventory BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

ALTER TABLE products
ALTER COLUMN base_price TYPE NUMERIC(12,2),
ALTER COLUMN stock_quantity TYPE INTEGER;

ALTER TABLE products
ALTER COLUMN base_price SET NOT NULL,
ALTER COLUMN stock_quantity SET DEFAULT 0,
ALTER COLUMN stock_quantity SET NOT NULL,
ALTER COLUMN is_active SET DEFAULT TRUE,
ALTER COLUMN is_active SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_base_price_non_negative'
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_base_price_non_negative CHECK (base_price >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_stock_quantity_non_negative'
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_stock_quantity_non_negative CHECK (stock_quantity >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_cost_price_non_negative'
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_cost_price_non_negative CHECK (cost_price IS NULL OR cost_price >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_tax_rate_non_negative'
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_tax_rate_non_negative CHECK (tax_rate >= 0);
  END IF;
END$$;

INSERT INTO sections (name, description, display_order, is_active, outlet_id)
SELECT 'Uncategorized', 'Default section for existing products', 0, TRUE, NULL
WHERE NOT EXISTS (
  SELECT 1
  FROM sections
  WHERE LOWER(name) = 'uncategorized'
    AND outlet_id IS NULL
    AND deleted_at IS NULL
);

UPDATE products
SET section_id = (
  SELECT s.id
  FROM sections s
  WHERE LOWER(s.name) = 'uncategorized'
    AND s.outlet_id IS NULL
    AND s.deleted_at IS NULL
  ORDER BY s.created_at ASC
  LIMIT 1
)
WHERE section_id IS NULL;

ALTER TABLE products
ALTER COLUMN section_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'products_section_id_fkey'
  ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_section_id_fkey
    FOREIGN KEY (section_id) REFERENCES sections(id);
  END IF;
END$$;
