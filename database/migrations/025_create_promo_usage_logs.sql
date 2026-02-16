CREATE TABLE IF NOT EXISTS promo_usage_logs (
  id BIGSERIAL PRIMARY KEY,
  promo_code_id BIGINT NOT NULL,
  order_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  discount_amount NUMERIC(12,2) NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  outlet_id INTEGER NOT NULL,
  CONSTRAINT promo_usage_logs_discount_amount_check CHECK (discount_amount >= 0),
  CONSTRAINT promo_usage_logs_unique_order UNIQUE (promo_code_id, order_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'promo_usage_logs'::regclass
      AND conname = 'promo_usage_logs_promo_code_id_fkey'
  ) THEN
    ALTER TABLE promo_usage_logs
    ADD CONSTRAINT promo_usage_logs_promo_code_id_fkey
    FOREIGN KEY (promo_code_id) REFERENCES promo_codes(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'promo_usage_logs'::regclass
      AND conname = 'promo_usage_logs_order_id_fkey'
  ) THEN
    ALTER TABLE promo_usage_logs
    ADD CONSTRAINT promo_usage_logs_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders(id);
  END IF;
END$$;
