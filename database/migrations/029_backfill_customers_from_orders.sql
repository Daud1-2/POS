-- Persist legacy customer_id in metadata then relink to canonical customers.
UPDATE orders
SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('legacy_customer_id', customer_id)
WHERE customer_id IS NOT NULL
  AND deleted_at IS NULL
  AND (metadata IS NULL OR NOT (metadata ? 'legacy_customer_id'));

UPDATE orders
SET customer_id = NULL
WHERE customer_id IS NOT NULL
  AND deleted_at IS NULL;

WITH source_rows AS (
  SELECT
    o.id AS order_id,
    o.outlet_id,
    NULLIF(TRIM(COALESCE(
      o.customer_name_snapshot,
      o.metadata->>'customer_name',
      o.metadata->>'customerName',
      o.metadata->>'name'
    )), '') AS full_name,
    NULLIF(TRIM(COALESCE(
      o.customer_phone_snapshot,
      o.metadata->>'customer_phone',
      o.metadata->>'customerPhone',
      o.metadata->>'phone'
    )), '') AS phone_e164,
    LOWER(NULLIF(TRIM(COALESCE(
      o.customer_email_snapshot,
      o.metadata->>'customer_email',
      o.metadata->>'customerEmail',
      o.metadata->>'email'
    )), '')) AS email,
    o.created_at
  FROM orders o
  WHERE o.deleted_at IS NULL
),
to_insert AS (
  SELECT DISTINCT
    outlet_id,
    full_name,
    phone_e164,
    email,
    CASE
      WHEN phone_e164 IS NULL AND email IS NULL THEN 'unidentified'
      ELSE 'guest'
    END AS customer_type,
    MIN(created_at) OVER (PARTITION BY outlet_id, COALESCE(phone_e164, ''), COALESCE(email, ''), COALESCE(full_name, '')) AS first_seen_at,
    MAX(created_at) OVER (PARTITION BY outlet_id, COALESCE(phone_e164, ''), COALESCE(email, ''), COALESCE(full_name, '')) AS last_seen_at
  FROM source_rows
  WHERE phone_e164 IS NOT NULL OR email IS NOT NULL OR full_name IS NOT NULL
)
INSERT INTO customers (
  outlet_id,
  full_name,
  phone_e164,
  email,
  customer_type,
  first_seen_at,
  last_seen_at,
  created_at,
  updated_at
)
SELECT
  outlet_id,
  full_name,
  phone_e164,
  email,
  customer_type,
  first_seen_at,
  last_seen_at,
  now(),
  now()
FROM to_insert
ON CONFLICT DO NOTHING;

WITH source_rows AS (
  SELECT
    o.id AS order_id,
    o.outlet_id,
    LOWER(NULLIF(TRIM(COALESCE(
      o.customer_email_snapshot,
      o.metadata->>'customer_email',
      o.metadata->>'customerEmail',
      o.metadata->>'email'
    )), '')) AS email,
    NULLIF(TRIM(COALESCE(
      o.customer_phone_snapshot,
      o.metadata->>'customer_phone',
      o.metadata->>'customerPhone',
      o.metadata->>'phone'
    )), '') AS phone_e164
  FROM orders o
  WHERE o.deleted_at IS NULL
),
resolved AS (
  SELECT
    s.order_id,
    c.id AS customer_id
  FROM source_rows s
  JOIN LATERAL (
    SELECT c.id
    FROM customers c
    WHERE c.outlet_id = s.outlet_id
      AND c.deleted_at IS NULL
      AND (
        (s.phone_e164 IS NOT NULL AND c.phone_e164 = s.phone_e164)
        OR (s.email IS NOT NULL AND LOWER(c.email) = s.email)
      )
    ORDER BY
      CASE WHEN s.phone_e164 IS NOT NULL AND c.phone_e164 = s.phone_e164 THEN 0 ELSE 1 END,
      CASE WHEN s.email IS NOT NULL AND LOWER(c.email) = s.email THEN 0 ELSE 1 END,
      c.id ASC
    LIMIT 1
  ) c ON TRUE
)
UPDATE orders o
SET customer_id = r.customer_id
FROM resolved r
WHERE o.id = r.order_id;

-- Maintain seen windows for matched customers.
UPDATE customers c
SET
  first_seen_at = COALESCE(stats.first_ordered_at, c.first_seen_at),
  last_seen_at = COALESCE(stats.last_ordered_at, c.last_seen_at),
  updated_at = now()
FROM (
  SELECT
    customer_id,
    MIN(created_at) AS first_ordered_at,
    MAX(created_at) AS last_ordered_at
  FROM orders
  WHERE deleted_at IS NULL
    AND customer_id IS NOT NULL
  GROUP BY customer_id
) stats
WHERE c.id = stats.customer_id;
