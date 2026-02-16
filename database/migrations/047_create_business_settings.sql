CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'rounding_rule_enum'
  ) THEN
    CREATE TYPE rounding_rule_enum AS ENUM (
      'none',
      'round_up',
      'round_down',
      'bankers_rounding'
    );
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS business_settings (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  default_currency VARCHAR(10) NOT NULL DEFAULT 'PKR',
  tax_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  default_tax_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  rounding_rule rounding_rule_enum NOT NULL DEFAULT 'none',
  discount_stacking_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_settings_singleton
ON business_settings ((1));

INSERT INTO business_settings (
  default_currency,
  tax_enabled,
  default_tax_percent,
  rounding_rule,
  discount_stacking_enabled
)
SELECT
  'PKR',
  FALSE,
  0,
  'none'::rounding_rule_enum,
  TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM business_settings
);
