ALTER TABLE business_settings
ADD COLUMN IF NOT EXISTS admin_switch_pin VARCHAR(12) NOT NULL DEFAULT '0000';

UPDATE business_settings
SET admin_switch_pin = '0000'
WHERE admin_switch_pin IS NULL OR btrim(admin_switch_pin) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_settings_admin_switch_pin_format'
  ) THEN
    ALTER TABLE business_settings
    ADD CONSTRAINT business_settings_admin_switch_pin_format
    CHECK (admin_switch_pin ~ '^[0-9]{4}$');
  END IF;
END$$;
