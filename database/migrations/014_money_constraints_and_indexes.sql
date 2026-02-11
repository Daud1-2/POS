-- Enforce canonical money precision and authority indexes.
ALTER TABLE orders
ALTER COLUMN subtotal TYPE NUMERIC(12,2),
ALTER COLUMN tax TYPE NUMERIC(12,2),
ALTER COLUMN discount TYPE NUMERIC(12,2),
ALTER COLUMN total TYPE NUMERIC(12,2);

ALTER TABLE order_items
ALTER COLUMN unit_price TYPE NUMERIC(12,2),
ALTER COLUMN total_price TYPE NUMERIC(12,2);

CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
ON orders(status, created_at);

CREATE INDEX IF NOT EXISTS idx_orders_source_created_at
ON orders(source, created_at);

CREATE INDEX IF NOT EXISTS idx_orders_outlet_created_at
ON orders(outlet_id, created_at);

CREATE INDEX IF NOT EXISTS idx_orders_scheduled_for
ON orders(scheduled_for);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id
ON order_items(order_id);

CREATE INDEX IF NOT EXISTS idx_order_items_product_id
ON order_items(product_id);

CREATE INDEX IF NOT EXISTS idx_orders_outlet_active_created_at
ON orders(outlet_id, created_at)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_outlet_deleted_created_at
ON orders(outlet_id, deleted_at, created_at);
