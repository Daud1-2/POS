DROP MATERIALIZED VIEW IF EXISTS mv_reporting_outlet_daily;
CREATE MATERIALIZED VIEW mv_reporting_outlet_daily AS
SELECT
  o.outlet_id,
  (o.created_at AT TIME ZONE 'UTC')::date AS business_date,
  COUNT(*)::bigint AS orders_count,
  COALESCE(SUM(o.subtotal), 0)::numeric(14,2) AS subtotal_amount,
  COALESCE(SUM(o.tax), 0)::numeric(14,2) AS tax_amount,
  COALESCE(SUM(o.discount), 0)::numeric(14,2) AS discount_amount,
  COALESCE(SUM(o.total), 0)::numeric(14,2) AS total_collected,
  COALESCE(SUM(CASE WHEN o.payment_method = 'cash' THEN o.total ELSE 0 END), 0)::numeric(14,2) AS cash_amount,
  COALESCE(SUM(CASE WHEN o.payment_method = 'card' THEN o.total ELSE 0 END), 0)::numeric(14,2) AS card_amount,
  COALESCE(SUM(CASE WHEN o.payment_method = 'online' THEN o.total ELSE 0 END), 0)::numeric(14,2) AS online_amount,
  SUM(CASE WHEN o.payment_method = 'cash' THEN 1 ELSE 0 END)::bigint AS cash_count,
  SUM(CASE WHEN o.payment_method = 'card' THEN 1 ELSE 0 END)::bigint AS card_count,
  SUM(CASE WHEN o.payment_method = 'online' THEN 1 ELSE 0 END)::bigint AS online_count
FROM orders o
WHERE o.deleted_at IS NULL
  AND o.status = 'completed'
GROUP BY o.outlet_id, (o.created_at AT TIME ZONE 'UTC')::date;

DROP MATERIALIZED VIEW IF EXISTS mv_reporting_outlet_hourly;
CREATE MATERIALIZED VIEW mv_reporting_outlet_hourly AS
SELECT
  o.outlet_id,
  date_trunc('hour', o.created_at AT TIME ZONE 'UTC') AS bucket_ts,
  COUNT(*)::bigint AS orders_count,
  COALESCE(SUM(o.total), 0)::numeric(14,2) AS revenue
FROM orders o
WHERE o.deleted_at IS NULL
  AND o.status = 'completed'
GROUP BY o.outlet_id, date_trunc('hour', o.created_at AT TIME ZONE 'UTC');

DROP MATERIALIZED VIEW IF EXISTS mv_reporting_product_daily;
CREATE MATERIALIZED VIEW mv_reporting_product_daily AS
SELECT
  o.outlet_id,
  (o.created_at AT TIME ZONE 'UTC')::date AS business_date,
  oi.product_id,
  COALESCE(MAX(oi.product_name), MAX(p.name), 'Unknown') AS product_name,
  MAX(s.name) AS section_name,
  MAX(c.name) AS category_name,
  SUM(oi.quantity)::bigint AS units_sold,
  COALESCE(SUM(oi.total_price), 0)::numeric(14,2) AS revenue,
  COALESCE(SUM(
    CASE
      WHEN o.subtotal > 0 THEN (oi.total_price / o.subtotal) * o.discount
      ELSE 0
    END
  ), 0)::numeric(14,2) AS discount_impact,
  COALESCE(SUM(oi.quantity * COALESCE(p.cost_price, 0)), 0)::numeric(14,2) AS estimated_cost,
  COALESCE(SUM(oi.total_price - (oi.quantity * COALESCE(p.cost_price, 0))), 0)::numeric(14,2) AS estimated_profit
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
LEFT JOIN products p ON p.id = oi.product_id
LEFT JOIN sections s ON s.id = p.section_id
LEFT JOIN categories c ON c.id = p.category_id
WHERE o.deleted_at IS NULL
  AND o.status = 'completed'
GROUP BY
  o.outlet_id,
  (o.created_at AT TIME ZONE 'UTC')::date,
  oi.product_id;

DROP MATERIALIZED VIEW IF EXISTS mv_reporting_discount_daily;
CREATE MATERIALIZED VIEW mv_reporting_discount_daily AS
SELECT
  o.outlet_id,
  (o.created_at AT TIME ZONE 'UTC')::date AS business_date,
  o.promo_code_id,
  COALESCE(pc.code, 'NO_PROMO') AS promo_code,
  COUNT(*)::bigint AS orders_count,
  COALESCE(SUM(o.total), 0)::numeric(14,2) AS revenue,
  COALESCE(SUM(o.promo_discount_amount), 0)::numeric(14,2) AS promo_discount_amount,
  COALESCE(SUM(o.bulk_discount_amount), 0)::numeric(14,2) AS bulk_discount_amount,
  COALESCE(SUM(o.discount), 0)::numeric(14,2) AS total_discount_amount
FROM orders o
LEFT JOIN promo_codes pc ON pc.id = o.promo_code_id
WHERE o.deleted_at IS NULL
  AND o.status = 'completed'
GROUP BY
  o.outlet_id,
  (o.created_at AT TIME ZONE 'UTC')::date,
  o.promo_code_id,
  COALESCE(pc.code, 'NO_PROMO');
