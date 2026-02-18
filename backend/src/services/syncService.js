const crypto = require('crypto');
const db = require('./db');
const { createOrder, updateOrderStatus, ValidationError: OrderValidationError } = require('./ordersService');
const { getBranchSettingsById } = require('./settingsService');

const ALLOWED_EVENT_TYPES = new Set([
  'sale.created',
  'sale.status_changed',
  'inventory.adjusted',
  'price.override_set',
  'catalog.snapshot_applied',
  'device.heartbeat',
]);

const DEFAULT_STREAM_CURSORS = Object.freeze({
  catalog: '1970-01-01T00:00:00.000Z',
  orders: '1970-01-01T00:00:00.000Z',
  inventory: '1970-01-01T00:00:00.000Z',
  conflicts: '1970-01-01T00:00:00.000Z',
  sections: '1970-01-01T00:00:00.000Z',
});

class SyncValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'SyncValidationError';
    this.statusCode = statusCode;
  }
}

const isUuid = (value) =>
  typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());

const toPositiveInt = (value, fieldName = 'value') => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SyncValidationError(`${fieldName} must be a positive integer`);
  }
  return parsed;
};

const toOptionalPositiveInt = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
};

const toIsoTimestamp = (value, fieldName = 'timestamp') => {
  if (value === undefined || value === null || value === '') return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) {
    throw new SyncValidationError(`${fieldName} must be a valid timestamp`);
  }
  return dt.toISOString();
};

const normalizeText = (value, fieldName, { required = false, max = 255 } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new SyncValidationError(`${fieldName} is required`);
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    if (required) throw new SyncValidationError(`${fieldName} is required`);
    return null;
  }
  if (text.length > max) {
    throw new SyncValidationError(`${fieldName} must be <= ${max} chars`);
  }
  return text;
};

const normalizeObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
};

const toEventTimestamp = (value) => {
  const parsed = toIsoTimestamp(value, 'client_created_at');
  return parsed || new Date().toISOString();
};

const computeHash = (value) =>
  crypto.createHash('sha256').update(String(value || '')).digest('hex');

const computeEventSignature = ({ secret, payloadHash, prevHash, deviceSeq, eventType }) =>
  crypto
    .createHmac('sha256', secret)
    .update(`${payloadHash}|${prevHash || ''}|${deviceSeq}|${eventType}`)
    .digest('hex');

const computeRequestSignature = ({
  secret,
  requestTimestamp,
  requestIdempotencyKey,
  payloadHash,
}) =>
  crypto
    .createHmac('sha256', secret)
    .update(`${requestTimestamp}|${requestIdempotencyKey}|${payloadHash}`)
    .digest('hex');

const normalizeSecret = (value) => normalizeText(value, 'device_secret', { required: true, max: 512 });

const generateDeviceSecret = () => crypto.randomBytes(32).toString('hex');

const isUniqueViolation = (err) => err?.code === '23505';

const nowIso = () => new Date().toISOString();

const writeSecurityAudit = async ({
  client,
  branchId = null,
  deviceId = null,
  category,
  severity = 'medium',
  details = {},
}) => {
  await client.query(
    `
    INSERT INTO security_audit_log (
      branch_id,
      device_id,
      category,
      severity,
      details,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, now())
    `,
    [branchId, deviceId, category, severity, JSON.stringify(normalizeObject(details))]
  );
};

const assertSyncFeatureEnabled = async ({ client, branchId }) => {
  if (process.env.OFFLINE_V2_FORCE_ENABLED === 'true') return;

  try {
    const result = await client.query(
      `
      SELECT offline_v2_enabled
      FROM branch_feature_flags
      WHERE branch_id = $1
      LIMIT 1
      `,
      [branchId]
    );
    const enabled = Boolean(result.rows[0]?.offline_v2_enabled);
    if (!enabled) {
      throw new SyncValidationError('Offline sync v2 is disabled for this branch', 409);
    }
  } catch (err) {
    if (err instanceof SyncValidationError) throw err;
    if (process.env.NODE_ENV !== 'production') return;
    throw new SyncValidationError('Offline sync v2 feature flags are not ready', 500);
  }
};

const readDeviceHeaders = (headers = {}) => ({
  device_id: normalizeText(headers['x-device-id'], 'X-Device-Id', { required: true, max: 100 }),
  terminal_code: normalizeText(headers['x-terminal-code'], 'X-Terminal-Code', { required: true, max: 100 }),
  request_timestamp: normalizeText(headers['x-request-timestamp'], 'X-Request-Timestamp', {
    required: true,
    max: 128,
  }),
  request_signature: normalizeText(headers['x-signature'], 'X-Signature', { required: true, max: 512 }),
  request_idempotency_key: normalizeText(headers['x-idempotency-key'], 'X-Idempotency-Key', {
    required: false,
    max: 512,
  }),
});

const assertFreshRequestTimestamp = (rawValue) => {
  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    throw new SyncValidationError('X-Request-Timestamp must be an ISO timestamp');
  }
  const driftMs = Math.abs(Date.now() - parsed.getTime());
  if (driftMs > 10 * 60 * 1000) {
    throw new SyncValidationError('Request timestamp drift exceeds 10 minutes', 401);
  }
};

const assertRequestSignature = ({
  secret,
  requestTimestamp,
  requestIdempotencyKey,
  payloadHash = '',
  requestSignature,
}) => {
  if (!requestIdempotencyKey) {
    throw new SyncValidationError('X-Idempotency-Key is required', 401);
  }
  const expected = computeRequestSignature({
    secret,
    requestTimestamp,
    requestIdempotencyKey,
    payloadHash,
  });
  if (expected !== requestSignature) {
    throw new SyncValidationError('Request signature verification failed', 401);
  }
};

const normalizeRegisterPayload = (payload = {}) => {
  const body = normalizeObject(payload);
  const deviceIdRaw = body.device_id || body.deviceId || crypto.randomUUID();
  const installationIdRaw = body.installation_id || body.installationId || crypto.randomUUID();
  const terminalCode = normalizeText(body.terminal_code || body.terminalCode, 'terminal_code', {
    required: true,
    max: 64,
  });
  const label = normalizeText(body.label, 'label', { required: false, max: 120 });
  const metadata = normalizeObject(body.metadata);

  if (!isUuid(deviceIdRaw)) {
    throw new SyncValidationError('device_id must be a UUID');
  }
  if (!isUuid(installationIdRaw)) {
    throw new SyncValidationError('installation_id must be a UUID');
  }

  return {
    device_id: String(deviceIdRaw).trim().toLowerCase(),
    installation_id: String(installationIdRaw).trim().toLowerCase(),
    terminal_code: terminalCode,
    label,
    metadata,
  };
};

