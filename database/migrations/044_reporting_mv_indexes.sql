CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_reporting_outlet_daily_unique
ON mv_reporting_outlet_daily (outlet_id, business_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_reporting_outlet_hourly_unique
ON mv_reporting_outlet_hourly (outlet_id, bucket_ts);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_reporting_product_daily_unique
ON mv_reporting_product_daily (outlet_id, business_date, product_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_reporting_discount_daily_unique
ON mv_reporting_discount_daily (outlet_id, business_date, promo_code_id, promo_code);

CREATE INDEX IF NOT EXISTS idx_mv_reporting_outlet_daily_date
ON mv_reporting_outlet_daily (business_date, outlet_id);

CREATE INDEX IF NOT EXISTS idx_mv_reporting_outlet_hourly_bucket
ON mv_reporting_outlet_hourly (bucket_ts, outlet_id);

CREATE INDEX IF NOT EXISTS idx_mv_reporting_product_daily_date
ON mv_reporting_product_daily (business_date, outlet_id, revenue DESC);

CREATE INDEX IF NOT EXISTS idx_mv_reporting_discount_daily_date
ON mv_reporting_discount_daily (business_date, outlet_id, revenue DESC);
