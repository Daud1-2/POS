CREATE TABLE IF NOT EXISTS sms_sender_configs (
  id BIGSERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL,
  provider VARCHAR(20) NOT NULL DEFAULT 'twilio' CHECK (provider IN ('twilio')),
  from_number VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_sender_configs_outlet_unique_active
ON sms_sender_configs (outlet_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sms_sender_configs_outlet_status
ON sms_sender_configs (outlet_id, status)
WHERE deleted_at IS NULL;
