WITH discovered_branches AS (
  SELECT DISTINCT outlet_id::BIGINT AS branch_id
  FROM orders
  WHERE outlet_id IS NOT NULL
  UNION
  SELECT 1::BIGINT AS branch_id
)
INSERT INTO branches (
  id,
  name,
  timezone,
  is_active,
  created_at,
  updated_at
)
SELECT
  d.branch_id,
  'Branch ' || d.branch_id::TEXT,
  'Asia/Karachi',
  TRUE,
  now(),
  now()
FROM discovered_branches d
WHERE NOT EXISTS (
  SELECT 1
  FROM branches b
  WHERE b.id = d.branch_id
);

INSERT INTO branch_settings (
  branch_id,
  is_open,
  accepting_orders,
  maintenance_mode,
  temporary_closed,
  working_hours,
  enforce_working_hours,
  created_at,
  updated_at
)
SELECT
  b.id,
  TRUE,
  TRUE,
  FALSE,
  FALSE,
  jsonb_build_object(
    'monday', jsonb_build_object('open', '09:00', 'close', '22:00'),
    'tuesday', jsonb_build_object('open', '09:00', 'close', '22:00'),
    'wednesday', jsonb_build_object('open', '09:00', 'close', '22:00'),
    'thursday', jsonb_build_object('open', '09:00', 'close', '22:00'),
    'friday', jsonb_build_object('open', '09:00', 'close', '22:00'),
    'saturday', jsonb_build_object('open', '09:00', 'close', '22:00'),
    'sunday', jsonb_build_object('open', '09:00', 'close', '22:00')
  ),
  TRUE,
  now(),
  now()
FROM branches b
WHERE NOT EXISTS (
  SELECT 1
  FROM branch_settings bs
  WHERE bs.branch_id = b.id
);
