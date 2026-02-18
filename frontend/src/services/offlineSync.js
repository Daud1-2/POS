import api from './api';
import {
  STORE_META,
  STORE_CATALOG_PRODUCTS,
  STORE_CATALOG_SECTIONS,
  STORE_INVENTORY_PROJECTION,
  STORE_ORDERS_LOCAL,
  STORE_ORDER_ITEMS_LOCAL,
  STORE_OUTBOX_EVENTS,
  STORE_INBOX_APPLIED,
  STORE_SYNC_STATE,
  STORE_CONFLICTS,
  STORE_AUDIT_CHAIN,
  getMetaValue,
  setMetaValue,
  runTransaction,
} from './offlineDb';

const OFFLINE_SYNC_ENABLE_KEY = 'offlineV2Enabled';
const DEVICE_CONTEXT_META_KEY = (branchId) => `device_context:${branchId}`;
const DEVICE_SEQ_META_KEY = (branchId) => `device_seq:${branchId}`;
const BOOTSTRAP_META_KEY = (branchId) => `bootstrap_done:${branchId}`;
const SCOPE_KEY = (branchId) => `branch:${branchId}`;
const MAX_BATCH_EVENTS = 100;
const MAX_BATCH_BYTES = 256 * 1024;
const BASE_RETRY_MS = 2000;
const MAX_RETRY_MS = 5 * 60 * 1000;

const syncIntervals = new Map();
const syncLocks = new Map();

const isOfflineV2Enabled = () => String(localStorage.getItem(OFFLINE_SYNC_ENABLE_KEY) || '') === '1';

const setOfflineV2Enabled = (enabled) => {
  if (enabled) {
    localStorage.setItem(OFFLINE_SYNC_ENABLE_KEY, '1');
  } else {
    localStorage.removeItem(OFFLINE_SYNC_ENABLE_KEY);
  }
};

const randomUuid = () => {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const rand = Math.floor(Math.random() * 16);
    const value = token === 'x' ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
};

const toHex = (buffer) =>
  Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

const sha256Hex = async (text) => {
  const encoded = new TextEncoder().encode(String(text || ''));
  const digest = await window.crypto.subtle.digest('SHA-256', encoded);
  return toHex(digest);
};

const hmacSha256Hex = async (secret, text) => {
  const keyData = new TextEncoder().encode(String(secret || ''));
  const messageData = new TextEncoder().encode(String(text || ''));
  const cryptoKey = await window.crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await window.crypto.subtle.sign('HMAC', cryptoKey, messageData);
  return toHex(signature);
};

const hasDeviceSecret = (value) => typeof value === 'string' && value.length > 0;

const normalizeObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
};

const nowIso = () => new Date().toISOString();

const runWithLock = async (branchId, fn) => {
  const key = String(branchId);
  const existing = syncLocks.get(key);
  if (existing) return existing;
  const job = (async () => {
    try {
      return await fn();
    } finally {
      syncLocks.delete(key);
    }
  })();
  syncLocks.set(key, job);
  return job;
};

const buildDefaultTerminalCode = (branchId) => {
  const branchNum = String(Number(branchId) || 1).padStart(3, '0');
  const terminalNum = String(Number(localStorage.getItem('terminalId') || 1) || 1).padStart(2, '0');
  return `BR${branchNum}-T${terminalNum}`;
};

const ensureDeviceContext = async (branchId) => {
  const key = DEVICE_CONTEXT_META_KEY(branchId);
  const existing = await getMetaValue(key, null);
  if (existing && existing.device_id && existing.installation_id) {
    return existing;
  }

  const created = {
    device_id: randomUuid(),
    installation_id: randomUuid(),
    terminal_code: buildDefaultTerminalCode(branchId),
    key_version: null,
    device_secret: null,
    updated_at: nowIso(),
  };
  await setMetaValue(key, created, `branch:${branchId}`);
  return created;
};

const persistDeviceContext = async (branchId, value) =>
  setMetaValue(DEVICE_CONTEXT_META_KEY(branchId), value, `branch:${branchId}`);

