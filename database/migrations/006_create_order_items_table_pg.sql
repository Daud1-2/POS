-- Create Order Items Table (PostgreSQL)
CREATE TABLE IF NOT EXISTS order_items (
  order_item_id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  product_id BIGINT,
  product_name VARCHAR(255) NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  quantity INT NOT NULL,
  total_price NUMERIC(10, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
