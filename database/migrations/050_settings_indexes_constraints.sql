CREATE INDEX IF NOT EXISTS idx_branch_settings_branch_id
ON branch_settings(branch_id);

CREATE INDEX IF NOT EXISTS idx_branches_timezone
ON branches(timezone)
WHERE deleted_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_settings_default_tax_percent_range'
  ) THEN
    ALTER TABLE business_settings
    ADD CONSTRAINT business_settings_default_tax_percent_range
    CHECK (default_tax_percent >= 0 AND default_tax_percent <= 100);
  END IF;
END$$;

CREATE OR REPLACE FUNCTION is_valid_working_hours(payload JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  day_name TEXT;
  open_text TEXT;
  close_text TEXT;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload) <> 'object' THEN
    RETURN FALSE;
  END IF;

  FOREACH day_name IN ARRAY ARRAY[
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday'
  ]
  LOOP
    IF NOT (payload ? day_name) THEN
      RETURN FALSE;
    END IF;

    IF jsonb_typeof(payload -> day_name) <> 'object' THEN
      RETURN FALSE;
    END IF;

    open_text := payload -> day_name ->> 'open';
    close_text := payload -> day_name ->> 'close';

    IF open_text IS NULL OR close_text IS NULL THEN
      RETURN FALSE;
    END IF;

    IF open_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RETURN FALSE;
    END IF;

    IF close_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'branch_settings_working_hours_shape'
  ) THEN
    ALTER TABLE branch_settings
    ADD CONSTRAINT branch_settings_working_hours_shape
    CHECK (is_valid_working_hours(working_hours));
  END IF;
END$$;
