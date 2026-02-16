CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS sms_campaign_templates (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  outlet_id INTEGER NOT NULL,
  name VARCHAR(180) NOT NULL,
  segment_key VARCHAR(40) NOT NULL,
  filters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  message_template TEXT NOT NULL,
  suggested_send_hour_local INTEGER NOT NULL DEFAULT 18,
  audience_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT sms_campaign_templates_uuid_unique UNIQUE (uuid),
  CONSTRAINT sms_campaign_templates_segment_key_check CHECK (
    segment_key IN ('champions', 'loyal_customers', 'need_attention', 'at_risk', 'hibernating', 'all')
  ),
  CONSTRAINT sms_campaign_templates_status_check CHECK (status IN ('draft', 'approved', 'archived')),
  CONSTRAINT sms_campaign_templates_send_hour_check CHECK (suggested_send_hour_local BETWEEN 0 AND 23),
  CONSTRAINT sms_campaign_templates_audience_count_check CHECK (audience_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sms_campaign_templates_outlet_created
ON sms_campaign_templates (outlet_id, created_at DESC)
WHERE deleted_at IS NULL;
