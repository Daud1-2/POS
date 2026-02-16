CREATE TABLE IF NOT EXISTS sms_contact_preferences (
  id BIGSERIAL PRIMARY KEY,
  outlet_id INTEGER NOT NULL,
  phone_e164 VARCHAR(20) NOT NULL,
  marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  consent_source VARCHAR(100) NULL,
  consent_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_contact_preferences_unique_active
ON sms_contact_preferences (outlet_id, phone_e164)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sms_contact_preferences_lookup
ON sms_contact_preferences (outlet_id, marketing_opt_in, phone_e164)
WHERE deleted_at IS NULL;
