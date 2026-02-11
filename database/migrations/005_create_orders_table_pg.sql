-- Create Orders Table (PostgreSQL)
CREATE TABLE IF NOT EXISTS orders (
  order_id BIGSERIAL PRIMARY KEY,
  branch_id BIGINT,
  order_type VARCHAR(20) NOT NULL CHECK (order_type IN ('dine_in', 'takeaway', 'delivery')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('new', 'preparing', 'ready', 'completed', 'rejected')),
  subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0,
  discount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  tax NUMERIC(10, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(10, 2) NOT NULL DEFAULT 0,
  source VARCHAR(20) NOT NULL DEFAULT 'pos' CHECK (source IN ('pos', 'website', 'app')),
  payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('cash', 'card')),
  customer_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_status_created_at ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_type_created_at ON orders(order_type, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_source_created_at ON orders(source, created_at);
