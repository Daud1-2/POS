CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS customers (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  outlet_id INTEGER NOT NULL,
  full_name VARCHAR(160) NULL,
  phone_e164 VARCHAR(20) NULL,
  email VARCHAR(320) NULL,
  customer_type VARCHAR(20) NOT NULL DEFAULT 'guest',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT customers_uuid_unique UNIQUE (uuid),
  CONSTRAINT customers_customer_type_check CHECK (customer_type IN ('registered', 'guest', 'unidentified'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_outlet_phone_unique_active
ON customers (outlet_id, phone_e164)
WHERE deleted_at IS NULL AND phone_e164 IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_outlet_email_unique_active
ON customers (outlet_id, LOWER(email))
WHERE deleted_at IS NULL AND email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_outlet_created_at
ON customers (outlet_id, created_at)
WHERE deleted_at IS NULL;
