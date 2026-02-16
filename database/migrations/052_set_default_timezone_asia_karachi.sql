ALTER TABLE branches
ALTER COLUMN timezone SET DEFAULT 'Asia/Karachi';

UPDATE branches
SET
  timezone = 'Asia/Karachi',
  updated_at = now()
WHERE
  deleted_at IS NULL
  AND (
    timezone IS NULL
    OR btrim(timezone) = ''
    OR timezone = 'UTC'
  );
