CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS branch_settings (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  branch_id BIGINT NOT NULL REFERENCES branches(id),
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  accepting_orders BOOLEAN NOT NULL DEFAULT TRUE,
  maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
  temporary_closed BOOLEAN NOT NULL DEFAULT FALSE,
  working_hours JSONB NOT NULL,
  enforce_working_hours BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_branch_settings_branch_unique
ON branch_settings (branch_id);
