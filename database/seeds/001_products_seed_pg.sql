INSERT INTO products (name, sku, price, stock, is_active)
VALUES
  ('Cola 500ml', 'COLA-500', 120.00, 48, TRUE),
  ('Water 1.5L', 'WATER-15', 80.00, 64, TRUE),
  ('Chips', 'CHIPS-01', 60.00, 100, TRUE)
ON CONFLICT (sku) DO UPDATE
SET
  name = EXCLUDED.name,
  price = EXCLUDED.price,
  stock = EXCLUDED.stock,
  is_active = EXCLUDED.is_active,
  updated_at = now();
