-- Add cashier_id to orders for traceability
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS cashier_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_orders_cashier_created_at
ON orders(cashier_id, created_at);
