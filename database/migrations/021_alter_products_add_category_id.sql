ALTER TABLE products
ADD COLUMN IF NOT EXISTS category_id BIGINT NULL;

DO $$
BEGIN
  IF to_regclass('public.categories') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'products'::regclass
        AND conname = 'products_category_id_fkey'
    ) THEN
    ALTER TABLE products
    ADD CONSTRAINT products_category_id_fkey
    FOREIGN KEY (category_id) REFERENCES categories(id);
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_products_category_id
ON products(category_id);
