CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sms_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet_id INTEGER NOT NULL,
  name VARCHAR(180) NOT NULL,
  segment_key VARCHAR(40) NOT NULL CHECK (
    segment_key IN (
      'risk',
      'loyal',
      'all',
      'champions',
      'loyal_customers',
      'need_attention',
      'at_risk',
      'hibernating'
    )
  ),
  filters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  message_text TEXT NOT NULL,
  message_encoding VARCHAR(20) NOT NULL CHECK (message_encoding IN ('gsm7', 'unicode')),
  send_mode VARCHAR(20) NOT NULL CHECK (send_mode IN ('now', 'schedule')),
  scheduled_for TIMESTAMPTZ NULL,
  status VARCHAR(20) NOT NULL CHECK (
    status IN ('draft', 'scheduled', 'processing', 'completed', 'failed', 'cancelled')
  ),
  audience_total INTEGER NOT NULL DEFAULT 0 CHECK (audience_total >= 0),
  eligible_total INTEGER NOT NULL DEFAULT 0 CHECK (eligible_total >= 0),
  estimated_parts INTEGER NOT NULL DEFAULT 0 CHECK (estimated_parts >= 0),
  reserved_credits INTEGER NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  consumed_credits INTEGER NOT NULL DEFAULT 0 CHECK (consumed_credits >= 0),
  created_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT sms_campaigns_schedule_check CHECK (
    (send_mode = 'schedule' AND scheduled_for IS NOT NULL)
    OR (send_mode = 'now')
  ),
  CONSTRAINT sms_campaigns_credit_order_check CHECK (reserved_credits >= consumed_credits)
);
