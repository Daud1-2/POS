CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS product_outlet_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  outlet_id INTEGER NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  price_override NUMERIC(12,2) NULL,
  stock_override INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'product_outlet_settings_price_override_non_negative'
  ) THEN
    ALTER TABLE product_outlet_settings
    ADD CONSTRAINT product_outlet_settings_price_override_non_negative
    CHECK (price_override IS NULL OR price_override >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'product_outlet_settings_stock_override_non_negative'
  ) THEN
    ALTER TABLE product_outlet_settings
    ADD CONSTRAINT product_outlet_settings_stock_override_non_negative
    CHECK (stock_override IS NULL OR stock_override >= 0);
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_product_outlet_settings_unique_active
ON product_outlet_settings(product_id, outlet_id)
WHERE deleted_at IS NULL;