const resolveDeviceWithActiveKey = async ({ client, deviceId, branchId, terminalCode }) => {
  const result = await client.query(
    `
    SELECT
      d.device_id,
      d.installation_id,
      d.branch_id,
      d.terminal_code,
      d.status,
      k.key_version,
      k.secret_ciphertext
    FROM devices d
    LEFT JOIN device_keys k
      ON k.device_id = d.device_id
      AND k.is_active = TRUE
    WHERE d.device_id = $1
      AND d.branch_id = $2
      AND d.terminal_code = $3
    LIMIT 1
    `,
    [deviceId, branchId, terminalCode]
  );
  const row = result.rows[0];
  if (!row) {
    throw new SyncValidationError('Unknown device for this branch/terminal', 404);
  }
  if (row.status !== 'active') {
    throw new SyncValidationError('Device is disabled', 403);
  }
  if (!row.secret_ciphertext) {
    throw new SyncValidationError('Active device key not found', 409);
  }
  return {
    device_id: row.device_id,
    installation_id: row.installation_id,
    branch_id: Number(row.branch_id),
    terminal_code: row.terminal_code,
    key_version: Number(row.key_version || 1),
    device_secret: row.secret_ciphertext,
  };
};

const loadMaxKnownDeviceSeq = async ({ client, deviceId }) => {
  const result = await client.query(
    `
    SELECT COALESCE(MAX(device_seq), 0) AS max_seq
    FROM sync_event_dedupe
    WHERE device_id = $1
    `,
    [deviceId]
  );
  return Number(result.rows[0]?.max_seq || 0);
};

const normalizeEvent = (event = {}, index = 0) => {
  const item = normalizeObject(event);
  const eventId = normalizeText(item.event_id || item.id, `events[${index}].event_id`, {
    required: true,
    max: 100,
  });
  if (!isUuid(eventId)) {
    throw new SyncValidationError(`events[${index}].event_id must be UUID`);
  }

  const idempotencyKey = normalizeText(item.idempotency_key, `events[${index}].idempotency_key`, {
    required: true,
    max: 512,
  });
  const deviceId = normalizeText(item.device_id, `events[${index}].device_id`, { required: true, max: 100 });
  if (!isUuid(deviceId)) {
    throw new SyncValidationError(`events[${index}].device_id must be UUID`);
  }
  const branchId = toPositiveInt(item.branch_id, `events[${index}].branch_id`);
  const deviceSeq = Number(item.device_seq);
  if (!Number.isInteger(deviceSeq) || deviceSeq <= 0) {
    throw new SyncValidationError(`events[${index}].device_seq must be positive integer`);
  }
  const eventType = normalizeText(item.event_type, `events[${index}].event_type`, { required: true, max: 64 });
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    throw new SyncValidationError(`events[${index}].event_type is unsupported`);
  }
  const aggregateType = normalizeText(item.aggregate_type, `events[${index}].aggregate_type`, {
    required: false,
    max: 64,
  });
  const aggregateId = normalizeText(item.aggregate_id, `events[${index}].aggregate_id`, {
    required: false,
    max: 255,
  });
  const clientCreatedAt = toEventTimestamp(item.client_created_at);
  const clientHlc = normalizeText(item.client_hlc, `events[${index}].client_hlc`, { required: false, max: 255 });
  const payload = normalizeObject(item.payload);
  const payloadHash = normalizeText(item.payload_hash, `events[${index}].payload_hash`, {
    required: true,
    max: 256,
  });
  const prevHash = normalizeText(item.prev_hash, `events[${index}].prev_hash`, { required: false, max: 256 });
  const signature = normalizeText(item.signature, `events[${index}].signature`, { required: true, max: 512 });
  const terminalCode = normalizeText(item.terminal_code, `events[${index}].terminal_code`, { required: false, max: 64 });

  return {
    event_id: eventId.toLowerCase(),
    idempotency_key: idempotencyKey,
    device_id: deviceId.toLowerCase(),
    terminal_code: terminalCode || null,
    branch_id: branchId,
    device_seq: deviceSeq,
    event_type: eventType,
    aggregate_type: aggregateType,
    aggregate_id: aggregateId,
    client_created_at: clientCreatedAt,
    client_hlc: clientHlc,
    payload,
    payload_hash: payloadHash,
    prev_hash: prevHash,
    signature,
  };
};

const insertJournalReceived = async ({ client, event, requestHeaders }) => {
  await client.query(
    `
    INSERT INTO sync_event_journal (
      event_id,
      idempotency_key,
      device_id,
      branch_id,
      device_seq,
      event_type,
      aggregate_type,
      aggregate_id,
      client_created_at,
      client_hlc,
      payload,
      payload_hash,
      prev_hash,
      signature,
      request_headers,
      received_at,
      processing_status
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11::jsonb, $12, $13, $14, $15::jsonb, now(), 'received'
    )
    ON CONFLICT (event_id) DO NOTHING
    `,
    [
      event.event_id,
      event.idempotency_key,
      event.device_id,
      event.branch_id,
      event.device_seq,
      event.event_type,
      event.aggregate_type,
      event.aggregate_id,
      event.client_created_at,
      event.client_hlc,
      JSON.stringify(event.payload),
      event.payload_hash,
      event.prev_hash,
      event.signature,
      JSON.stringify(normalizeObject(requestHeaders)),
    ]
  );
};

const updateJournalResult = async ({
  client,
  eventId,
  processingStatus,
  processingError = null,
  serverOrderId = null,
  conflictId = null,
}) => {
  await client.query(
    `
    UPDATE sync_event_journal
    SET
      processing_status = $2,
      processing_error = $3,
      server_order_id = $4,
      conflict_id = $5
    WHERE event_id = $1
    `,
    [eventId, processingStatus, processingError, serverOrderId, conflictId]
  );
};

const findDuplicateAck = async ({ client, event }) => {
  const result = await client.query(
    `
    SELECT ack_payload
    FROM sync_event_dedupe
    WHERE event_id = $1
       OR idempotency_key = $2
       OR (device_id = $3 AND device_seq = $4)
    ORDER BY first_seen_at ASC
    LIMIT 1
    `,
    [event.event_id, event.idempotency_key, event.device_id, event.device_seq]
  );
  return normalizeObject(result.rows[0]?.ack_payload);
};

const insertDedupeSkeleton = async ({ client, event }) => {
  const result = await client.query(
    `
    INSERT INTO sync_event_dedupe (
      event_id,
      idempotency_key,
      device_id,
      branch_id,
      device_seq,
      ack_payload,
      first_seen_at,
      last_seen_at
    )
    VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, now(), now())
    ON CONFLICT DO NOTHING
    RETURNING id
    `,
    [event.event_id, event.idempotency_key, event.device_id, event.branch_id, event.device_seq]
  );
  return Boolean(result.rows[0]?.id);
};

const saveDedupeAck = async ({ client, event, ackPayload }) => {
  await client.query(
    `
    UPDATE sync_event_dedupe
    SET ack_payload = $2::jsonb, last_seen_at = now()
    WHERE event_id = $1
    `,
    [event.event_id, JSON.stringify(normalizeObject(ackPayload))]
  );
};

const createConflictRecord = async ({
  client,
  event,
  branchId,
  deviceId,
  conflictType,
  details = {},
}) => {
  const result = await client.query(
    `
    INSERT INTO sync_conflicts (
      event_id,
      branch_id,
      device_id,
      conflict_type,
      status,
      details,
      resolution,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, 'open', $5::jsonb, '{}'::jsonb, now(), now())
    RETURNING id
    `,
    [event.event_id, branchId, deviceId, conflictType, JSON.stringify(normalizeObject(details))]
  );
  return result.rows[0]?.id || null;
};

