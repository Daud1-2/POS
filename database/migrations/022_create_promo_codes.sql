CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS promo_codes (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  outlet_id INTEGER NOT NULL,
  code VARCHAR(120) NOT NULL,
  name VARCHAR(255) NOT NULL,
  applicable_on VARCHAR(10) NOT NULL DEFAULT 'both',
  discount_type VARCHAR(20) NOT NULL,
  discount_value NUMERIC(12,2) NOT NULL,
  min_order_amount NUMERIC(12,2) NULL,
  max_discount_amount NUMERIC(12,2) NULL,
  usage_limit INTEGER NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  per_user_limit INTEGER NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT promo_codes_uuid_unique UNIQUE (uuid),
  CONSTRAINT promo_codes_applicable_on_check CHECK (applicable_on IN ('app', 'web', 'both')),
  CONSTRAINT promo_codes_discount_type_check CHECK (discount_type IN ('percentage', 'fixed')),
  CONSTRAINT promo_codes_status_check CHECK (status IN ('active', 'inactive')),
  CONSTRAINT promo_codes_discount_value_check CHECK (discount_value > 0),
  CONSTRAINT promo_codes_percentage_limit_check CHECK (discount_type <> 'percentage' OR discount_value <= 100),
  CONSTRAINT promo_codes_min_order_amount_check CHECK (min_order_amount IS NULL OR min_order_amount >= 0),
  CONSTRAINT promo_codes_max_discount_amount_check CHECK (max_discount_amount IS NULL OR max_discount_amount >= 0),
  CONSTRAINT promo_codes_usage_limit_check CHECK (usage_limit IS NULL OR usage_limit > 0),
  CONSTRAINT promo_codes_used_count_check CHECK (used_count >= 0),
  CONSTRAINT promo_codes_used_count_limit_check CHECK (usage_limit IS NULL OR used_count <= usage_limit),
  CONSTRAINT promo_codes_per_user_limit_check CHECK (per_user_limit IS NULL OR per_user_limit > 0),
  CONSTRAINT promo_codes_time_window_check CHECK (end_time > start_time)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_code_unique_active
ON promo_codes (outlet_id, LOWER(code))
WHERE deleted_at IS NULL;