const readSyncState = async (branchId) =>
  runTransaction(STORE_SYNC_STATE, 'readonly', async ({ stores, requestToPromise: asPromise }) => {
    const row = await asPromise(stores[STORE_SYNC_STATE].get(SCOPE_KEY(branchId)));
    if (!row) {
      return {
        scope_key: SCOPE_KEY(branchId),
        pull_cursor_catalog: null,
        pull_cursor_sections: null,
        pull_cursor_orders: null,
        pull_cursor_inventory: null,
        pull_cursor_conflicts: null,
        last_push_at: null,
        server_time: null,
        updated_at: null,
      };
    }
    return row;
  });

const writeSyncState = async (branchId, patch = {}) =>
  runTransaction(STORE_SYNC_STATE, 'readwrite', async ({ stores, requestToPromise: asPromise }) => {
    const current = (await asPromise(stores[STORE_SYNC_STATE].get(SCOPE_KEY(branchId)))) || {
      scope_key: SCOPE_KEY(branchId),
    };
    const next = {
      ...current,
      ...normalizeObject(patch),
      scope_key: SCOPE_KEY(branchId),
      updated_at: nowIso(),
    };
    await asPromise(stores[STORE_SYNC_STATE].put(next));
    return next;
  });

const nextRetryDelayMs = (attempts) => {
  const safeAttempts = Math.max(0, Number(attempts || 0));
  const base = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * (2 ** safeAttempts));
  const jitter = Math.floor(base * 0.2 * Math.random());
  return Math.min(MAX_RETRY_MS, base + jitter);
};

const toBranchProductKey = (branchId, productRef) => `${branchId}:${String(productRef)}`;

const getLastAuditHash = async (auditStore) =>
  new Promise((resolve, reject) => {
    const req = auditStore.openCursor(null, 'prev');
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve({ prev_hash: null, chain_seq: 0 });
        return;
      }
      resolve({
        prev_hash: cursor.value?.payload_hash || null,
        chain_seq: Number(cursor.value?.chain_seq || 0),
      });
    };
    req.onerror = () => reject(req.error || new Error('Failed to read audit chain'));
  });

const getPendingOutboxBatch = async ({ branchId, nowMs = Date.now(), maxEvents = MAX_BATCH_EVENTS }) =>
  runTransaction(STORE_OUTBOX_EVENTS, 'readonly', async ({ stores, requestToPromise: asPromise }) => {
    const all = await asPromise(stores[STORE_OUTBOX_EVENTS].getAll());
    const pending = all
      .filter((row) => Number(row.branch_id) === Number(branchId))
      .filter((row) => ['pending', 'retry'].includes(String(row.status || 'pending')))
      .filter((row) => Number(row.next_attempt_at || 0) <= nowMs)
      .sort((a, b) => Number(a.device_seq || 0) - Number(b.device_seq || 0));

    const picked = [];
    let bytes = 0;
    for (const row of pending) {
      const serialized = JSON.stringify(row.event || {});
      const size = serialized.length;
      if (picked.length >= maxEvents) break;
      if (bytes + size > MAX_BATCH_BYTES) break;
      picked.push(row);
      bytes += size;
    }
    return picked;
  });

const buildSaleEventEnvelope = async ({ payload, branchId, deviceContext, deviceSeq, prevHash }) => {
  const eventType = 'sale.created';
  const payloadHash = await sha256Hex(JSON.stringify(payload));
  const idempotencyKey = await sha256Hex(
    `${deviceContext.device_id}|${deviceSeq}|${eventType}|${payloadHash}`
  );
  const signature = hasDeviceSecret(deviceContext.device_secret)
    ? await hmacSha256Hex(
      String(deviceContext.device_secret),
      `${payloadHash}|${prevHash || ''}|${deviceSeq}|${eventType}`
    )
    : null;

  const eventId = randomUuid();
  return {
    event_id: eventId,
    idempotency_key: idempotencyKey,
    device_id: deviceContext.device_id,
    terminal_code: deviceContext.terminal_code,
    branch_id: Number(branchId),
    device_seq: Number(deviceSeq),
    event_type: eventType,
    aggregate_type: 'order',
    aggregate_id: payload.client_order_id,
    client_created_at: payload.client_created_at || nowIso(),
    client_hlc: `${Date.now()}-${deviceSeq}-${deviceContext.device_id}`,
    payload,
    payload_hash: payloadHash,
    prev_hash: prevHash || null,
    signature,
  };
};

