-- Offline-first sync v2 core schema (backward-compatible).
-- Adds device identity, idempotent sync journal/dedupe, pull cursors,
-- inventory ledger + reconciliation, conflict/audit tables, and feature flags.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Branch-level feature flags (phase-gated rollout).
CREATE TABLE IF NOT EXISTS branch_feature_flags (
  branch_id BIGINT PRIMARY KEY REFERENCES branches(id),
  offline_v2_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  edge_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO branch_feature_flags (branch_id, offline_v2_enabled, edge_enabled)
SELECT b.id, FALSE, FALSE
FROM branches b
LEFT JOIN branch_feature_flags f ON f.branch_id = b.id
WHERE b.deleted_at IS NULL
  AND f.branch_id IS NULL;

-- Device registry + key material.
CREATE TABLE IF NOT EXISTS devices (
  id BIGSERIAL PRIMARY KEY,
  device_id UUID NOT NULL UNIQUE,
  installation_id UUID NOT NULL,
  branch_id BIGINT NOT NULL REFERENCES branches(id),
  terminal_code VARCHAR(64) NOT NULL,
  label VARCHAR(120),
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'revoked')),
  created_by TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_branch_terminal_unique
ON devices(branch_id, terminal_code);

CREATE INDEX IF NOT EXISTS idx_devices_branch_status
ON devices(branch_id, status);

CREATE TABLE IF NOT EXISTS device_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  key_version INTEGER NOT NULL DEFAULT 1,
  secret_ciphertext TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_device_keys_one_active
ON device_keys(device_id)
WHERE is_active = TRUE;

-- Immutable-ish sync event journal.
CREATE TABLE IF NOT EXISTS sync_event_journal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL,
  device_id UUID NOT NULL REFERENCES devices(device_id),
  branch_id BIGINT NOT NULL REFERENCES branches(id),
  device_seq BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  aggregate_type VARCHAR(64),
  aggregate_id TEXT,
  client_created_at TIMESTAMPTZ,
  client_hlc TEXT,
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  prev_hash TEXT,
  signature TEXT,
  request_headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_status VARCHAR(20) NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'applied', 'duplicate', 'conflict', 'rejected', 'failed')),
  processing_error TEXT,
  server_order_id UUID,
  conflict_id UUID
);

CREATE INDEX IF NOT EXISTS idx_sync_event_journal_branch_received
ON sync_event_journal(branch_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_event_journal_device_seq
ON sync_event_journal(device_id, device_seq DESC);

CREATE TABLE IF NOT EXISTS sync_event_dedupe (
  id BIGSERIAL PRIMARY KEY,
  event_id UUID NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  device_id UUID NOT NULL REFERENCES devices(device_id),
  branch_id BIGINT NOT NULL REFERENCES branches(id),
  device_seq BIGINT NOT NULL,
  ack_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_event_dedupe_device_seq
ON sync_event_dedupe(device_id, device_seq);

CREATE INDEX IF NOT EXISTS idx_sync_event_dedupe_branch
ON sync_event_dedupe(branch_id, first_seen_at DESC);

CREATE TABLE IF NOT EXISTS sync_pull_cursor (
  device_id UUID NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  branch_id BIGINT NOT NULL REFERENCES branches(id),
  stream_name VARCHAR(64) NOT NULL,
  cursor_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, branch_id, stream_name)
);

-- Inventory authority trail and reconciliation tasks.
CREATE TABLE IF NOT EXISTS inventory_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id BIGINT NOT NULL REFERENCES branches(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  order_id UUID REFERENCES orders(id),
  source_event_id UUID,
  delta_qty INTEGER NOT NULL,
  balance_after INTEGER,
  reason VARCHAR(64) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_branch_product_created
ON inventory_ledger(branch_id, product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inventory_ledger_event
ON inventory_ledger(source_event_id);

CREATE TABLE IF NOT EXISTS inventory_reconciliation_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id BIGINT NOT NULL REFERENCES branches(id),
  product_id BIGINT REFERENCES products(id),
  related_order_id UUID REFERENCES orders(id),
  source_event_id UUID,
  reason VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_review', 'resolved', 'dismissed')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inventory_recon_branch_status
ON inventory_reconciliation_tasks(branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL,
  branch_id BIGINT NOT NULL REFERENCES branches(id),
  device_id UUID REFERENCES devices(device_id),
  conflict_type VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'dismissed')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolution JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_conflicts_branch_status
ON sync_conflicts(branch_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS price_change_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id BIGINT REFERENCES branches(id),
  product_id BIGINT NOT NULL REFERENCES products(id),
  scope VARCHAR(20) NOT NULL CHECK (scope IN ('global', 'branch')),
  old_base_price NUMERIC(12,2),
  new_base_price NUMERIC(12,2),
  old_price_override NUMERIC(12,2),
  new_price_override NUMERIC(12,2),
  version_before BIGINT,
  version_after BIGINT,
  changed_by TEXT,
  device_id UUID REFERENCES devices(device_id),
  source_event_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_change_audit_product_created
ON price_change_audit(product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS security_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id BIGINT REFERENCES branches(id),
  device_id UUID REFERENCES devices(device_id),
  category VARCHAR(64) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'medium'
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_branch_created
ON security_audit_log(branch_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_security_audit_device_created
ON security_audit_log(device_id, created_at DESC);

-- Extend authority tables for offline provenance and optimistic versioning.
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS client_order_id UUID,
ADD COLUMN IF NOT EXISTS source_device_id UUID,
ADD COLUMN IF NOT EXISTS source_event_id UUID,
ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS client_created_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_outlet_client_order_unique
ON orders(outlet_id, client_order_id)
WHERE client_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_source_event_id
ON orders(source_event_id)
WHERE source_event_id IS NOT NULL;

ALTER TABLE order_items
ADD COLUMN IF NOT EXISTS source_event_id UUID;

CREATE INDEX IF NOT EXISTS idx_order_items_source_event_id
ON order_items(source_event_id)
WHERE source_event_id IS NOT NULL;

ALTER TABLE products
ADD COLUMN IF NOT EXISTS base_price_version BIGINT NOT NULL DEFAULT 0;

ALTER TABLE product_outlet_settings
ADD COLUMN IF NOT EXISTS price_version BIGINT NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_updated_by_device_id UUID;

CREATE INDEX IF NOT EXISTS idx_product_outlet_settings_price_version
ON product_outlet_settings(outlet_id, product_id, price_version)
WHERE deleted_at IS NULL;
