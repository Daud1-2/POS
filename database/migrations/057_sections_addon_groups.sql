ALTER TABLE sections
  ADD COLUMN IF NOT EXISTS addon_groups JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE sections
SET addon_groups = '[]'::jsonb
WHERE addon_groups IS NULL;