const signEventForPush = async (event, deviceCtx) => {
  const normalized = normalizeObject(event);
  const eventType = String(normalized.event_type || '');
  const payload = normalizeObject(normalized.payload);
  const payloadHash = normalized.payload_hash || (await sha256Hex(JSON.stringify(payload)));
  const signature = await hmacSha256Hex(
    String(deviceCtx.device_secret || ''),
    `${payloadHash}|${normalized.prev_hash || ''}|${Number(normalized.device_seq || 0)}|${eventType}`
  );

  return {
    ...normalized,
    device_id: deviceCtx.device_id,
    terminal_code: deviceCtx.terminal_code,
    payload,
    payload_hash: payloadHash,
    signature,
  };
};

const commitSaleLocalFirst = async ({ branchId, payload = {} }) => {
  if (!window.indexedDB || !window.crypto || !window.crypto.subtle) {
    throw new Error('Offline crypto/indexedDB support is not available in this browser');
  }

  const normalizedPayload = normalizeObject(payload);
  const clientOrderId = randomUuid();
  const createdAt = nowIso();

  const result = await runTransaction(
    [
      STORE_META,
      STORE_ORDERS_LOCAL,
      STORE_ORDER_ITEMS_LOCAL,
      STORE_OUTBOX_EVENTS,
      STORE_INVENTORY_PROJECTION,
      STORE_AUDIT_CHAIN,
    ],
    'readwrite',
    async ({ stores, requestToPromise: asPromise }) => {
      const contextKey = DEVICE_CONTEXT_META_KEY(branchId);
      let contextRow = await asPromise(stores[STORE_META].get(contextKey));
      if (!contextRow?.value?.device_id || !contextRow?.value?.installation_id) {
        contextRow = {
          key: contextKey,
          namespace: `branch:${branchId}`,
          value: {
            device_id: randomUuid(),
            installation_id: randomUuid(),
            terminal_code: buildDefaultTerminalCode(branchId),
            key_version: null,
            device_secret: null,
            updated_at: nowIso(),
          },
          updated_at: nowIso(),
        };
        await asPromise(stores[STORE_META].put(contextRow));
      }

      const seqKey = DEVICE_SEQ_META_KEY(branchId);
      const seqRow = await asPromise(stores[STORE_META].get(seqKey));
      const nextSeq = Number(seqRow?.value || 0) + 1;

      const payloadForEvent = {
        ...normalizedPayload,
        branch_id: Number(branchId),
        client_order_id: clientOrderId,
        client_created_at: createdAt,
      };

      const { prev_hash: prevHash, chain_seq: lastChainSeq } = await getLastAuditHash(stores[STORE_AUDIT_CHAIN]);

      const event = await buildSaleEventEnvelope({
        payload: payloadForEvent,
        branchId,
        deviceContext: contextRow.value,
        deviceSeq: nextSeq,
        prevHash,
      });

      const orderLocal = {
        client_order_id: clientOrderId,
        branch_id: Number(branchId),
        device_id: contextRow.value.device_id,
        status_local: 'pending',
        status_server: null,
        sync_state: 'pending',
        total: Number(normalizedPayload.total || 0),
        payload: payloadForEvent,
        server_order_id: null,
        created_client_at: createdAt,
        updated_at: createdAt,
      };
      await asPromise(stores[STORE_ORDERS_LOCAL].put(orderLocal));

      const items = Array.isArray(normalizedPayload.items) ? normalizedPayload.items : [];
      for (let i = 0; i < items.length; i += 1) {
        const item = normalizeObject(items[i]);
        const row = {
          client_order_item_id: `${clientOrderId}:${i + 1}`,
          client_order_id: clientOrderId,
          product_uid: String(item.product_uid || item.product_id || ''),
          qty: Number(item.quantity || 0),
          unit_price: Number(item.unit_price || 0),
          modifiers: normalizeObject(item.modifiers),
          created_at: createdAt,
        };
        await asPromise(stores[STORE_ORDER_ITEMS_LOCAL].put(row));

        if (row.product_uid && row.qty > 0) {
          const invKey = toBranchProductKey(branchId, row.product_uid);
          const existingInv = (await asPromise(stores[STORE_INVENTORY_PROJECTION].get(invKey))) || {
            branch_product_key: invKey,
            branch_id: Number(branchId),
            product_uid: row.product_uid,
            available_qty: null,
            pending_delta_qty: 0,
            last_server_version: null,
            updated_at: createdAt,
          };
          existingInv.pending_delta_qty = Number(existingInv.pending_delta_qty || 0) - row.qty;
          existingInv.updated_at = createdAt;
          await asPromise(stores[STORE_INVENTORY_PROJECTION].put(existingInv));
        }
      }

      await asPromise(
        stores[STORE_OUTBOX_EVENTS].put({
          event_id: event.event_id,
          branch_id: Number(branchId),
          device_seq: Number(nextSeq),
          event_type: event.event_type,
          aggregate_type: event.aggregate_type,
          aggregate_id: event.aggregate_id,
          event,
          status: 'pending',
          attempts: 0,
          next_attempt_at: Date.now(),
          last_error: null,
          created_at: createdAt,
          updated_at: createdAt,
        })
      );

      await asPromise(
        stores[STORE_AUDIT_CHAIN].put({
          chain_seq: lastChainSeq + 1,
          event_id: event.event_id,
          payload_hash: event.payload_hash,
          prev_hash: event.prev_hash,
          signature_valid: Boolean(event.signature),
          created_at: createdAt,
        })
      );

      await asPromise(
        stores[STORE_META].put({
          key: seqKey,
          namespace: `branch:${branchId}`,
          value: nextSeq,
          updated_at: createdAt,
        })
      );

      return {
        branchId: Number(branchId),
        clientOrderId,
        eventId: event.event_id,
        deviceSeq: nextSeq,
        deviceId: contextRow.value.device_id,
        terminalCode: contextRow.value.terminal_code,
      };
    }
  );

  return {
    branchId: result.branchId,
    data: {
      id: result.clientOrderId,
      client_order_id: result.clientOrderId,
      order_number: `LOCAL-${String(Date.now()).slice(-8)}`,
      source: 'pos',
      order_channel: 'pos',
      status: 'pending',
      branch_id: Number(branchId),
      created_at: createdAt,
      sync_state: 'pending',
      total: Number(normalizedPayload.total || 0),
    },
  };
};

