CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS cashier_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id BIGINT NOT NULL,
  shift_date DATE NOT NULL,
  cashier_id TEXT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time TIMESTAMPTZ NULL,
  opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
  expenses NUMERIC(12,2) NOT NULL DEFAULT 0,
  expected_cash NUMERIC(12,2) NULL,
  closing_cash NUMERIC(12,2) NULL,
  difference NUMERIC(12,2) NULL,
  reconciliation_status VARCHAR(10) NULL CHECK (reconciliation_status IN ('Perfect', 'Over', 'Short')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cashier_shifts_opening_cash_non_negative CHECK (opening_cash >= 0),
  CONSTRAINT cashier_shifts_expenses_non_negative CHECK (expenses >= 0),
  CONSTRAINT cashier_shifts_closing_cash_non_negative CHECK (closing_cash IS NULL OR closing_cash >= 0),
  CONSTRAINT cashier_shifts_expected_cash_non_negative CHECK (expected_cash IS NULL OR expected_cash >= 0),
  CONSTRAINT cashier_shifts_one_opening_per_day UNIQUE (outlet_id, shift_date)
);

CREATE INDEX IF NOT EXISTS idx_cashier_shifts_outlet_date
ON cashier_shifts (outlet_id, shift_date DESC);

CREATE INDEX IF NOT EXISTS idx_cashier_shifts_status
ON cashier_shifts (status, start_time DESC);
