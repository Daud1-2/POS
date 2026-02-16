CREATE TABLE IF NOT EXISTS sms_campaign_recipients (
  id BIGSERIAL PRIMARY KEY,
  campaign_id UUID NOT NULL,
  outlet_id INTEGER NOT NULL,
  customer_id BIGINT NULL,
  phone_e164 VARCHAR(20) NOT NULL,
  sms_parts INTEGER NOT NULL DEFAULT 1 CHECK (sms_parts > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'sent', 'delivered', 'failed')
  ),
  provider_message_id VARCHAR(120) NULL,
  provider_status_raw TEXT NULL,
  error_code VARCHAR(120) NULL,
  error_message TEXT NULL,
  sent_at TIMESTAMPTZ NULL,
  delivered_at TIMESTAMPTZ NULL,
  failed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sms_campaign_recipients_campaign_id_fkey'
  ) THEN
    ALTER TABLE sms_campaign_recipients
    ADD CONSTRAINT sms_campaign_recipients_campaign_id_fkey
    FOREIGN KEY (campaign_id)
    REFERENCES sms_campaigns(id)
    ON DELETE CASCADE;
  END IF;

  IF to_regclass('public.customers') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'sms_campaign_recipients_customer_id_fkey'
    ) THEN
    ALTER TABLE sms_campaign_recipients
    ADD CONSTRAINT sms_campaign_recipients_customer_id_fkey
    FOREIGN KEY (customer_id)
    REFERENCES customers(id)
    ON DELETE SET NULL;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_campaign_recipients_dedupe_active
ON sms_campaign_recipients (campaign_id, phone_e164)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sms_campaign_recipients_provider_msg
ON sms_campaign_recipients (provider_message_id)
WHERE provider_message_id IS NOT NULL AND deleted_at IS NULL;