const ensureDeviceRegisteredForBranch = async (branchId) => {
  const ctx = await ensureDeviceContext(branchId);
  if (ctx.device_secret && ctx.key_version) return ctx;

  const response = await api.post(
    '/v2/devices/register',
    {
      branch_id: Number(branchId),
      device_id: ctx.device_id,
      installation_id: ctx.installation_id,
      terminal_code: ctx.terminal_code,
      label: `POS ${ctx.terminal_code}`,
      metadata: {
        platform: 'web',
      },
    },
    { params: { branch_id: Number(branchId) } }
  );

  const data = response?.data?.data || {};
  const next = {
    ...ctx,
    key_version: Number(data.key_version || 1),
    device_secret: String(data.device_secret || ''),
    updated_at: nowIso(),
  };
  await persistDeviceContext(branchId, next);
  return next;
};

const buildSyncHeaders = async (deviceCtx, payloadText = '') => {
  const requestTimestamp = nowIso();
  const requestIdempotencyKey = randomUuid();
  const payloadHash = await sha256Hex(payloadText || '');
  const requestSignature = await hmacSha256Hex(
    String(deviceCtx.device_secret || ''),
    `${requestTimestamp}|${requestIdempotencyKey}|${payloadHash}`
  );
  return {
    'X-Device-Id': deviceCtx.device_id,
    'X-Terminal-Code': deviceCtx.terminal_code,
    'X-Request-Timestamp': requestTimestamp,
    'X-Signature': requestSignature,
    'X-Idempotency-Key': requestIdempotencyKey,
  };
};

