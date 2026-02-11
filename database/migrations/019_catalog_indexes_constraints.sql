DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'products'::regclass
      AND conname = 'products_sku_key'
  ) THEN
    ALTER TABLE products DROP CONSTRAINT products_sku_key;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_unique_active
ON products(LOWER(sku))
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_section_id
ON products(section_id);

CREATE INDEX IF NOT EXISTS idx_products_is_active
ON products(is_active);

CREATE INDEX IF NOT EXISTS idx_products_active_lookup
ON products(is_active, deleted_at, section_id);

CREATE INDEX IF NOT EXISTS idx_product_outlet_settings_outlet_id
ON product_outlet_settings(outlet_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_product_outlet_settings_product_id
ON product_outlet_settings(product_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sections_display_order_active
ON sections(display_order, created_at)
WHERE deleted_at IS NULL;
