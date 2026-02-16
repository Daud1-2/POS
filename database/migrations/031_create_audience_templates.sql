CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS audience_templates (
  id BIGSERIAL PRIMARY KEY,
  uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  outlet_id INTEGER NOT NULL,
  name VARCHAR(180) NOT NULL,
  platform VARCHAR(20) NOT NULL DEFAULT 'both',
  segment_key VARCHAR(40) NOT NULL,
  filters_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  lookalike_seed_segment VARCHAR(40) NOT NULL DEFAULT 'champions',
  created_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT audience_templates_uuid_unique UNIQUE (uuid),
  CONSTRAINT audience_templates_platform_check CHECK (platform IN ('meta', 'google', 'both')),
  CONSTRAINT audience_templates_segment_key_check CHECK (
    segment_key IN ('champions', 'loyal_customers', 'need_attention', 'at_risk', 'hibernating', 'all')
  ),
  CONSTRAINT audience_templates_seed_segment_check CHECK (
    lookalike_seed_segment IN ('champions', 'loyal_customers', 'need_attention', 'at_risk', 'hibernating', 'all')
  )
);

CREATE INDEX IF NOT EXISTS idx_audience_templates_outlet_created
ON audience_templates (outlet_id, created_at DESC)
WHERE deleted_at IS NULL;