const applyPushAckResults = async (branchId, results = []) =>
  runTransaction(
    [STORE_OUTBOX_EVENTS, STORE_INBOX_APPLIED, STORE_ORDERS_LOCAL, STORE_CONFLICTS],
    'readwrite',
    async ({ stores, requestToPromise: asPromise }) => {
      const now = nowIso();
      for (const rawResult of results) {
        const result = normalizeObject(rawResult);
        const eventId = String(result.event_id || '').trim();
        if (!eventId) continue;

        const outboxRow = await asPromise(stores[STORE_OUTBOX_EVENTS].get(eventId));
        if (!outboxRow) continue;
        const status = String(result.status || '').toLowerCase();
        const message = String(result.message || '');
        const code = String(result.code || '');
        const refs = normalizeObject(result.server_refs);

        let nextOutboxStatus = outboxRow.status;
        if (status === 'accepted' || status === 'duplicate') nextOutboxStatus = 'acked';
        if (status === 'conflict') nextOutboxStatus = 'conflict';
        if (status === 'rejected') nextOutboxStatus = 'rejected';

        const updatedOutbox = {
          ...outboxRow,
          status: nextOutboxStatus,
          last_error: status === 'accepted' || status === 'duplicate' ? null : message || code || 'sync_error',
          updated_at: now,
          ack_result: result,
        };
        await asPromise(stores[STORE_OUTBOX_EVENTS].put(updatedOutbox));

        await asPromise(
          stores[STORE_INBOX_APPLIED].put({
            event_id: eventId,
            status,
            code,
            message,
            server_refs: refs,
            applied_at: now,
          })
        );

        const aggregateId = String(outboxRow.aggregate_id || '');
        if (!aggregateId) continue;
        const localOrder = await asPromise(stores[STORE_ORDERS_LOCAL].get(aggregateId));
        if (!localOrder) continue;

        let nextSyncState = localOrder.sync_state || 'pending';
        if (status === 'accepted' || status === 'duplicate') nextSyncState = 'synced';
        if (status === 'conflict') nextSyncState = 'conflict';
        if (status === 'rejected') nextSyncState = 'rejected';

        await asPromise(
          stores[STORE_ORDERS_LOCAL].put({
            ...localOrder,
            sync_state: nextSyncState,
            status_server: result.order_status || localOrder.status_server || (status === 'accepted' ? 'pending' : null),
            server_order_id: refs.order_id || localOrder.server_order_id || null,
            last_error: status === 'accepted' || status === 'duplicate' ? null : message,
            updated_at: now,
          })
        );

        if (status === 'conflict') {
          const conflictId = String(refs.conflict_id || randomUuid());
          await asPromise(
            stores[STORE_CONFLICTS].put({
              conflict_id: conflictId,
              event_id: eventId,
              type: code || 'sync_conflict',
              resolution_state: 'open',
              details: result,
              created_at: now,
              updated_at: now,
            })
          );
        }
      }
    }
  );

const markOutboxBatchRetry = async ({ batchRows = [], errorMessage = 'sync_failed' }) =>
  runTransaction(STORE_OUTBOX_EVENTS, 'readwrite', async ({ stores, requestToPromise: asPromise }) => {
    const now = nowIso();
    for (const row of batchRows) {
      const current = await asPromise(stores[STORE_OUTBOX_EVENTS].get(row.event_id));
      if (!current) continue;
      const nextAttempts = Number(current.attempts || 0) + 1;
      const nextDelayMs = nextRetryDelayMs(nextAttempts);
      await asPromise(
        stores[STORE_OUTBOX_EVENTS].put({
          ...current,
          status: 'retry',
          attempts: nextAttempts,
          next_attempt_at: Date.now() + nextDelayMs,
          last_error: String(errorMessage || 'sync_failed'),
          updated_at: now,
        })
      );
    }
  });