const insertInventoryLedgerRows = async ({
  client,
  branchId,
  orderId,
  sourceEventId,
  items = [],
  reason = 'sale_created',
  metadata = {},
  forceZeroDelta = false,
}) => {
  for (const row of items) {
    const productId = toOptionalPositiveInt(row.product_id);
    const qty = Number(row.quantity || 0);
    if (!productId || !Number.isFinite(qty) || qty <= 0) continue;
    const deltaQty = forceZeroDelta ? 0 : -Math.trunc(qty);
    await client.query(
      `
      INSERT INTO inventory_ledger (
        branch_id,
        product_id,
        order_id,
        source_event_id,
        delta_qty,
        reason,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
      `,
      [branchId, productId, orderId, sourceEventId, deltaQty, reason, JSON.stringify(normalizeObject(metadata))]
    );
  }
};

const resolveProductId = async ({ client, productId, productUid }) => {
  const numericProductId = toOptionalPositiveInt(productId);
  if (numericProductId) return numericProductId;
  if (!productUid || !isUuid(productUid)) {
    throw new SyncValidationError('product_id or product_uid is required');
  }
  const result = await client.query(
    `
    SELECT id
    FROM products
    WHERE product_uid = $1
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [String(productUid).trim().toLowerCase()]
  );
  const found = toOptionalPositiveInt(result.rows[0]?.id);
  if (!found) throw new SyncValidationError('product not found', 404);
  return found;
};

const applySaleCreatedEvent = async ({ client, event, branchId, device, actorId, role }) => {
  const payload = normalizeObject(event.payload);
  const rawClientOrderId = payload.client_order_id || payload.clientOrderId || event.aggregate_id || event.event_id;
  const clientOrderId = isUuid(rawClientOrderId) ? String(rawClientOrderId).trim().toLowerCase() : event.event_id;

  const existing = await client.query(
    `
    SELECT id, order_number, status, total
    FROM orders
    WHERE outlet_id = $1
      AND client_order_id = $2
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [branchId, clientOrderId]
  );
  if (existing.rows[0]) {
    return {
      status: 'accepted',
      code: 'already_applied',
      message: 'Order already exists for client_order_id',
      server_order_id: existing.rows[0].id,
      ack_extra: {
        order_number: existing.rows[0].order_number,
        order_status: existing.rows[0].status,
        total: Number(existing.rows[0].total || 0),
      },
    };
  }

  const orderPayload = {
    ...payload,
    branch_id: branchId,
    client_order_id: clientOrderId,
    source_device_id: device.device_id,
    source_event_id: event.event_id,
    client_created_at: payload.client_created_at || event.client_created_at,
    metadata: {
      ...normalizeObject(payload.metadata),
      sync_v2: true,
      sync_event_id: event.event_id,
      sync_device_id: device.device_id,
      sync_terminal_code: device.terminal_code,
    },
  };

  let created;
  let reconciledForStock = false;

  try {
    created = await createOrder(orderPayload, {
      branchId,
      actorId,
      role,
      nowUtc: event.client_created_at,
    });
  } catch (err) {
    const isOrderDuplicate =
      isUniqueViolation(err)
      && String(err?.constraint || '').includes('idx_orders_outlet_client_order_unique');
    if (isOrderDuplicate) {
      const duplicate = await client.query(
        `
        SELECT id, order_number, status, total
        FROM orders
        WHERE outlet_id = $1
          AND client_order_id = $2
          AND deleted_at IS NULL
        LIMIT 1
        `,
        [branchId, clientOrderId]
      );
      if (duplicate.rows[0]) {
        return {
          status: 'accepted',
          code: 'already_applied',
          message: 'Order already exists for client_order_id',
          server_order_id: duplicate.rows[0].id,
          ack_extra: {
            order_number: duplicate.rows[0].order_number,
            order_status: duplicate.rows[0].status,
            total: Number(duplicate.rows[0].total || 0),
          },
        };
      }
    }

    const isStockErr =
      err instanceof OrderValidationError
      && String(err.message || '').toLowerCase().includes('stock');

    if (!isStockErr) throw err;

    created = await createOrder(orderPayload, {
      branchId,
      actorId,
      role,
      nowUtc: event.client_created_at,
      allowOversell: true,
      skipInventoryDeduction: true,
    });
    reconciledForStock = true;
  }

  await insertInventoryLedgerRows({
    client,
    branchId,
    orderId: created.id,
    sourceEventId: event.event_id,
    items: created.items || payload.items || [],
    reason: reconciledForStock ? 'sale_created_pending_reconcile' : 'sale_created',
    forceZeroDelta: reconciledForStock,
    metadata: {
      requested_items: payload.items || [],
      reconciled_for_stock: reconciledForStock,
    },
  });

  let conflictId = null;
  if (reconciledForStock) {
    conflictId = await createConflictRecord({
      client,
      event,
      branchId,
      deviceId: device.device_id,
      conflictType: 'inventory_oversell',
      details: {
        reason: 'Order accepted without deduction due to insufficient stock at sync time',
        order_id: created.id,
        client_order_id: clientOrderId,
      },
    });
    await client.query(
      `
      INSERT INTO inventory_reconciliation_tasks (
        branch_id,
        related_order_id,
        source_event_id,
        reason,
        status,
        details,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, 'open', $5::jsonb, now(), now())
      `,
      [
        branchId,
        created.id,
        event.event_id,
        'oversell_after_offline_sale',
        JSON.stringify({
          client_order_id: clientOrderId,
          device_id: device.device_id,
          event_id: event.event_id,
        }),
      ]
    );
  }

  return {
    status: reconciledForStock ? 'conflict' : 'accepted',
    code: reconciledForStock ? 'accepted_with_reconciliation' : 'created',
    message: reconciledForStock
      ? 'Order accepted and queued for inventory reconciliation'
      : 'Order created',
    server_order_id: created.id,
    conflict_id: conflictId,
    ack_extra: {
      order_number: created.order_number,
      order_status: created.status,
      total: Number(created.total || 0),
      client_order_id: created.client_order_id || clientOrderId,
    },
  };
};

const applySaleStatusChangedEvent = async ({ client, event, branchId, actorId, role }) => {
  const payload = normalizeObject(event.payload);
  const orderId = normalizeText(payload.order_id || payload.orderId, 'payload.order_id', {
    required: true,
    max: 100,
  });
  if (!isUuid(orderId)) {
    throw new SyncValidationError('payload.order_id must be UUID');
  }
  const status = normalizeText(payload.status, 'payload.status', { required: true, max: 64 });
  const paymentStatus = payload.payment_status ?? payload.paymentStatus;

  try {
    const updated = await updateOrderStatus(
      orderId,
      {
        status,
        payment_status: paymentStatus,
        reason: normalizeText(payload.reason, 'payload.reason', { required: false, max: 255 }) || 'Sync status replay',
        metadata: {
          ...normalizeObject(payload.metadata),
          sync_v2: true,
          sync_event_id: event.event_id,
        },
      },
      {
        branchId,
        actorId,
        role,
      }
    );
    return {
      status: 'accepted',
      code: 'status_updated',
      message: 'Order status updated',
      server_order_id: updated.id,
      ack_extra: {
        status: updated.status,
      },
    };
  } catch (err) {
    if (!(err instanceof OrderValidationError)) {
      throw err;
    }
    const conflictId = await createConflictRecord({
      client,
      event,
      branchId,
      conflictType: 'status_transition',
      details: {
        error: err.message,
        order_id: orderId,
        next_status: status,
      },
    });
    return {
      status: 'conflict',
      code: 'status_conflict',
      message: err.message,
      conflict_id: conflictId,
      server_order_id: orderId,
    };
  }
};

