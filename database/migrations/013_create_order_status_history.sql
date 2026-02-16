-- Immutable order status audit log.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS order_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status VARCHAR(30),
  to_status VARCHAR(30) NOT NULL,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE order_status_history
DROP CONSTRAINT IF EXISTS order_status_history_to_status_check;

UPDATE order_status_history
SET to_status = 'open'
WHERE to_status IN ('new', 'pending');

UPDATE order_status_history
SET to_status = 'preparing'
WHERE to_status = 'accepted';

UPDATE order_status_history
SET to_status = 'out_for_delivery'
WHERE to_status = 'on_the_way';

UPDATE order_status_history
SET to_status = 'completed'
WHERE to_status = 'delivered';

UPDATE order_status_history
SET to_status = 'cancelled'
WHERE to_status IN ('rejected', 'failed');

UPDATE order_status_history
SET to_status = 'open'
WHERE to_status IS NULL
   OR to_status NOT IN (
     'open',
     'preparing',
     'ready',
     'out_for_delivery',
     'completed',
     'cancelled',
     'refunded'
   );

ALTER TABLE order_status_history
ADD CONSTRAINT order_status_history_to_status_check
CHECK (
  to_status IN (
    'open',
    'preparing',
    'ready',
    'out_for_delivery',
    'completed',
    'cancelled',
    'refunded'
  )
);

CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id
ON order_status_history(order_id, changed_at DESC);
