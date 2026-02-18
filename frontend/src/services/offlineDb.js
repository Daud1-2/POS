const DB_NAME = 'pos_offline';
const DB_VERSION = 3;

const STORE_META = 'meta';
const STORE_CATALOG_PRODUCTS = 'catalog_products';
const STORE_CATALOG_SECTIONS = 'catalog_sections';
const STORE_INVENTORY_PROJECTION = 'inventory_projection';
const STORE_ORDERS_LOCAL = 'orders_local';
const STORE_ORDER_ITEMS_LOCAL = 'order_items_local';
const STORE_OUTBOX_EVENTS = 'outbox_events';
const STORE_INBOX_APPLIED = 'inbox_applied';
const STORE_SYNC_STATE = 'sync_state';
const STORE_CONFLICTS = 'conflicts';
const STORE_AUDIT_CHAIN = 'audit_chain';

let dbPromise = null;

const requestToPromise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });

const transactionDone = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
  });

const ensureStore = (db, storeName, options) => {
  if (!db.objectStoreNames.contains(storeName)) {
    return db.createObjectStore(storeName, options);
  }
  return null;
};

const ensureStoreIndex = (store, indexName, keyPath, options = {}) => {
  if (!store.indexNames.contains(indexName)) {
    store.createIndex(indexName, keyPath, options);
  }
};

const upgradeV1 = (db) => {
  const meta = ensureStore(db, STORE_META, { keyPath: 'key' });
  const products = ensureStore(db, STORE_CATALOG_PRODUCTS, { keyPath: 'branch_product_key' });
  const sections = ensureStore(db, STORE_CATALOG_SECTIONS, { keyPath: 'branch_section_key' });
  const inventory = ensureStore(db, STORE_INVENTORY_PROJECTION, { keyPath: 'branch_product_key' });
  const orders = ensureStore(db, STORE_ORDERS_LOCAL, { keyPath: 'client_order_id' });
  const orderItems = ensureStore(db, STORE_ORDER_ITEMS_LOCAL, { keyPath: 'client_order_item_id' });
  const outbox = ensureStore(db, STORE_OUTBOX_EVENTS, { keyPath: 'event_id' });
  const inbox = ensureStore(db, STORE_INBOX_APPLIED, { keyPath: 'event_id' });
  const syncState = ensureStore(db, STORE_SYNC_STATE, { keyPath: 'scope_key' });
  const conflicts = ensureStore(db, STORE_CONFLICTS, { keyPath: 'conflict_id' });
  const auditChain = ensureStore(db, STORE_AUDIT_CHAIN, { keyPath: 'chain_seq' });

  if (meta) {
    // No indexes.
  }
  if (products) {
    ensureStoreIndex(products, 'by_branch_updated_at', ['branch_id', 'updated_at']);
    ensureStoreIndex(products, 'by_branch_sku', ['branch_id', 'sku']);
    ensureStoreIndex(products, 'by_branch_section', ['branch_id', 'section_id']);
  }
  if (sections) {
    ensureStoreIndex(sections, 'by_branch_display_order', ['branch_id', 'display_order']);
  }
  if (inventory) {
    ensureStoreIndex(inventory, 'by_branch_available_qty', ['branch_id', 'available_qty']);
  }
  if (orders) {
    ensureStoreIndex(orders, 'by_branch_created_at', ['branch_id', 'created_client_at']);
    ensureStoreIndex(orders, 'by_sync_state', 'sync_state');
  }
  if (orderItems) {
    ensureStoreIndex(orderItems, 'by_client_order_id', 'client_order_id');
  }
  if (outbox) {
    ensureStoreIndex(outbox, 'by_status_next_attempt', ['status', 'next_attempt_at']);
    ensureStoreIndex(outbox, 'by_branch_seq', ['branch_id', 'device_seq']);
    ensureStoreIndex(outbox, 'by_aggregate', ['aggregate_type', 'aggregate_id']);
  }
  if (inbox) {
    ensureStoreIndex(inbox, 'by_applied_at', 'applied_at');
  }
  if (syncState) {
    // No indexes.
  }
  if (conflicts) {
    ensureStoreIndex(conflicts, 'by_state_created_at', ['resolution_state', 'created_at']);
  }
  if (auditChain) {
    ensureStoreIndex(auditChain, 'by_event_id', 'event_id');
  }
};

const upgradeV2 = (db, tx) => {
  const outbox = tx.objectStore(STORE_OUTBOX_EVENTS);
  ensureStoreIndex(outbox, 'by_event_type', 'event_type');
};

const upgradeV3 = (db, tx) => {
  const meta = tx.objectStore(STORE_META);
  ensureStoreIndex(meta, 'by_namespace', 'namespace');
};

const openOfflineDb = () => {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const openReq = window.indexedDB.open(DB_NAME, DB_VERSION);

    openReq.onupgradeneeded = (event) => {
      const db = openReq.result;
      const tx = openReq.transaction;
      const oldVersion = Number(event.oldVersion || 0);

      if (oldVersion < 1) {
        upgradeV1(db);
      }
      if (oldVersion < 2) {
        upgradeV2(db, tx);
      }
      if (oldVersion < 3) {
        upgradeV3(db, tx);
      }
    };

    openReq.onsuccess = () => {
      const db = openReq.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    openReq.onerror = () => {
      reject(openReq.error || new Error('Failed to open offline database'));
    };
  });

  return dbPromise;
};

const runTransaction = async (storeNames, mode, handler) => {
  const db = await openOfflineDb();
  const names = Array.isArray(storeNames) ? storeNames : [storeNames];
  const tx = db.transaction(names, mode);
  const stores = {};
  names.forEach((name) => {
    stores[name] = tx.objectStore(name);
  });
  const result = await handler({
    tx,
    stores,
    requestToPromise,
  });
  await transactionDone(tx);
  return result;
};

const getMetaValue = async (key, fallback = null) =>
  runTransaction(STORE_META, 'readonly', async ({ stores, requestToPromise: asPromise }) => {
    const row = await asPromise(stores[STORE_META].get(key));
    if (!row) return fallback;
    return row.value;
  });

const setMetaValue = async (key, value, namespace = 'global') =>
  runTransaction(STORE_META, 'readwrite', async ({ stores, requestToPromise: asPromise }) =>
    asPromise(
      stores[STORE_META].put({
        key,
        value,
        namespace,
        updated_at: new Date().toISOString(),
      })
    ));

export {
  DB_NAME,
  DB_VERSION,
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
  openOfflineDb,
  runTransaction,
  requestToPromise,
  getMetaValue,
  setMetaValue,
};