const applyInventoryAdjustedEvent = async ({ client, event, branchId }) => {
  const payload = normalizeObject(event.payload);
  const productId = await resolveProductId({
    client,
    productId: payload.product_id || payload.productId,
    productUid: payload.product_uid || payload.productUid,
  });
  const rawDelta = Number(payload.delta_qty ?? payload.deltaQty);
  if (!Number.isInteger(rawDelta) || rawDelta === 0) {
    throw new SyncValidationError('payload.delta_qty must be a non-zero integer');
  }

  const settingResult = await client.query(
    `
    SELECT id, stock_override
    FROM product_outlet_settings
    WHERE product_id = $1
      AND outlet_id = $2
      AND deleted_at IS NULL
    LIMIT 1
    FOR UPDATE
    `,
    [productId, branchId]
  );
  const outletSetting = settingResult.rows[0] || null;
  let beforeQty = 0;
  let afterQty = 0;
  let appliedDelta = rawDelta;
  let reconciliationRequired = false;

  if (outletSetting && outletSetting.stock_override !== null) {
    beforeQty = Number(outletSetting.stock_override || 0);
    afterQty = beforeQty + rawDelta;
    if (afterQty < 0) {
      afterQty = 0;
      appliedDelta = -beforeQty;
      reconciliationRequired = true;
    }
    await client.query(
      `
      UPDATE product_outlet_settings
      SET stock_override = $2, updated_at = now()
      WHERE id = $1
      `,
      [outletSetting.id, afterQty]
    );
  } else {
    const productResult = await client.query(
      `
      SELECT stock_quantity
      FROM products
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [productId]
    );
    if (!productResult.rows[0]) {
      throw new SyncValidationError('product not found', 404);
    }
    beforeQty = Number(productResult.rows[0].stock_quantity || 0);
    afterQty = beforeQty + rawDelta;
    if (afterQty < 0) {
      afterQty = 0;
      appliedDelta = -beforeQty;
      reconciliationRequired = true;
    }
    await client.query(
      `
      UPDATE products
      SET stock_quantity = $2, updated_at = now()
      WHERE id = $1
      `,
      [productId, afterQty]
    );
  }

  await client.query(
    `
    INSERT INTO inventory_ledger (
      branch_id,
      product_id,
      source_event_id,
      delta_qty,
      balance_after,
      reason,
      metadata,
      created_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
    `,
    [
      branchId,
      productId,
      event.event_id,
      appliedDelta,
      afterQty,
      normalizeText(payload.reason, 'payload.reason', { required: false, max: 64 }) || 'inventory_adjusted',
      JSON.stringify({
        requested_delta: rawDelta,
        before_qty: beforeQty,
      }),
    ]
  );

  if (reconciliationRequired) {
    const conflictId = await createConflictRecord({
      client,
      event,
      branchId,
      conflictType: 'inventory_underflow',
      details: {
        product_id: productId,
        requested_delta: rawDelta,
        applied_delta: appliedDelta,
      },
    });
    await client.query(
      `
      INSERT INTO inventory_reconciliation_tasks (
        branch_id,
        product_id,
        source_event_id,
        reason,
        status,
        details,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, 'open', $5::jsonb, now(), now())
      `,
      [
        branchId,
        productId,
        event.event_id,
        'inventory_adjustment_underflow',
        JSON.stringify({
          requested_delta: rawDelta,
          applied_delta: appliedDelta,
          balance_after: afterQty,
        }),
      ]
    );
    return {
      status: 'conflict',
      code: 'inventory_underflow',
      message: 'Inventory adjusted with clamping and reconciliation task',
      conflict_id: conflictId,
      ack_extra: {
        product_id: productId,
        before_qty: beforeQty,
        applied_delta: appliedDelta,
        after_qty: afterQty,
      },
    };
  }

  return {
    status: 'accepted',
    code: 'inventory_adjusted',
    message: 'Inventory adjusted',
    ack_extra: {
      product_id: productId,
      before_qty: beforeQty,
      applied_delta: appliedDelta,
      after_qty: afterQty,
    },
  };
};

const applyPriceOverrideSetEvent = async ({ client, event, branchId, device, actorId }) => {
  const payload = normalizeObject(event.payload);
  const scope = normalizeText(payload.scope, 'payload.scope', { required: false, max: 20 }) || 'branch';
  if (!['branch', 'global'].includes(scope)) {
    throw new SyncValidationError('payload.scope must be branch or global');
  }
  const productId = await resolveProductId({
    client,
    productId: payload.product_id || payload.productId,
    productUid: payload.product_uid || payload.productUid,
  });
  const expectedVersion = payload.expected_version === undefined || payload.expected_version === null
    ? null
    : Number(payload.expected_version);
  if (expectedVersion !== null && (!Number.isInteger(expectedVersion) || expectedVersion < 0)) {
    throw new SyncValidationError('payload.expected_version must be a non-negative integer');
  }

  if (scope === 'global') {
    const newBasePrice = Number(payload.base_price ?? payload.basePrice);
    if (!Number.isFinite(newBasePrice) || newBasePrice < 0) {
      throw new SyncValidationError('payload.base_price must be >= 0');
    }

    const rowResult = await client.query(
      `
      SELECT base_price, base_price_version
      FROM products
      WHERE id = $1
      LIMIT 1
      FOR UPDATE
      `,
      [productId]
    );
    const row = rowResult.rows[0];
    if (!row) throw new SyncValidationError('product not found', 404);
    const currentVersion = Number(row.base_price_version || 0);
    if (expectedVersion !== null && currentVersion !== expectedVersion) {
      const conflictId = await createConflictRecord({
        client,
        event,
        branchId,
        deviceId: device.device_id,
        conflictType: 'base_price_version_mismatch',
        details: {
          expected_version: expectedVersion,
          current_version: currentVersion,
          product_id: productId,
        },
      });
      return {
        status: 'conflict',
        code: 'version_mismatch',
        message: 'Global base price version mismatch',
        conflict_id: conflictId,
      };
    }

    const updated = await client.query(
      `
      UPDATE products
      SET
        base_price = $2,
        base_price_version = base_price_version + 1,
        updated_at = now()
      WHERE id = $1
      RETURNING base_price, base_price_version
      `,
      [productId, Number(newBasePrice.toFixed(2))]
    );
    const next = updated.rows[0];
    await client.query(
      `
      INSERT INTO price_change_audit (
        branch_id,
        product_id,
        scope,
        old_base_price,
        new_base_price,
        version_before,
        version_after,
        changed_by,
        device_id,
        source_event_id,
        created_at
      )
      VALUES ($1, $2, 'global', $3, $4, $5, $6, $7, $8, $9, now())
      `,
      [
        branchId,
        productId,
        row.base_price,
        next.base_price,
        currentVersion,
        Number(next.base_price_version || currentVersion + 1),
        actorId,
        device.device_id,
        event.event_id,
      ]
    );
    return {
      status: 'accepted',
      code: 'global_price_updated',
      message: 'Global base price updated',
      ack_extra: {
        product_id: productId,
        version_after: Number(next.base_price_version || 0),
      },
    };
  }

  const newOverride = payload.price_override === null || payload.price_override === undefined || payload.price_override === ''
    ? null
    : Number(payload.price_override);
  if (newOverride !== null && (!Number.isFinite(newOverride) || newOverride < 0)) {
    throw new SyncValidationError('payload.price_override must be null or >= 0');
  }

  let settingRow = (
    await client.query(
      `
      SELECT id, price_override, price_version
      FROM product_outlet_settings
      WHERE product_id = $1
        AND outlet_id = $2
        AND deleted_at IS NULL
      LIMIT 1
      FOR UPDATE
      `,
      [productId, branchId]
    )
  ).rows[0];

  if (!settingRow) {
    const inserted = await client.query(
      `
      INSERT INTO product_outlet_settings (
        product_id,
        outlet_id,
        is_available,
        price_override,
        stock_override,
        price_version,
        last_updated_by_device_id,
        created_at,
        updated_at
      )
      VALUES ($1, $2, TRUE, NULL, NULL, 0, $3, now(), now())
      RETURNING id, price_override, price_version
      `,
      [productId, branchId, device.device_id]
    );
    settingRow = inserted.rows[0];
  }

  const currentVersion = Number(settingRow.price_version || 0);
  if (expectedVersion !== null && currentVersion !== expectedVersion) {
    const conflictId = await createConflictRecord({
      client,
      event,
      branchId,
      deviceId: device.device_id,
      conflictType: 'branch_price_version_mismatch',
      details: {
        expected_version: expectedVersion,
        current_version: currentVersion,
        product_id: productId,
      },
    });
    return {
      status: 'conflict',
      code: 'version_mismatch',
      message: 'Branch price override version mismatch',
      conflict_id: conflictId,
    };
  }

  const updated = await client.query(
    `
    UPDATE product_outlet_settings
    SET
      price_override = $2,
      price_version = price_version + 1,
      last_updated_by_device_id = $3,
      updated_at = now()
    WHERE id = $1
    RETURNING price_override, price_version
    `,
    [settingRow.id, newOverride === null ? null : Number(newOverride.toFixed(2)), device.device_id]
  );
  const next = updated.rows[0];

  await client.query(
    `
    INSERT INTO price_change_audit (
      branch_id,
      product_id,
      scope,
      old_price_override,
      new_price_override,
      version_before,
      version_after,
      changed_by,
      device_id,
      source_event_id,
      created_at
    )
    VALUES ($1, $2, 'branch', $3, $4, $5, $6, $7, $8, $9, now())
    `,
    [
      branchId,
      productId,
      settingRow.price_override,
      next.price_override,
      currentVersion,
      Number(next.price_version || currentVersion + 1),
      actorId,
      device.device_id,
      event.event_id,
    ]
  );

  return {
    status: 'accepted',
    code: 'branch_price_updated',
    message: 'Branch price override updated',
    ack_extra: {
      product_id: productId,
      version_after: Number(next.price_version || 0),
      price_override: next.price_override,
    },
  };
};

const applyEvent = async ({ client, event, branchId, device, actorId, role }) => {
  if (event.event_type === 'sale.created') {
    return applySaleCreatedEvent({
      client,
      event,
      branchId,
      device,
      actorId,
      role,
    });
  }
  if (event.event_type === 'sale.status_changed') {
    return applySaleStatusChangedEvent({
      client,
      event,
      branchId,
      actorId,
      role,
    });
  }
  if (event.event_type === 'inventory.adjusted') {
    return applyInventoryAdjustedEvent({
      client,
      event,
      branchId,
    });
  }
  if (event.event_type === 'price.override_set') {
    return applyPriceOverrideSetEvent({
      client,
      event,
      branchId,
      device,
      actorId,
    });
  }
  if (event.event_type === 'catalog.snapshot_applied') {
    return {
      status: 'accepted',
      code: 'snapshot_marker_applied',
      message: 'Catalog snapshot marker accepted',
    };
  }
  if (event.event_type === 'device.heartbeat') {
    await client.query(
      `
      UPDATE devices
      SET last_seen_at = now(), updated_at = now()
      WHERE device_id = $1
      `,
      [device.device_id]
    );
    return {
      status: 'accepted',
      code: 'heartbeat_applied',
      message: 'Device heartbeat applied',
    };
  }
  return {
    status: 'rejected',
    code: 'unsupported_event_type',
    message: 'Unsupported event type',
  };
};

const mapAckStatusToJournalStatus = (status) => {
  if (status === 'accepted') return 'applied';
  if (status === 'duplicate') return 'duplicate';
  if (status === 'conflict') return 'conflict';
  if (status === 'rejected') return 'rejected';
  return 'failed';
};

const buildAck = ({
  event,
  status,
  code,
  message,
  serverOrderId = null,
  conflictId = null,
  extra = {},
}) => ({
  event_id: event.event_id,
  idempotency_key: event.idempotency_key,
  status,
  code,
  message,
  server_refs: {
    order_id: serverOrderId,
    conflict_id: conflictId,
  },
  ...normalizeObject(extra),
});

const registerDevice = async ({ payload = {}, context = {} }) => {
  const branchId = toPositiveInt(context.branchId, 'branch_id');
  const actorId = normalizeText(context.actorId || 'system', 'actor_id', { required: true, max: 255 });
  const role = normalizeText(context.role || '', 'role', { required: true, max: 32 });
  if (!['manager', 'admin'].includes(role)) {
    throw new SyncValidationError('Only manager/admin can register devices', 403);
  }

  const input = normalizeRegisterPayload(payload);
  const secret = generateDeviceSecret();
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    await assertSyncFeatureEnabled({ client, branchId });

    await client.query(
      `
      INSERT INTO devices (
        device_id,
        installation_id,
        branch_id,
        terminal_code,
        label,
        status,
        created_by,
        metadata,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 'active', $6, $7::jsonb, now(), now())
      ON CONFLICT (device_id) DO UPDATE
      SET
        installation_id = EXCLUDED.installation_id,
        branch_id = EXCLUDED.branch_id,
        terminal_code = EXCLUDED.terminal_code,
        label = EXCLUDED.label,
        status = 'active',
        created_by = EXCLUDED.created_by,
        metadata = EXCLUDED.metadata,
        updated_at = now()
      `,
      [
        input.device_id,
        input.installation_id,
        branchId,
        input.terminal_code,
        input.label,
        actorId,
        JSON.stringify(input.metadata),
      ]
    );

    await client.query(
      `
      UPDATE device_keys
      SET is_active = FALSE, rotated_at = now()
      WHERE device_id = $1
        AND is_active = TRUE
      `,
      [input.device_id]
    );

    const nextVersionResult = await client.query(
      `
      SELECT COALESCE(MAX(key_version), 0) + 1 AS next_version
      FROM device_keys
      WHERE device_id = $1
      `,
      [input.device_id]
    );
    const nextVersion = Number(nextVersionResult.rows[0]?.next_version || 1);

    await client.query(
      `
      INSERT INTO device_keys (
        device_id,
        key_version,
        secret_ciphertext,
        is_active,
        created_at
      )
      VALUES ($1, $2, $3, TRUE, now())
      `,
      [input.device_id, nextVersion, secret]
    );

    await client.query('COMMIT');
    return {
      device_id: input.device_id,
      installation_id: input.installation_id,
      branch_id: branchId,
      terminal_code: input.terminal_code,
      key_version: nextVersion,
      status: 'active',
      issued_at: nowIso(),
      device_secret: secret,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if (isUniqueViolation(err)) {
      throw new SyncValidationError('Device terminal code must be unique per branch', 409);
    }
    throw err;
  } finally {
    client.release();
  }
};

const pushSyncBatch = async ({ payload = {}, context = {} }) => {
  const branchId = toPositiveInt(context.branchId, 'branch_id');
  const actorId = normalizeText(context.actorId || 'sync-engine', 'actor_id', { required: true, max: 255 });
  const role = normalizeText(context.role || 'cashier', 'role', { required: true, max: 32 });
  const headers = readDeviceHeaders(context.headers || {});
  assertFreshRequestTimestamp(headers.request_timestamp);

  const body = normalizeObject(payload);
  if (!Array.isArray(body.events) || body.events.length === 0) {
    throw new SyncValidationError('events must be a non-empty array');
  }
  if (body.events.length > 100) {
    throw new SyncValidationError('events batch cannot exceed 100');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await assertSyncFeatureEnabled({ client, branchId });

    const device = await resolveDeviceWithActiveKey({
      client,
      deviceId: headers.device_id,
      terminalCode: headers.terminal_code,
      branchId,
    });
    assertRequestSignature({
      secret: normalizeSecret(device.device_secret),
      requestTimestamp: headers.request_timestamp,
      requestIdempotencyKey: headers.request_idempotency_key,
      payloadHash: computeHash(JSON.stringify(body)),
      requestSignature: headers.request_signature,
    });

    let maxKnownSeq = await loadMaxKnownDeviceSeq({
      client,
      deviceId: device.device_id,
    });

    const results = [];

    for (let i = 0; i < body.events.length; i += 1) {
      let event;
      try {
        event = normalizeEvent(body.events[i], i);
      } catch (err) {
        if (err instanceof SyncValidationError) {
          results.push({
            event_id: normalizeText(body.events?.[i]?.event_id || '', 'event_id', { required: false }) || null,
            status: 'rejected',
            code: 'invalid_event',
            message: err.message,
          });
          continue;
        }
        throw err;
      }

      if (event.device_id !== device.device_id) {
        results.push(
          buildAck({
            event,
            status: 'rejected',
            code: 'device_mismatch',
            message: 'event.device_id does not match authenticated device header',
          })
        );
        continue;
      }
      if (event.branch_id !== branchId) {
        results.push(
          buildAck({
            event,
            status: 'rejected',
            code: 'branch_mismatch',
            message: 'event.branch_id does not match request branch',
          })
        );
        continue;
      }
      if (event.terminal_code && event.terminal_code !== device.terminal_code) {
        results.push(
          buildAck({
            event,
            status: 'rejected',
            code: 'terminal_mismatch',
            message: 'event.terminal_code does not match enrolled terminal code',
          })
        );
        continue;
      }
      const computedPayloadHash = computeHash(JSON.stringify(normalizeObject(event.payload)));
      if (computedPayloadHash !== event.payload_hash) {
        const ack = buildAck({
          event,
          status: 'rejected',
          code: 'payload_hash_mismatch',
          message: 'Event payload hash verification failed',
        });
        await writeSecurityAudit({
          client,
          branchId,
          deviceId: device.device_id,
          category: 'payload_hash_mismatch',
          severity: 'high',
          details: {
            event_id: event.event_id,
            device_seq: event.device_seq,
          },
        });
        results.push(ack);
        continue;
      }

      if (event.device_seq > maxKnownSeq + 1) {
        results.push(
          buildAck({
            event,
            status: 'rejected',
            code: 'out_of_order_sequence',
            message: `Expected next device_seq <= ${maxKnownSeq + 1}, received ${event.device_seq}`,
          })
        );
        continue;
      }

      const inserted = await insertDedupeSkeleton({ client, event });
      if (!inserted) {
        const prior = await findDuplicateAck({ client, event });
        results.push({
          ...prior,
          event_id: prior.event_id || event.event_id,
          idempotency_key: prior.idempotency_key || event.idempotency_key,
          status: 'duplicate',
          code: prior.code || 'duplicate',
          message: prior.message || 'Event already processed',
        });
        continue;
      }

      await insertJournalReceived({
        client,
        event,
        requestHeaders: {
          device_id: headers.device_id,
          terminal_code: headers.terminal_code,
          request_timestamp: headers.request_timestamp,
          request_idempotency_key: headers.request_idempotency_key,
        },
      });

      const expectedSig = computeEventSignature({
        secret: normalizeSecret(device.device_secret),
        payloadHash: event.payload_hash,
        prevHash: event.prev_hash || '',
        deviceSeq: event.device_seq,
        eventType: event.event_type,
      });
      if (expectedSig !== event.signature) {
        const ack = buildAck({
          event,
          status: 'rejected',
          code: 'signature_mismatch',
          message: 'Event signature verification failed',
        });
        await updateJournalResult({
          client,
          eventId: event.event_id,
          processingStatus: mapAckStatusToJournalStatus('rejected'),
          processingError: ack.message,
        });
        await saveDedupeAck({ client, event, ackPayload: ack });
        await writeSecurityAudit({
          client,
          branchId,
          deviceId: device.device_id,
          category: 'signature_mismatch',
          severity: 'high',
          details: {
            event_id: event.event_id,
            device_seq: event.device_seq,
          },
        });
        results.push(ack);
        continue;
      }

      let applyResult;
      try {
        applyResult = await applyEvent({
          client,
          event,
          branchId,
          device,
          actorId,
          role,
        });
      } catch (err) {
        if (err instanceof SyncValidationError || err instanceof OrderValidationError) {
          applyResult = {
            status: 'rejected',
            code: 'apply_failed',
            message: err.message,
          };
        } else {
          throw err;
        }
      }

      const ack = buildAck({
        event,
        status: applyResult.status === 'accepted' ? 'accepted' : applyResult.status,
        code: applyResult.code || 'processed',
        message: applyResult.message || 'Processed',
        serverOrderId: applyResult.server_order_id || null,
        conflictId: applyResult.conflict_id || null,
        extra: applyResult.ack_extra || {},
      });

      await updateJournalResult({
        client,
        eventId: event.event_id,
        processingStatus: mapAckStatusToJournalStatus(ack.status),
        processingError: ack.status === 'rejected' ? ack.message : null,
        serverOrderId: applyResult.server_order_id || null,
        conflictId: applyResult.conflict_id || null,
      });
      await saveDedupeAck({ client, event, ackPayload: ack });

      if (ack.status === 'accepted' || ack.status === 'conflict') {
        maxKnownSeq = Math.max(maxKnownSeq, event.device_seq);
      }
      results.push(ack);
    }

    await client.query(
      `
      UPDATE devices
      SET last_seen_at = now(), updated_at = now()
      WHERE device_id = $1
      `,
      [device.device_id]
    );

    await client.query('COMMIT');
    return {
      branch_id: branchId,
      device_id: device.device_id,
      accepted_at: nowIso(),
      results,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const normalizePullCursor = (value) => {
  if (!value) return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
};

const getStoredCursorMap = async ({ client, deviceId, branchId }) => {
  const rows = await client.query(
    `
    SELECT stream_name, cursor_value
    FROM sync_pull_cursor
    WHERE device_id = $1
      AND branch_id = $2
    `,
    [deviceId, branchId]
  );
  const mapped = { ...DEFAULT_STREAM_CURSORS };
  for (const row of rows.rows) {
    if (row.stream_name && row.cursor_value) {
      mapped[row.stream_name] = row.cursor_value;
    }
  }
  return mapped;
};

const maxTimestampFromRows = (rows, fieldName, fallback) => {
  let maxTs = fallback;
  for (const row of rows) {
    const value = row?.[fieldName];
    if (!value) continue;
    const iso = new Date(value).toISOString();
    if (iso > maxTs) maxTs = iso;
  }
  return maxTs;
};

const upsertCursor = async ({ client, deviceId, branchId, streamName, cursorValue }) => {
  await client.query(
    `
    INSERT INTO sync_pull_cursor (
      device_id,
      branch_id,
      stream_name,
      cursor_value,
      updated_at
    )
    VALUES ($1, $2, $3, $4, now())
    ON CONFLICT (device_id, branch_id, stream_name)
    DO UPDATE SET
      cursor_value = EXCLUDED.cursor_value,
      updated_at = now()
    `,
    [deviceId, branchId, streamName, cursorValue]
  );
};

const pullSync = async ({ query = {}, context = {} }) => {
  const branchId = toPositiveInt(context.branchId, 'branch_id');
  const headers = readDeviceHeaders(context.headers || {});
  assertFreshRequestTimestamp(headers.request_timestamp);
  const limitRaw = Number(query.limit || 500);
  const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : 500;

  const client = await db.getClient();
  try {
    await assertSyncFeatureEnabled({ client, branchId });
    const device = await resolveDeviceWithActiveKey({
      client,
      deviceId: headers.device_id,
      branchId,
      terminalCode: headers.terminal_code,
    });
    assertRequestSignature({
      secret: normalizeSecret(device.device_secret),
      requestTimestamp: headers.request_timestamp,
      requestIdempotencyKey: headers.request_idempotency_key,
      payloadHash: computeHash(''),
      requestSignature: headers.request_signature,
    });

    const stored = await getStoredCursorMap({
      client,
      deviceId: device.device_id,
      branchId,
    });

    const cursor = {
      catalog: normalizePullCursor(query.cursor_catalog) || stored.catalog,
      orders: normalizePullCursor(query.cursor_orders) || stored.orders,
      inventory: normalizePullCursor(query.cursor_inventory) || stored.inventory,
      conflicts: normalizePullCursor(query.cursor_conflicts) || stored.conflicts,
      sections: normalizePullCursor(query.cursor_sections) || stored.sections,
    };

    const products = (
      await client.query(
        `
        SELECT
          p.id,
          p.product_uid,
          p.name,
          p.sku,
          p.section_id,
          p.base_price,
          p.base_price_version,
          p.stock_quantity,
          p.updated_at AS product_updated_at,
          COALESCE(pos.price_override, NULL) AS price_override,
          COALESCE(pos.price_version, 0) AS price_version,
          COALESCE(pos.stock_override, p.stock_quantity) AS effective_stock,
          COALESCE(pos.is_available, TRUE) AS is_available,
          COALESCE(pos.updated_at, p.updated_at) AS branch_updated_at
        FROM products p
        LEFT JOIN product_outlet_settings pos
          ON pos.product_id = p.id
          AND pos.outlet_id = $1
          AND pos.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
          AND GREATEST(
            p.updated_at,
            COALESCE(pos.updated_at, p.updated_at)
          ) > $2
        ORDER BY GREATEST(p.updated_at, COALESCE(pos.updated_at, p.updated_at)) ASC
        LIMIT $3
        `,
        [branchId, cursor.catalog, limit]
      )
    ).rows;

    const sections = (
      await client.query(
        `
        SELECT
          id,
          name,
          description,
          display_order,
          is_active,
          addon_groups,
          outlet_id,
          updated_at
        FROM sections
        WHERE deleted_at IS NULL
          AND (outlet_id IS NULL OR outlet_id = $1)
          AND updated_at > $2
        ORDER BY updated_at ASC
        LIMIT $3
        `,
        [branchId, cursor.sections, limit]
      )
    ).rows;

    const orders = (
      await client.query(
        `
        SELECT
          id,
          client_order_id,
          source_event_id,
          order_number,
          status,
          order_channel,
          payment_status,
          total,
          updated_at,
          created_at,
          client_created_at
        FROM orders
        WHERE deleted_at IS NULL
          AND outlet_id = $1
          AND updated_at > $2
        ORDER BY updated_at ASC
        LIMIT $3
        `,
        [branchId, cursor.orders, limit]
      )
    ).rows;

    const inventory = (
      await client.query(
        `
        SELECT
          id,
          product_id,
          order_id,
          source_event_id,
          delta_qty,
          balance_after,
          reason,
          metadata,
          created_at
        FROM inventory_ledger
        WHERE branch_id = $1
          AND created_at > $2
        ORDER BY created_at ASC
        LIMIT $3
        `,
        [branchId, cursor.inventory, limit]
      )
    ).rows;

    const conflicts = (
      await client.query(
        `
        SELECT
          id,
          event_id,
          conflict_type,
          status,
          details,
          resolution,
          created_at,
          updated_at
        FROM sync_conflicts
        WHERE branch_id = $1
          AND updated_at > $2
        ORDER BY updated_at ASC
        LIMIT $3
        `,
        [branchId, cursor.conflicts, limit]
      )
    ).rows;

    const nextCursor = {
      catalog: maxTimestampFromRows(products, 'branch_updated_at', cursor.catalog),
      sections: maxTimestampFromRows(sections, 'updated_at', cursor.sections),
      orders: maxTimestampFromRows(orders, 'updated_at', cursor.orders),
      inventory: maxTimestampFromRows(inventory, 'created_at', cursor.inventory),
      conflicts: maxTimestampFromRows(conflicts, 'updated_at', cursor.conflicts),
    };

    await upsertCursor({ client, deviceId: device.device_id, branchId, streamName: 'catalog', cursorValue: nextCursor.catalog });
    await upsertCursor({ client, deviceId: device.device_id, branchId, streamName: 'sections', cursorValue: nextCursor.sections });
    await upsertCursor({ client, deviceId: device.device_id, branchId, streamName: 'orders', cursorValue: nextCursor.orders });
    await upsertCursor({ client, deviceId: device.device_id, branchId, streamName: 'inventory', cursorValue: nextCursor.inventory });
    await upsertCursor({ client, deviceId: device.device_id, branchId, streamName: 'conflicts', cursorValue: nextCursor.conflicts });

    await client.query(
      `
      UPDATE devices
      SET last_seen_at = now(), updated_at = now()
      WHERE device_id = $1
      `,
      [device.device_id]
    );

    return {
      branch_id: branchId,
      device_id: device.device_id,
      server_time: nowIso(),
      next_cursors: nextCursor,
      deltas: {
        catalog_products: products,
        catalog_sections: sections,
        orders,
        inventory,
        conflicts,
      },
    };
  } finally {
    client.release();
  }
};

const bootstrapSync = async ({ context = {} }) => {
  const branchId = toPositiveInt(context.branchId, 'branch_id');
  const headers = readDeviceHeaders(context.headers || {});
  assertFreshRequestTimestamp(headers.request_timestamp);

  const client = await db.getClient();
  try {
    await assertSyncFeatureEnabled({ client, branchId });
    const device = await resolveDeviceWithActiveKey({
      client,
      deviceId: headers.device_id,
      branchId,
      terminalCode: headers.terminal_code,
    });
    assertRequestSignature({
      secret: normalizeSecret(device.device_secret),
      requestTimestamp: headers.request_timestamp,
      requestIdempotencyKey: headers.request_idempotency_key,
      payloadHash: computeHash(''),
      requestSignature: headers.request_signature,
    });

    const branchContext = await getBranchSettingsById(branchId, client);
    const products = (
      await client.query(
        `
        SELECT
          p.id,
          p.product_uid,
          p.name,
          p.sku,
          p.description,
          p.section_id,
          p.base_price,
          p.base_price_version,
          p.stock_quantity,
          p.track_inventory,
          p.is_active,
          p.updated_at AS product_updated_at,
          COALESCE(pos.price_override, NULL) AS price_override,
          COALESCE(pos.price_version, 0) AS price_version,
          COALESCE(pos.stock_override, p.stock_quantity) AS effective_stock,
          COALESCE(pos.is_available, TRUE) AS is_available,
          COALESCE(pos.updated_at, p.updated_at) AS branch_updated_at
        FROM products p
        LEFT JOIN product_outlet_settings pos
          ON pos.product_id = p.id
          AND pos.outlet_id = $1
          AND pos.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
        ORDER BY p.updated_at DESC
        LIMIT 10000
        `,
        [branchId]
      )
    ).rows;

    const sections = (
      await client.query(
        `
        SELECT
          id,
          name,
          description,
          display_order,
          is_active,
          addon_groups,
          outlet_id,
          updated_at
        FROM sections
        WHERE deleted_at IS NULL
          AND (outlet_id IS NULL OR outlet_id = $1)
        ORDER BY display_order ASC, created_at ASC
        `,
        [branchId]
      )
    ).rows;

    const openConflicts = (
      await client.query(
        `
        SELECT
          id,
          event_id,
          conflict_type,
          status,
          details,
          resolution,
          created_at,
          updated_at
        FROM sync_conflicts
        WHERE branch_id = $1
          AND status = 'open'
        ORDER BY created_at DESC
        LIMIT 200
        `,
        [branchId]
      )
    ).rows;

    const productCursor = maxTimestampFromRows(products, 'branch_updated_at', DEFAULT_STREAM_CURSORS.catalog);
    const sectionCursor = maxTimestampFromRows(sections, 'updated_at', DEFAULT_STREAM_CURSORS.sections);
    const conflictCursor = maxTimestampFromRows(openConflicts, 'updated_at', DEFAULT_STREAM_CURSORS.conflicts);

    await upsertCursor({ client, deviceId: device.device_id, branchId, streamName: 'catalog', cursorValue: productCursor });
    await upsertCursor({ client, deviceId: device.device_id, branchId, streamName: 'sections', cursorValue: sectionCursor });
    await upsertCursor({ client, deviceId: device.device_id, branchId, streamName: 'conflicts', cursorValue: conflictCursor });

    return {
      branch_id: branchId,
      device_id: device.device_id,
      server_time: nowIso(),
      bootstrap_version: 1,
      branch: branchContext.branch,
      settings: branchContext.settings,
      snapshot: {
        catalog_products: products,
        catalog_sections: sections,
        open_conflicts: openConflicts,
      },
      cursors: {
        catalog: productCursor,
        sections: sectionCursor,
        conflicts: conflictCursor,
        orders: DEFAULT_STREAM_CURSORS.orders,
        inventory: DEFAULT_STREAM_CURSORS.inventory,
      },
    };
  } finally {
    client.release();
  }
};

const resolveSyncConflict = async ({ conflictId, payload = {}, context = {} }) => {
  const branchId = toPositiveInt(context.branchId, 'branch_id');
  const actorId = normalizeText(context.actorId || 'sync-manager', 'actor_id', { required: true, max: 255 });
  const role = normalizeText(context.role || '', 'role', { required: true, max: 32 });
  if (!['manager', 'admin'].includes(role)) {
    throw new SyncValidationError('Only manager/admin can resolve sync conflicts', 403);
  }
  if (!isUuid(conflictId)) {
    throw new SyncValidationError('conflict_id must be a UUID');
  }
  const action = normalizeText(payload.action, 'action', { required: true, max: 64 });
  if (!['resolve', 'dismiss', 'apply_inventory_adjustment', 'retry_event'].includes(action)) {
    throw new SyncValidationError('action is invalid');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await assertSyncFeatureEnabled({ client, branchId });

    const existingResult = await client.query(
      `
      SELECT id, event_id, conflict_type, status, details
      FROM sync_conflicts
      WHERE id = $1
        AND branch_id = $2
      LIMIT 1
      FOR UPDATE
      `,
      [conflictId, branchId]
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      throw new SyncValidationError('Conflict not found', 404);
    }
    if (existing.status !== 'open') {
      throw new SyncValidationError('Conflict is already finalized', 409);
    }

    const resolution = normalizeObject(payload.resolution);
    let status = action === 'dismiss' ? 'dismissed' : 'resolved';

    if (action === 'apply_inventory_adjustment') {
      const eventLike = {
        event_id: existing.event_id,
        payload: {
          product_id: resolution.product_id,
          product_uid: resolution.product_uid,
          delta_qty: resolution.delta_qty,
          reason: resolution.reason || 'conflict_resolution_adjustment',
        },
      };
      await applyInventoryAdjustedEvent({
        client,
        event: eventLike,
        branchId,
      });
    }

    if (action === 'retry_event') {
      status = 'resolved';
    }

    const updated = await client.query(
      `
      UPDATE sync_conflicts
      SET
        status = $2,
        resolution = $3::jsonb,
        resolved_by = $4,
        resolved_at = now(),
        updated_at = now()
      WHERE id = $1
      RETURNING id, event_id, conflict_type, status, details, resolution, resolved_by, resolved_at, updated_at
      `,
      [conflictId, status, JSON.stringify({ action, ...resolution }), actorId]
    );

    await client.query('COMMIT');
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  ALLOWED_EVENT_TYPES,
  SyncValidationError,
  registerDevice,
  pushSyncBatch,
  pullSync,
  bootstrapSync,
  resolveSyncConflict,
};