const applyCatalogDeltas = async (branchId, products = [], sections = []) =>
  runTransaction(
    [STORE_CATALOG_PRODUCTS, STORE_CATALOG_SECTIONS, STORE_INVENTORY_PROJECTION],
    'readwrite',
    async ({ stores, requestToPromise: asPromise }) => {
      const now = nowIso();

      for (const raw of products) {
        const row = normalizeObject(raw);
        const productUid = String(row.product_uid || row.id || '');
        if (!productUid) continue;
        const key = toBranchProductKey(branchId, productUid);
        await asPromise(
          stores[STORE_CATALOG_PRODUCTS].put({
            branch_product_key: key,
            branch_id: Number(branchId),
            product_uid: productUid,
            name: row.name || '',
            sku: row.sku || '',
            section_id: row.section_id || null,
            base_price: Number(row.base_price || 0),
            price_override: row.price_override === null || row.price_override === undefined ? null : Number(row.price_override),
            stock_view: row.effective_stock === null || row.effective_stock === undefined ? null : Number(row.effective_stock),
            version: {
              base_price_version: Number(row.base_price_version || 0),
              price_version: Number(row.price_version || 0),
            },
            is_available: row.is_available !== false,
            updated_at: row.branch_updated_at || row.product_updated_at || now,
          })
        );

        const inv = (await asPromise(stores[STORE_INVENTORY_PROJECTION].get(key))) || {
          branch_product_key: key,
          branch_id: Number(branchId),
          product_uid: productUid,
          pending_delta_qty: 0,
          last_server_version: null,
        };
        inv.available_qty = row.effective_stock === null || row.effective_stock === undefined
          ? inv.available_qty ?? null
          : Number(row.effective_stock);
        inv.last_server_version = Number(row.price_version || row.base_price_version || 0);
        inv.updated_at = row.branch_updated_at || row.product_updated_at || now;
        await asPromise(stores[STORE_INVENTORY_PROJECTION].put(inv));
      }

      for (const raw of sections) {
        const row = normalizeObject(raw);
        const sectionId = String(row.id || '');
        if (!sectionId) continue;
        await asPromise(
          stores[STORE_CATALOG_SECTIONS].put({
            branch_section_key: `${branchId}:${sectionId}`,
            branch_id: Number(branchId),
            section_id: sectionId,
            name: row.name || '',
            description: row.description || '',
            display_order: Number(row.display_order || 0),
            is_active: row.is_active !== false,
            version: Number(new Date(row.updated_at || now).getTime()),
            updated_at: row.updated_at || now,
          })
        );
      }
    }
  );

const applyOrderDeltas = async (orders = []) =>
  runTransaction(STORE_ORDERS_LOCAL, 'readwrite', async ({ stores, requestToPromise: asPromise }) => {
    const now = nowIso();
    for (const raw of orders) {
      const row = normalizeObject(raw);
      const clientOrderId = String(row.client_order_id || '');
      if (!clientOrderId) continue;
      const existing = await asPromise(stores[STORE_ORDERS_LOCAL].get(clientOrderId));
      if (existing) {
        await asPromise(
          stores[STORE_ORDERS_LOCAL].put({
            ...existing,
            status_server: row.status || existing.status_server || null,
            server_order_id: row.id || existing.server_order_id || null,
            sync_state: existing.sync_state === 'pending' ? 'pending' : 'synced',
            updated_at: row.updated_at || now,
          })
        );
      }
    }
  });

