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

    IF open_text = close_text THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$$;
