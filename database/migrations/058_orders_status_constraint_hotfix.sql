-- Hotfix for environments where migration 055 was not applied.
-- Brings orders status constraint to canonical POS/online lifecycle values.

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS order_channel VARCHAR(30);

UPDATE orders
SET order_channel = CASE
  WHEN source IN ('pos', 'kiosk', 'phone') THEN 'pos'
  WHEN source = 'website' THEN 'online'
  ELSE 'pos'
END
WHERE order_channel IS NULL OR order_channel = '';

UPDATE orders
SET order_channel = 'pos'
WHERE order_channel NOT IN ('pos', 'online', 'whatsapp', 'delivery_platform');

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
    WHEN status IN ('open', 'pending', 'draft') THEN 'new'
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
DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE orders
DROP CONSTRAINT IF EXISTS orders_channel_check;

ALTER TABLE orders
ADD CONSTRAINT orders_channel_check
CHECK (order_channel IN ('pos', 'online', 'whatsapp', 'delivery_platform'));

ALTER TABLE orders
ADD CONSTRAINT orders_status_check
CHECK (
  status IN (
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