const applyInventoryDeltas = async (branchId, rows = []) =>
  runTransaction(STORE_INVENTORY_PROJECTION, 'readwrite', async ({ stores, requestToPromise: asPromise }) => {
    const now = nowIso();
    for (const raw of rows) {
      const row = normalizeObject(raw);
      const productRef = String(row.product_uid || row.product_id || '');
      if (!productRef) continue;
      const key = toBranchProductKey(branchId, productRef);
      const current = (await asPromise(stores[STORE_INVENTORY_PROJECTION].get(key))) || {
        branch_product_key: key,
        branch_id: Number(branchId),
        product_uid: productRef,
        available_qty: null,
        pending_delta_qty: 0,
        last_server_version: null,
        updated_at: now,
      };
      if (row.balance_after !== undefined && row.balance_after !== null) {
        current.available_qty = Number(row.balance_after);
      } else if (current.available_qty !== null && current.available_qty !== undefined) {
        current.available_qty = Number(current.available_qty || 0) + Number(row.delta_qty || 0);
      }
      current.updated_at = row.created_at || now;
      await asPromise(stores[STORE_INVENTORY_PROJECTION].put(current));
    }
  });

const applyConflictDeltas = async (rows = []) =>
  runTransaction(STORE_CONFLICTS, 'readwrite', async ({ stores, requestToPromise: asPromise }) => {
    const now = nowIso();
    for (const raw of rows) {
      const row = normalizeObject(raw);
      const conflictId = String(row.id || row.conflict_id || '');
      if (!conflictId) continue;
      await asPromise(
        stores[STORE_CONFLICTS].put({
          conflict_id: conflictId,
          event_id: row.event_id || null,
          type: row.conflict_type || row.type || 'sync_conflict',
          resolution_state: row.status || row.resolution_state || 'open',
          details: row.details || {},
          resolution: row.resolution || {},
          created_at: row.created_at || now,
          updated_at: row.updated_at || now,
        })
      );
    }
  });

const bootstrapBranchSnapshot = async (branchId, deviceCtx) => {
  const isBootstrapped = await getMetaValue(BOOTSTRAP_META_KEY(branchId), false);
  if (isBootstrapped) return null;

  const headers = await buildSyncHeaders(deviceCtx, '');
  const response = await api.get('/v2/sync/bootstrap', {
    params: { branch_id: Number(branchId) },
    headers,
  });
  const data = response?.data?.data || {};
  const snapshot = normalizeObject(data.snapshot);
  const cursors = normalizeObject(data.cursors);

  await applyCatalogDeltas(branchId, snapshot.catalog_products || [], snapshot.catalog_sections || []);
  await applyConflictDeltas(snapshot.open_conflicts || []);
  await writeSyncState(branchId, {
    pull_cursor_catalog: cursors.catalog || null,
    pull_cursor_sections: cursors.sections || null,
    pull_cursor_orders: cursors.orders || null,
    pull_cursor_inventory: cursors.inventory || null,
    pull_cursor_conflicts: cursors.conflicts || null,
    server_time: data.server_time || nowIso(),
  });
  await setMetaValue(BOOTSTRAP_META_KEY(branchId), true, `branch:${branchId}`);
  return data;
};

const pushOutbox = async (branchId, deviceCtx) => {
  const batchRows = await getPendingOutboxBatch({ branchId });
  if (!batchRows.length) return { pushed: 0, results: [] };

  const events = [];
  for (const row of batchRows) {
    if (!row?.event) continue;
    events.push(await signEventForPush(row.event, deviceCtx));
  }
  if (!events.length) return { pushed: 0, results: [] };

  const payload = { events };
  const payloadText = JSON.stringify(payload);
  const headers = await buildSyncHeaders(deviceCtx, payloadText);

  try {
    const response = await api.post('/v2/sync/push', payload, {
      params: { branch_id: Number(branchId) },
      headers,
    });
    const results = response?.data?.data?.results || [];
    await applyPushAckResults(branchId, results);
    await writeSyncState(branchId, { last_push_at: nowIso() });
    return { pushed: events.length, results };
  } catch (err) {
    await markOutboxBatchRetry({
      batchRows,
      errorMessage: err?.response?.data?.error || err?.message || 'push_failed',
    });
    throw err;
  }
};

