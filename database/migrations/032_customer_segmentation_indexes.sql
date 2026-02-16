CREATE INDEX IF NOT EXISTS idx_orders_outlet_status_customer_created_active
ON orders (outlet_id, status, customer_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_outlet_last_seen_active
ON customers (outlet_id, last_seen_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_customers_outlet_type_active
ON customers (outlet_id, customer_type)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sms_templates_outlet_created_active
ON sms_campaign_templates (outlet_id, created_at DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_audience_templates_outlet_created_active
ON audience_templates (outlet_id, created_at DESC)
WHERE deleted_at IS NULL;
