-- Canonical order channel + lifecycle state machine migration.

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS order_channel VARCHAR(30);

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ;

UPDATE orders
SET order_channel = CASE
  WHEN source IN ('pos', 'kiosk', 'phone') THEN 'pos'
  WHEN source = 'website' THEN 'online'
  ELSE 'pos'
END
WHERE order_channel IS NULL OR order_channel = '';

ALTER TABLE orders
DROP CONSTRAINT IF EXISTS orders_status_check;

UPDATE orders
SET status = CASE
  WHEN order_channel = 'online' THEN CASE
    WHEN status IN ('new') THEN 'new'
    WHEN status IN ('accepted') THEN 'accepted'
    WHEN status IN ('preparing') THEN 'preparing'
    WHEN status IN ('ready', 'out_for_delivery') THEN 'ready'
    WHEN status IN ('completed') THEN 'completed'
    WHEN status IN ('cancelled', 'rejected') THEN 'rejected'
    WHEN status IN ('refunded') THEN 'refunded'
    WHEN status IN ('open', 'pending') THEN 'new'
    ELSE 'new'
  END
  ELSE CASE
    WHEN status IN ('draft') THEN 'draft'
    WHEN status IN ('pending', 'open', 'preparing', 'ready', 'out_for_delivery') THEN 'pending'
    WHEN status IN ('completed') THEN 'completed'
    WHEN status IN ('cancelled') THEN 'cancelled'
    WHEN status IN ('refunded') THEN 'refunded'
    WHEN status IN ('rejected') THEN 'cancelled'
    WHEN status IN ('new', 'accepted') THEN 'pending'
    ELSE 'pending'
  END
END;

ALTER TABLE orders
ALTER COLUMN order_channel SET DEFAULT 'pos',
ALTER COLUMN order_channel SET NOT NULL,
ALTER COLUMN status SET DEFAULT 'pending',
ALTER COLUMN status SET NOT NULL;

ALTER TABLE orders
DROP CONSTRAINT IF EXISTS orders_channel_check;

ALTER TABLE orders
ADD CONSTRAINT orders_channel_check
CHECK (order_channel IN ('pos', 'online', 'whatsapp', 'delivery_platform'));

ALTER TABLE orders
ADD CONSTRAINT orders_status_check
CHECK (status IN (
  'draft',
  'pending',
  'completed',
  'cancelled',
  'refunded',
  'new',
  'accepted',
  'preparing',
  'ready',
  'rejected'
));

ALTER TABLE order_status_history
DROP CONSTRAINT IF EXISTS order_status_history_to_status_check;

UPDATE order_status_history
SET to_status = 'pending'
WHERE to_status = 'open';

ALTER TABLE order_status_history
ADD CONSTRAINT order_status_history_to_status_check
CHECK (
  to_status IN (
    'draft',
    'pending',
    'completed',
    'cancelled',
    'refunded',
    'new',
    'accepted',
    'preparing',
    'ready',
    'rejected'
  )
);

WITH latest_refund AS (
  SELECT order_id, MAX(changed_at) AS refunded_at
  FROM order_status_history
  WHERE to_status = 'refunded'
  GROUP BY order_id
)
UPDATE orders o
SET refunded_at = latest_refund.refunded_at
FROM latest_refund
WHERE o.id = latest_refund.order_id
  AND (o.refunded_at IS NULL OR o.refunded_at <> latest_refund.refunded_at);

UPDATE orders
SET refunded_at = updated_at
WHERE status = 'refunded'
  AND refunded_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_outlet_channel_status_created_at
ON orders(outlet_id, order_channel, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_live_queue_partial
ON orders(outlet_id, created_at DESC)
WHERE deleted_at IS NULL
  AND status IN ('pending', 'new', 'accepted', 'preparing', 'ready');

CREATE INDEX IF NOT EXISTS idx_orders_outlet_refunded_at
ON orders(outlet_id, refunded_at)
WHERE refunded_at IS NOT NULL;
