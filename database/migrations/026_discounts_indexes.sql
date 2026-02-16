CREATE INDEX IF NOT EXISTS idx_promo_codes_code_lookup
ON promo_codes(LOWER(code));

CREATE INDEX IF NOT EXISTS idx_promo_codes_outlet_status_window
ON promo_codes(outlet_id, status, start_time, end_time)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bulk_discounts_outlet_status_window_priority
ON bulk_discounts(outlet_id, status, start_time, end_time, priority DESC)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bulk_discounts_applies_to
ON bulk_discounts(applies_to)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bulk_discounts_product_id
ON bulk_discounts(product_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bulk_discounts_category_id
ON bulk_discounts(category_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bulk_discounts_section_id
ON bulk_discounts(section_id)
WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_promo_usage_logs_promo_used_at
ON promo_usage_logs(promo_code_id, used_at DESC);

CREATE INDEX IF NOT EXISTS idx_promo_usage_logs_user_lookup
ON promo_usage_logs(promo_code_id, user_id, used_at DESC);
