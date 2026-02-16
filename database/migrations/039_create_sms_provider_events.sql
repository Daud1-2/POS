CREATE TABLE IF NOT EXISTS sms_provider_events (
  id BIGSERIAL PRIMARY KEY,
  outlet_id INTEGER NULL,
  campaign_id UUID NULL,
  recipient_id BIGINT NULL,
  provider VARCHAR(20) NOT NULL DEFAULT 'twilio',
  provider_message_id VARCHAR(120) NULL,
  event_type VARCHAR(40) NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  signature_valid BOOLEAN NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ NULL,
  error TEXT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sms_provider_events_campaign_id_fkey'
  ) THEN
    ALTER TABLE sms_provider_events
    ADD CONSTRAINT sms_provider_events_campaign_id_fkey
    FOREIGN KEY (campaign_id)
    REFERENCES sms_campaigns(id)
    ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sms_provider_events_recipient_id_fkey'
  ) THEN
    ALTER TABLE sms_provider_events
    ADD CONSTRAINT sms_provider_events_recipient_id_fkey
    FOREIGN KEY (recipient_id)
    REFERENCES sms_campaign_recipients(id)
    ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_sms_provider_events_msg_received
ON sms_provider_events (provider_message_id, received_at DESC);