const pullDeltas = async (branchId, deviceCtx) => {
  const state = await readSyncState(branchId);
  const headers = await buildSyncHeaders(deviceCtx, '');
  const response = await api.get('/v2/sync/pull', {
    params: {
      branch_id: Number(branchId),
      cursor_catalog: state.pull_cursor_catalog || undefined,
      cursor_sections: state.pull_cursor_sections || undefined,
      cursor_orders: state.pull_cursor_orders || undefined,
      cursor_inventory: state.pull_cursor_inventory || undefined,
      cursor_conflicts: state.pull_cursor_conflicts || undefined,
      limit: 500,
    },
    headers,
  });
  const data = response?.data?.data || {};
  const deltas = normalizeObject(data.deltas);
  const next = normalizeObject(data.next_cursors);

  await applyCatalogDeltas(branchId, deltas.catalog_products || [], deltas.catalog_sections || []);
  await applyOrderDeltas(deltas.orders || []);
  await applyInventoryDeltas(branchId, deltas.inventory || []);
  await applyConflictDeltas(deltas.conflicts || []);
  await writeSyncState(branchId, {
    pull_cursor_catalog: next.catalog || state.pull_cursor_catalog || null,
    pull_cursor_sections: next.sections || state.pull_cursor_sections || null,
    pull_cursor_orders: next.orders || state.pull_cursor_orders || null,
    pull_cursor_inventory: next.inventory || state.pull_cursor_inventory || null,
    pull_cursor_conflicts: next.conflicts || state.pull_cursor_conflicts || null,
    server_time: data.server_time || nowIso(),
  });
  return data;
};

const flushOfflineSyncOnce = async (branchId) => {
  if (!isOfflineV2Enabled()) {
    return { skipped: true, reason: 'offline_v2_disabled' };
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { skipped: true, reason: 'browser_offline' };
  }

  return runWithLock(branchId, async () => {
    const deviceCtx = await ensureDeviceRegisteredForBranch(branchId);
    await bootstrapBranchSnapshot(branchId, deviceCtx);
    const pushSummary = await pushOutbox(branchId, deviceCtx);
    const pullSummary = await pullDeltas(branchId, deviceCtx);
    return {
      pushed: Number(pushSummary.pushed || 0),
      pulled_at: nowIso(),
      pull_summary: pullSummary,
    };
  });
};

const triggerOfflineSyncNow = async (branchId) => {
  try {
    return await flushOfflineSyncOnce(branchId);
  } catch (_) {
    return null;
  }
};

const startOfflineSyncEngine = (branchId, { intervalMs = 10000 } = {}) => {
  const key = String(branchId);
  if (syncIntervals.has(key)) {
    return syncIntervals.get(key).stop;
  }

  const tick = () => {
    triggerOfflineSyncNow(branchId);
  };

  const handleOnline = () => tick();
  window.addEventListener('online', handleOnline);
  const timer = window.setInterval(tick, Math.max(5000, Number(intervalMs) || 10000));
  tick();

  const stop = () => {
    window.clearInterval(timer);
    window.removeEventListener('online', handleOnline);
    syncIntervals.delete(key);
  };
  syncIntervals.set(key, { timer, stop, branchId: Number(branchId) });
  return stop;
};

const stopOfflineSyncEngine = (branchId) => {
  const key = String(branchId);
  const entry = syncIntervals.get(key);
  if (entry && typeof entry.stop === 'function') {
    entry.stop();
  }
};

export {
  isOfflineV2Enabled,
  setOfflineV2Enabled,
  ensureDeviceContext,
  persistDeviceContext,
  readSyncState,
  writeSyncState,
  getPendingOutboxBatch,
  commitSaleLocalFirst,
  flushOfflineSyncOnce,
  triggerOfflineSyncNow,
  startOfflineSyncEngine,
  stopOfflineSyncEngine,
  runWithLock,
  nextRetryDelayMs,
  nowIso,
  sha256Hex,
  hmacSha256Hex,
  randomUuid,
  DEVICE_CONTEXT_META_KEY,
  BOOTSTRAP_META_KEY,
  SCOPE_KEY,
};
