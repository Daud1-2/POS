CREATE TABLE IF NOT EXISTS sms_credit_ledger (
  id BIGSERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('credit', 'debit')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  reason VARCHAR(80) NOT NULL,
  campaign_id UUID NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_sms_credit_ledger_outlet_created
ON sms_credit_ledger (outlet_id, created_at DESC);
