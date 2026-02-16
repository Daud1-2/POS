CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS bulk_discounts (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  outlet_id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  discount_type VARCHAR(20) NOT NULL,
  discount_value NUMERIC(12,2) NOT NULL,
  applies_to VARCHAR(20) NOT NULL,
  category_id BIGINT NULL,
  product_id BIGINT NULL,
  section_id UUID NULL,
  branch_id INTEGER NULL,
  min_quantity INTEGER NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  priority INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(10) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT bulk_discounts_uuid_unique UNIQUE (uuid),
  CONSTRAINT bulk_discounts_discount_type_check CHECK (discount_type IN ('percentage', 'fixed')),
  CONSTRAINT bulk_discounts_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT bulk_discounts_applies_to_check CHECK (applies_to IN ('category', 'product', 'section', 'branch')),
  CONSTRAINT bulk_discounts_discount_value_check CHECK (discount_value > 0),
  CONSTRAINT bulk_discounts_percentage_limit_check CHECK (discount_type <> 'percentage' OR discount_value <= 100),
  CONSTRAINT bulk_discounts_min_quantity_check CHECK (min_quantity IS NULL OR min_quantity > 0),
  CONSTRAINT bulk_discounts_time_window_check CHECK (end_time > start_time),
  CONSTRAINT bulk_discounts_target_consistency_check CHECK (
    (applies_to = 'category' AND category_id IS NOT NULL AND product_id IS NULL AND section_id IS NULL)
    OR
    (applies_to = 'product' AND category_id IS NULL AND product_id IS NOT NULL AND section_id IS NULL)
    OR
    (applies_to = 'section' AND category_id IS NULL AND product_id IS NULL AND section_id IS NOT NULL)
    OR
    (applies_to = 'branch' AND category_id IS NULL AND product_id IS NULL AND section_id IS NULL)
  )
);

DO $$
BEGIN
  IF to_regclass('public.categories') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'bulk_discounts'::regclass
        AND conname = 'bulk_discounts_category_id_fkey'
    ) THEN
    ALTER TABLE bulk_discounts
    ADD CONSTRAINT bulk_discounts_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES categories(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'bulk_discounts'::regclass
      AND conname = 'bulk_discounts_product_id_fkey'
  ) THEN
    ALTER TABLE bulk_discounts
    ADD CONSTRAINT bulk_discounts_product_id_fkey
    FOREIGN KEY (product_id) REFERENCES products(id);
  END IF;

  IF to_regclass('public.sections') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'bulk_discounts'::regclass
        AND conname = 'bulk_discounts_section_id_fkey'
    ) THEN
    ALTER TABLE bulk_discounts
    ADD CONSTRAINT bulk_discounts_section_id_fkey
    FOREIGN KEY (section_id) REFERENCES sections(id);
  END IF;
END$$;
