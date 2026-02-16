CREATE INDEX IF NOT EXISTS idx_sms_campaigns_outlet_status_schedule
ON sms_campaigns (outlet_id, status, scheduled_for, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sms_campaign_recipients_campaign_status
ON sms_campaign_recipients (campaign_id, status, created_at)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sms_contact_preferences_optin
ON sms_contact_preferences (outlet_id, phone_e164, marketing_opt_in)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sms_credit_ledger_outlet_reason_created
ON sms_credit_ledger (outlet_id, reason, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_sender_configs_outlet_active
ON sms_sender_configs (outlet_id, updated_at DESC)
WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF to_regclass('public.sms_campaigns') IS NOT NULL
    AND to_regclass('public.sms_credit_ledger') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'sms_credit_ledger_campaign_id_fkey'
    ) THEN
    ALTER TABLE sms_credit_ledger
    ADD CONSTRAINT sms_credit_ledger_campaign_id_fkey
    FOREIGN KEY (campaign_id)
    REFERENCES sms_campaigns(id)
    ON DELETE SET NULL
    NOT VALID;
  END IF;
END$$;
