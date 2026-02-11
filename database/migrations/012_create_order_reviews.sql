-- Reviews linked to canonical orders.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS order_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  source VARCHAR(20) NOT NULL CHECK (source IN ('website', 'pos')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_reviews_order_id
ON order_reviews(order_id);

CREATE INDEX IF NOT EXISTS idx_order_reviews_created_at
ON order_reviews(created_at DESC);
