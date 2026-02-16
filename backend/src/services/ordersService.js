const db = require('./db');
const { evaluateOrderDiscountsInTx, recordPromoUsage } = require('./discountsService');
const { resolveAddonSelections } = require('./addonPricing');
const {
  getBusinessSettings,
  assertBranchOrderAllowed,
  computeTax,
  applyRounding: applySettingsRounding,
  SettingsValidationError,
} = require('./settingsService');

const ALLOWED_SOURCES = new Set(['pos', 'website', 'phone', 'kiosk']);
const ALLOWED_ORDER_CHANNELS = new Set(['pos', 'online', 'whatsapp', 'delivery_platform']);
const ALLOWED_ORDER_TYPES = new Set(['dine_in', 'takeaway', 'delivery']);
const ALLOWED_STATUSES = new Set([
  'draft',
  'pending',
  'completed',
  'cancelled',
  'refunded',
  'new',
  'accepted',
  'preparing',
  'ready',
  'rejected',
]);
const ALLOWED_PAYMENT_STATUSES = new Set(['unpaid', 'paid', 'partially_paid']);
const ALLOWED_PAYMENT_METHODS = new Set(['cash', 'card', 'online']);
const ALLOWED_CUSTOMER_TYPES = new Set(['registered', 'guest', 'unidentified']);
const LEGACY_STATUSES = new Set(['open', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled', 'refunded']);
const POS_STATUSES = new Set(['draft', 'pending', 'completed', 'cancelled', 'refunded']);
const ONLINE_STATUSES = new Set(['new', 'accepted', 'preparing', 'ready', 'completed', 'rejected', 'refunded']);
const TRANSITIONS_POS = new Map([
  ['draft', new Set(['pending', 'cancelled'])],
  ['pending', new Set(['completed', 'cancelled'])],
  ['completed', new Set(['refunded'])],
  ['cancelled', new Set([])],
  ['refunded', new Set([])],
]);
const TRANSITIONS_ONLINE = new Map([
  ['new', new Set(['accepted', 'rejected'])],
  ['accepted', new Set(['preparing', 'rejected'])],
  ['preparing', new Set(['ready', 'rejected'])],
  ['ready', new Set(['completed', 'rejected'])],
  ['completed', new Set(['refunded'])],
  ['rejected', new Set([])],
  ['refunded', new Set([])],
]);
const CHANNEL_BY_SOURCE = {
  pos: 'pos',
  kiosk: 'pos',
  phone: 'pos',
  website: 'online',
};
const DEFAULT_SOURCE_BY_CHANNEL = {
  pos: 'pos',
  online: 'website',
  whatsapp: 'website',
  delivery_platform: 'website',
};

class ValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = statusCode;
  }
}

const roundMoney = (value) => Number(Number(value).toFixed(2));

const toMoney = (value, fieldName, { required = false, min = 0 } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return null;
  }

  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new ValidationError(`${fieldName} must be a valid number`);
  }
  if (num < min) {
    throw new ValidationError(`${fieldName} must be >= ${min}`);
  }
  return roundMoney(num);
};

const toPositiveInt = (value, fieldName, { required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return null;
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) {
    throw new ValidationError(`${fieldName} must be a positive integer`);
  }
  return num;
};

const toIsoTimestamp = (value, fieldName) => {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${fieldName} must be a valid timestamp`);
  }
  return date.toISOString();
};

const normalizeObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
};

const normalizeText = (value, fieldName, { max = 255 } = {}) => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) {
    throw new ValidationError(`${fieldName} must be <= ${max} characters`);
  }
  return text;
};

const normalizeEmail = (value, fieldName = 'customer.email') => {
  const email = normalizeText(value, fieldName, { max: 320 });
  if (!email) return null;
  return email.toLowerCase();
};

const normalizePhone = (value, fieldName = 'customer.phone') => {
  const phone = normalizeText(value, fieldName, { max: 20 });
  if (!phone) return null;
  return phone.replace(/\s+/g, '');
};

const normalizeCustomerPayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const id = toPositiveInt(payload.id, 'customer.id');
  const name = normalizeText(payload.name ?? payload.full_name, 'customer.name', { max: 160 });
  const phone = normalizePhone(payload.phone ?? payload.phone_e164, 'customer.phone');
  const email = normalizeEmail(payload.email, 'customer.email');

  const customerTypeRaw = normalizeText(payload.type ?? payload.customer_type, 'customer.type', { max: 20 });
  const customerType = customerTypeRaw ? customerTypeRaw.toLowerCase() : null;
  if (customerType && !ALLOWED_CUSTOMER_TYPES.has(customerType)) {
    throw new ValidationError('customer.type must be registered, guest, or unidentified');
  }

  if (!id && !name && !phone && !email && !customerType) {
    return null;
  }

  return {
    id,
    name,
    phone,
    email,
    customer_type: customerType || null,
  };
};

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const generateOrderNumber = () => {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  const rand = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
  return `ORD-${stamp}-${rand}`;
};

const normalizeSource = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const source = String(value).trim().toLowerCase();
  if (source === 'app') return 'kiosk';
  if (!ALLOWED_SOURCES.has(source)) {
    throw new ValidationError('source must be pos, website, phone, or kiosk');
  }
  return source;
};

const normalizeOrderChannel = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const channel = String(value).trim().toLowerCase();
  if (!ALLOWED_ORDER_CHANNELS.has(channel)) {
    throw new ValidationError('order_channel must be pos, online, whatsapp, or delivery_platform');
  }
  return channel;
};

const getDefaultStatusForChannel = (channel) => (channel === 'pos' ? 'pending' : 'new');

const mapLegacyStatus = (status, channel) => {
  const normalized = String(status || '').trim().toLowerCase();
  if (!LEGACY_STATUSES.has(normalized)) return normalized;

  if (channel === 'pos') {
    if (['open', 'preparing', 'ready', 'out_for_delivery'].includes(normalized)) return 'pending';
    return normalized;
  }

  if (normalized === 'open') return 'new';
  if (normalized === 'cancelled') return 'rejected';
  if (normalized === 'out_for_delivery') return 'ready';
  return normalized;
};

const assertStatusMatchesChannel = (status, channel) => {
  if (channel === 'pos' && !POS_STATUSES.has(status)) {
    throw new ValidationError(`status ${status} is invalid for order_channel pos`);
  }
  if (channel !== 'pos' && !ONLINE_STATUSES.has(status)) {
    throw new ValidationError(`status ${status} is invalid for order_channel ${channel}`);
  }
};

const normalizeCanonicalStatus = (status, channel) => {
  const normalized = mapLegacyStatus(status, channel);
  if (!ALLOWED_STATUSES.has(normalized)) {
    throw new ValidationError(
      'status must be draft, pending, completed, cancelled, refunded, new, accepted, preparing, ready, or rejected'
    );
  }
  assertStatusMatchesChannel(normalized, channel);
  return normalized;
};

const canTransition = (fromStatus, toStatus, channel) => {
  if (fromStatus === toStatus) return true;
  const matrix = channel === 'pos' ? TRANSITIONS_POS : TRANSITIONS_ONLINE;
  const allowedNext = matrix.get(fromStatus);
  if (!allowedNext) return false;
  return allowedNext.has(toStatus);
};

const shouldDeductInventoryForStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'pending' || normalized === 'completed';
};

const shouldRestockInventoryForStatus = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  return normalized === 'cancelled' || normalized === 'rejected';
};

const assertMoneyMatch = (expected, provided, fieldName) => {
  if (provided === null || provided === undefined) return;
  if (Math.abs(expected - provided) > 0.01) {
    throw new ValidationError(
      `${fieldName} mismatch: expected ${expected.toFixed(2)} but received ${provided.toFixed(2)}`
    );
  }
};

const normalizeItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ValidationError('items are required');
  }

  return items.map((item, index) => {
    const productId = toPositiveInt(item.product_id ?? item.productId, `items[${index}].product_id`, {
      required: true,
    });
    const quantity = toPositiveInt(item.quantity, `items[${index}].quantity`, { required: true });
    return {
      product_id: productId,
      quantity,
      modifiers: normalizeObject(item.modifiers),
    };
  });
};

const normalizeCreateOrderInput = (payload = {}, context = {}) => {
  const sourceRaw = normalizeSource(payload.source);
  const providedChannel = normalizeOrderChannel(payload.order_channel ?? payload.orderChannel);
  const derivedChannel = sourceRaw ? CHANNEL_BY_SOURCE[sourceRaw] || 'pos' : null;
  const orderChannel = providedChannel || derivedChannel || 'pos';
  const source = sourceRaw || DEFAULT_SOURCE_BY_CHANNEL[orderChannel] || 'pos';

  const orderType = payload.order_type || payload.orderType || 'takeaway';
  if (!ALLOWED_ORDER_TYPES.has(orderType)) {
    throw new ValidationError('order_type must be dine_in, takeaway, or delivery');
  }

  const status = normalizeCanonicalStatus(payload.status || getDefaultStatusForChannel(orderChannel), orderChannel);

  let paymentMethod = payload.payment_method || payload.paymentMethod || 'cash';
  if (paymentMethod === 'credit') paymentMethod = 'card';
  if (!ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
    throw new ValidationError('payment_method must be cash, card, or online');
  }

  const paymentStatus =
    payload.payment_status ||
    payload.paymentStatus ||
    (['completed', 'refunded'].includes(status) ? 'paid' : 'unpaid');
  if (!ALLOWED_PAYMENT_STATUSES.has(paymentStatus)) {
    throw new ValidationError('payment_status must be unpaid, paid, or partially_paid');
  }

  const tax = toMoney(payload.tax, 'tax') ?? 0;
  const manualDiscount = toMoney(payload.manual_discount ?? payload.manualDiscount, 'manual_discount') ?? 0;
  const providedSubtotal = toMoney(payload.subtotal, 'subtotal');
  const providedTotal = toMoney(payload.total, 'total');
  const scheduledFor = toIsoTimestamp(payload.scheduled_for || payload.scheduledFor, 'scheduled_for');
  const completedAt = toIsoTimestamp(payload.completed_at || payload.completedAt, 'completed_at');
  const refundedAt = toIsoTimestamp(payload.refunded_at || payload.refundedAt, 'refunded_at');
  const customerId = toPositiveInt(payload.customer_id || payload.customerId, 'customer_id');
  const customer = normalizeCustomerPayload(payload.customer);
  const outletId = toPositiveInt(
    context.branchId ??
      context.outletId ??
      payload.branch_id ??
      payload.branchId ??
      payload.outlet_id ??
      payload.outletId ??
      1,
    'branch_id',
    { required: true }
  );

  return {
    source,
    order_channel: orderChannel,
    order_type: orderType,
    status,
    payment_method: paymentMethod,
    payment_status: paymentStatus,
    tax,
    manual_discount: manualDiscount,
    provided_subtotal: providedSubtotal,
    provided_total: providedTotal,
    scheduled_for: scheduledFor,
    completed_at: status === 'completed' ? completedAt || new Date().toISOString() : null,
    refunded_at: status === 'refunded' ? refundedAt || new Date().toISOString() : null,
    customer_id: customerId,
    customer,
    customer_name_snapshot: normalizeText(
      payload.customer_name_snapshot ?? payload.customerName ?? payload.customer_name,
      'customer_name_snapshot',
      { max: 160 }
    ),
    customer_phone_snapshot: normalizePhone(
      payload.customer_phone_snapshot ?? payload.customerPhone ?? payload.customer_phone,
      'customer_phone_snapshot'
    ),
    customer_email_snapshot: normalizeEmail(
      payload.customer_email_snapshot ?? payload.customerEmail ?? payload.customer_email,
      'customer_email_snapshot'
    ),
    outlet_id: outletId,
    external_order_id: payload.external_order_id || payload.externalOrderId || null,
    external_source: payload.external_source || payload.externalSource || null,
    metadata: normalizeObject(payload.metadata),
    order_number: typeof payload.order_number === 'string' ? payload.order_number.trim() : '',
    items: normalizeItems(payload.items),
    promo_code: payload.promo_code || payload.promoCode || null,
    actor_id: context.actorId ? String(context.actorId) : null,
    status_reason: typeof payload.status_reason === 'string' ? payload.status_reason : null,
  };
};

const fetchLockedProductWithOutletSettings = async ({ client, productId, outletId }) => {
  const productResult = await client.query(
    `
    SELECT
      p.id,
      p.name,
      p.base_price,
      p.stock_quantity,
      p.track_inventory,
      p.is_active,
      p.section_id,
      p.category_id
    FROM products p
    WHERE p.id = $1
      AND p.deleted_at IS NULL
    FOR UPDATE
    `,
    [productId]
  );
  const product = productResult.rows[0];
  if (!product) {
    throw new ValidationError(`product_id ${productId} not found`);
  }

  const settingResult = await client.query(
    `
    SELECT
      id,
      is_available,
      price_override,
      stock_override
    FROM product_outlet_settings
    WHERE product_id = $1
      AND outlet_id = $2
      AND deleted_at IS NULL
    FOR UPDATE
    `,
    [productId, outletId]
  );
  const setting = settingResult.rows[0] || null;

  const effectivePrice = roundMoney(setting?.price_override ?? product.base_price);
  const effectiveStock = setting?.stock_override ?? product.stock_quantity;
  const isAvailable = setting?.is_available !== undefined ? setting.is_available : true;

  return {
    product_id: Number(product.id),
    product_name: product.name,
    is_active: product.is_active,
    is_available: isAvailable,
    track_inventory: product.track_inventory,
    section_id: product.section_id,
    category_id: product.category_id,
    outlet_setting_id: setting?.id || null,
    effective_price: effectivePrice,
    effective_stock: Number(effectiveStock),
    stock_source: setting?.stock_override !== null && setting?.stock_override !== undefined ? 'outlet' : 'global',
  };
};

const fetchSectionAddonGroups = async ({ client, sectionId }) => {
  if (!sectionId) return [];
  const result = await client.query(
    `
    SELECT addon_groups
    FROM sections
    WHERE id = $1
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [sectionId]
  );
  return result.rows[0]?.addon_groups || [];
};

const applyInventoryDeduction = async ({ client, outletId, resolvedItems }) => {
  for (const item of resolvedItems) {
    if (!item.track_inventory) {
      continue;
    }

    if (item.stock_source === 'outlet' && item.outlet_setting_id) {
      const updateResult = await client.query(
        `
        UPDATE product_outlet_settings
        SET stock_override = stock_override - $1, updated_at = now()
        WHERE id = $2
          AND stock_override IS NOT NULL
          AND stock_override >= $1
        RETURNING id
        `,
        [item.quantity, item.outlet_setting_id]
      );
      if (!updateResult.rows[0]) {
        throw new ValidationError(`insufficient outlet stock for product_id ${item.product_id}`);
      }
      continue;
    }

    const updateResult = await client.query(
      `
      UPDATE products
      SET stock_quantity = stock_quantity - $1, updated_at = now()
      WHERE id = $2
        AND stock_quantity >= $1
      RETURNING id
      `,
      [item.quantity, item.product_id]
    );
    if (!updateResult.rows[0]) {
      throw new ValidationError(`insufficient stock for product_id ${item.product_id}`);
    }
  }
};

const applyInventoryRestock = async ({ client, outletId, resolvedItems }) => {
  for (const item of resolvedItems) {
    if (!item.track_inventory) {
      continue;
    }

    if (item.stock_source === 'outlet' && item.outlet_setting_id) {
      const updateResult = await client.query(
        `
        UPDATE product_outlet_settings
        SET stock_override = stock_override + $1, updated_at = now()
        WHERE id = $2
          AND stock_override IS NOT NULL
        RETURNING id
        `,
        [item.quantity, item.outlet_setting_id]
      );
      if (!updateResult.rows[0]) {
        throw new ValidationError(`failed to restock outlet inventory for product_id ${item.product_id}`);
      }
      continue;
    }

    const updateResult = await client.query(
      `
      UPDATE products
      SET stock_quantity = stock_quantity + $1, updated_at = now()
      WHERE id = $2
      RETURNING id
      `,
      [item.quantity, item.product_id]
    );
    if (!updateResult.rows[0]) {
      throw new ValidationError(`failed to restock inventory for product_id ${item.product_id}`);
    }
  }
};

const resolveCustomerInTx = async ({ client, input }) => {
  const payloadCustomer = input.customer || null;
  const lookupId = payloadCustomer?.id || input.customer_id || null;

  const snapshotName =
    payloadCustomer?.name ||
    input.customer_name_snapshot ||
    null;
  const snapshotPhone =
    payloadCustomer?.phone ||
    input.customer_phone_snapshot ||
    null;
  const snapshotEmail =
    payloadCustomer?.email ||
    input.customer_email_snapshot ||
    null;

  if (lookupId) {
    const existingResult = await client.query(
      `
      SELECT id, full_name, phone_e164, email, customer_type
      FROM customers
      WHERE id = $1
        AND outlet_id = $2
        AND deleted_at IS NULL
      FOR UPDATE
      `,
      [lookupId, input.outlet_id]
    );
    const existing = existingResult.rows[0];
    if (!existing) {
      throw new ValidationError('customer not found for this outlet');
    }

    const mergedName = payloadCustomer?.name || existing.full_name || null;
    const mergedPhone = payloadCustomer?.phone || existing.phone_e164 || null;
    const mergedEmail = payloadCustomer?.email || existing.email || null;
    const mergedType = payloadCustomer?.customer_type || existing.customer_type || 'guest';

    await client.query(
      `
      UPDATE customers
      SET
        full_name = $2,
        phone_e164 = $3,
        email = $4,
        customer_type = $5,
        last_seen_at = now(),
        updated_at = now()
      WHERE id = $1
      `,
      [existing.id, mergedName, mergedPhone, mergedEmail, mergedType]
    );

    return {
      id: Number(existing.id),
      customer_type: mergedType,
      snapshot_name: snapshotName || mergedName || null,
      snapshot_phone: snapshotPhone || mergedPhone || null,
      snapshot_email: snapshotEmail || mergedEmail || null,
    };
  }

  const upsertName = snapshotName;
  const upsertPhone = snapshotPhone;
  const upsertEmail = snapshotEmail;
  const upsertType = payloadCustomer?.customer_type || (upsertPhone || upsertEmail ? 'guest' : 'unidentified');

  if (!upsertName && !upsertPhone && !upsertEmail) {
    return {
      id: null,
      customer_type: upsertType,
      snapshot_name: null,
      snapshot_phone: null,
      snapshot_email: null,
    };
  }

  if (!upsertPhone && !upsertEmail) {
    return {
      id: null,
      customer_type: 'unidentified',
      snapshot_name: upsertName || null,
      snapshot_phone: null,
      snapshot_email: null,
    };
  }

  let existing = null;
  if (upsertPhone || upsertEmail) {
    const existingByContact = await client.query(
      `
      SELECT id, full_name, phone_e164, email, customer_type
      FROM customers
      WHERE outlet_id = $1
        AND deleted_at IS NULL
        AND (
          ($2::text IS NOT NULL AND phone_e164::text = $2::text)
          OR ($3::text IS NOT NULL AND LOWER(email::text) = LOWER($3::text))
        )
      ORDER BY id ASC
      LIMIT 1
      FOR UPDATE
      `,
      [input.outlet_id, upsertPhone, upsertEmail]
    );
    existing = existingByContact.rows[0] || null;
  }

  if (existing) {
    const mergedName = upsertName || existing.full_name || null;
    const mergedPhone = upsertPhone || existing.phone_e164 || null;
    const mergedEmail = upsertEmail || existing.email || null;
    const mergedType = payloadCustomer?.customer_type || existing.customer_type || upsertType;

    await client.query(
      `
      UPDATE customers
      SET
        full_name = $2,
        phone_e164 = $3,
        email = $4,
        customer_type = $5,
        last_seen_at = now(),
        updated_at = now()
      WHERE id = $1
      `,
      [existing.id, mergedName, mergedPhone, mergedEmail, mergedType]
    );

    return {
      id: Number(existing.id),
      customer_type: mergedType,
      snapshot_name: upsertName || mergedName || null,
      snapshot_phone: upsertPhone || mergedPhone || null,
      snapshot_email: upsertEmail || mergedEmail || null,
    };
  }

  const insertResult = await client.query(
    `
    INSERT INTO customers (
      outlet_id,
      full_name,
      phone_e164,
      email,
      customer_type,
      first_seen_at,
      last_seen_at,
      created_at,
      updated_at
    )
    VALUES ($1, $2, $3, $4, $5, now(), now(), now(), now())
    RETURNING id, full_name, phone_e164, email, customer_type
    `,
    [input.outlet_id, upsertName, upsertPhone, upsertEmail, upsertType]
  );
  const created = insertResult.rows[0];

  return {
    id: Number(created.id),
    customer_type: created.customer_type,
    snapshot_name: upsertName || created.full_name || null,
    snapshot_phone: upsertPhone || created.phone_e164 || null,
    snapshot_email: upsertEmail || created.email || null,
  };
};

const createOrder = async (payload = {}, context = {}) => {
  const input = normalizeCreateOrderInput(payload, context);
  const shouldDeductInventory = shouldDeductInventoryForStatus(input.status);
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    const businessSettings = await getBusinessSettings(client);
    const roundingRule = businessSettings.rounding_rule || 'none';
    await assertBranchOrderAllowed({
      branchId: input.outlet_id,
      role: context.role || 'cashier',
      nowUtc: new Date(),
      client,
    });

    const resolvedItems = [];
    const sectionAddonGroupCache = new Map();

    for (let itemIndex = 0; itemIndex < input.items.length; itemIndex += 1) {
      const item = input.items[itemIndex];
      const resolved = await fetchLockedProductWithOutletSettings({
        client,
        productId: item.product_id,
        outletId: input.outlet_id,
      });

      if (!resolved.is_active || !resolved.is_available) {
        throw new ValidationError(`product_id ${item.product_id} not found, inactive, or unavailable`);
      }

      if (resolved.track_inventory && resolved.effective_stock < item.quantity) {
        throw new ValidationError(`insufficient stock for product_id ${item.product_id}`);
      }

      const sectionId = resolved.section_id || null;
      if (!sectionAddonGroupCache.has(sectionId)) {
        const addonGroups = await fetchSectionAddonGroups({
          client,
          sectionId,
        });
        sectionAddonGroupCache.set(sectionId, addonGroups);
      }
      const addonResolution = resolveAddonSelections({
        addonGroups: sectionAddonGroupCache.get(sectionId),
        modifiers: item.modifiers,
        createError: (message) => new ValidationError(`items[${itemIndex}].${message}`),
        fieldPath: 'modifiers.addons',
      });
      const unitPrice = applySettingsRounding(
        Number(resolved.effective_price) + Number(addonResolution.unit_price_delta || 0),
        roundingRule
      );
      const baseModifiers = normalizeObject(item.modifiers);
      const modifiers = {
        ...baseModifiers,
        addons: addonResolution.addons,
        addon_unit_price_delta: addonResolution.unit_price_delta,
      };

      resolvedItems.push({
        ...resolved,
        quantity: item.quantity,
        unit_price: unitPrice,
        total_price: applySettingsRounding(unitPrice * item.quantity, roundingRule),
        modifiers,
      });
    }

    const resolvedCustomer = await resolveCustomerInTx({
      client,
      input,
    });

    const subtotal = applySettingsRounding(
      resolvedItems.reduce((sum, item) => sum + item.total_price, 0),
      roundingRule
    );
    const discounts = await evaluateOrderDiscountsInTx({
      client,
      outletId: input.outlet_id,
      source: input.source,
      customerId: resolvedCustomer.id,
      promoCode: input.promo_code,
      resolvedItems,
      subtotal,
      discountStackingEnabled: businessSettings.discount_stacking_enabled,
      roundingRule,
    });
    const discountedSubtotal = Math.max(
      0,
      applySettingsRounding(subtotal - discounts.discount, roundingRule)
    );
    const manualDiscountAmount = Math.min(input.manual_discount || 0, discountedSubtotal);
    const payableSubtotal = Math.max(
      0,
      applySettingsRounding(discountedSubtotal - manualDiscountAmount, roundingRule)
    );
    const taxAmount = computeTax(payableSubtotal, businessSettings);
    const total = Math.max(0, applySettingsRounding(payableSubtotal + taxAmount, roundingRule));
    const totalDiscount = applySettingsRounding(discounts.discount + manualDiscountAmount, roundingRule);
    if (total < 0) {
      throw new ValidationError('total cannot be negative');
    }

    assertMoneyMatch(subtotal, input.provided_subtotal, 'subtotal');
    assertMoneyMatch(total, input.provided_total, 'total');

    const orderNumber = input.order_number || generateOrderNumber();

    const orderMetadata = {
      ...input.metadata,
      manual_discount_amount: manualDiscountAmount,
      inventory_deducted: shouldDeductInventory,
      inventory_restocked: false,
    };

    const orderInsert = await client.query(
      `
      INSERT INTO orders (
        order_number,
        source,
        order_channel,
        order_type,
        status,
        scheduled_for,
        subtotal,
        tax,
        discount,
        promo_code_id,
        promo_discount_amount,
        bulk_discount_amount,
        total,
        payment_status,
        payment_method,
        customer_id,
        customer_name_snapshot,
        customer_phone_snapshot,
        customer_email_snapshot,
        outlet_id,
        external_order_id,
        external_source,
        metadata,
        created_at,
        updated_at,
        completed_at,
        refunded_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
        $21, $22, $23, now(), now(), $24, $25
      )
      RETURNING
        id,
        legacy_order_id,
        order_number,
        source,
        order_channel,
        status,
        total,
        outlet_id,
        created_at,
        customer_id,
        customer_name_snapshot,
        customer_phone_snapshot,
        customer_email_snapshot,
        promo_code_id,
        promo_discount_amount,
        bulk_discount_amount
      `,
      [
        orderNumber,
        input.source,
        input.order_channel,
        input.order_type,
        input.status,
        input.scheduled_for,
        subtotal,
        taxAmount,
        totalDiscount,
        discounts.promo_code_id,
        discounts.promo_discount_amount,
        discounts.bulk_discount_amount,
        total,
        input.payment_status,
        input.payment_method,
        resolvedCustomer.id,
        resolvedCustomer.snapshot_name,
        resolvedCustomer.snapshot_phone,
        resolvedCustomer.snapshot_email,
        input.outlet_id,
        input.external_order_id,
        input.external_source,
        orderMetadata,
        input.completed_at,
        input.refunded_at,
      ]
    );

    const order = orderInsert.rows[0];

    for (const item of resolvedItems) {
      await client.query(
        `
        INSERT INTO order_items (
          order_id,
          legacy_order_id,
          product_id,
          product_name,
          quantity,
          unit_price,
          total_price,
          modifiers,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
        `,
        [
          order.id,
          order.legacy_order_id,
          item.product_id,
          item.product_name,
          item.quantity,
          item.unit_price,
          item.total_price,
          item.modifiers,
        ]
      );
    }

    if (shouldDeductInventory) {
      await applyInventoryDeduction({
        client,
        outletId: input.outlet_id,
        resolvedItems,
      });
    }

    await recordPromoUsage({
      client,
      promoCodeId: discounts.promo_code_id,
      orderId: order.id,
      userId: resolvedCustomer.id || input.actor_id || 'anonymous',
      outletId: input.outlet_id,
      discountAmount: discounts.promo_discount_amount,
    });

    await client.query(
      `
      INSERT INTO order_status_history (
        order_id,
        from_status,
        to_status,
        changed_by,
        reason,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [order.id, null, input.status, input.actor_id, input.status_reason, {}]
    );

    await client.query('COMMIT');

    return {
      id: order.id,
      legacy_order_id: order.legacy_order_id,
      order_number: order.order_number,
      source: order.source,
      order_channel: order.order_channel,
      status: order.status,
      total: roundMoney(order.total),
      branch_id: Number(order.outlet_id),
      created_at: order.created_at,
      customer_id: order.customer_id ? Number(order.customer_id) : null,
      customer_name_snapshot: order.customer_name_snapshot,
      customer_phone_snapshot: order.customer_phone_snapshot,
      customer_email_snapshot: order.customer_email_snapshot,
      items: resolvedItems.map((item) => ({
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
        modifiers: item.modifiers,
      })),
      subtotal,
      tax: taxAmount,
      discount: totalDiscount,
      manual_discount_amount: manualDiscountAmount,
      promo_discount_amount: discounts.promo_discount_amount,
      bulk_discount_amount: discounts.bulk_discount_amount,
      promo_code_id: discounts.promo_code_id,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err instanceof SettingsValidationError) {
      throw new ValidationError(err.message, err.statusCode);
    }
    throw err;
  } finally {
    client.release();
  }
};

const normalizeStatusUpdateInput = (payload = {}, context = {}) => {
  const paymentStatus = payload.payment_status ?? payload.paymentStatus;
  if (paymentStatus !== undefined && !ALLOWED_PAYMENT_STATUSES.has(paymentStatus)) {
    throw new ValidationError('payment_status must be unpaid, paid, or partially_paid');
  }

  return {
    status: payload.status ? String(payload.status).trim().toLowerCase() : null,
    order_channel: payload.order_channel ?? payload.orderChannel ?? null,
    payment_status: paymentStatus,
    reason: typeof payload.reason === 'string' ? payload.reason : null,
    metadata: normalizeObject(payload.metadata),
    actor_id: context.actorId ? String(context.actorId) : null,
    outlet_id: toPositiveInt(context.branchId ?? context.outletId, 'branch_id', { required: true }),
    role: context.role || 'cashier',
  };
};

const updateOrderStatus = async (orderId, payload = {}, context = {}) => {
  if (!isUuid(orderId)) {
    throw new ValidationError('order_id must be a valid UUID');
  }

  const input = normalizeStatusUpdateInput(payload, context);
  if (!input.status) {
    throw new ValidationError('status is required');
  }
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      `
      SELECT id, status, source, order_channel, outlet_id, completed_at, refunded_at, metadata
      FROM orders
      WHERE id = $1
        AND outlet_id = $2
        AND deleted_at IS NULL
      FOR UPDATE
      `,
      [orderId, input.outlet_id]
    );

    const current = currentResult.rows[0];
    if (!current) {
      throw new ValidationError('order not found', 404);
    }

    const currentChannel =
      normalizeOrderChannel(input.order_channel) ||
      normalizeOrderChannel(current.order_channel) ||
      CHANNEL_BY_SOURCE[normalizeSource(current.source) || 'pos'] ||
      'pos';

    const currentStatus = normalizeCanonicalStatus(
      current.status || getDefaultStatusForChannel(currentChannel),
      currentChannel
    );
    const nextStatus = normalizeCanonicalStatus(input.status, currentChannel);
    const alreadyInventoryDeducted = Boolean(current.metadata && current.metadata.inventory_deducted);

    if (nextStatus === 'refunded' && input.role === 'cashier') {
      throw new ValidationError('Only manager/admin can refund orders', 403);
    }

    if (!canTransition(currentStatus, nextStatus, currentChannel)) {
      throw new ValidationError(
        `invalid status transition from ${currentStatus} to ${nextStatus} for channel ${currentChannel}`,
        409
      );
    }

    if (current.status === nextStatus) {
      await client.query('COMMIT');
      return {
        id: current.id,
        status: nextStatus,
        order_channel: currentChannel,
        completed_at: current.completed_at,
        refunded_at: current.refunded_at,
      };
    }

    const shouldDeductInventory =
      shouldDeductInventoryForStatus(nextStatus) && !alreadyInventoryDeducted;
    const shouldRestockInventory =
      shouldRestockInventoryForStatus(nextStatus) && alreadyInventoryDeducted;

    if (shouldDeductInventory) {
      const itemResult = await client.query(
        `
        SELECT
          oi.product_id,
          oi.quantity
        FROM order_items oi
        WHERE oi.order_id = $1
        `,
        [orderId]
      );

      const resolvedItems = [];
      for (const row of itemResult.rows) {
        const resolved = await fetchLockedProductWithOutletSettings({
          client,
          productId: Number(row.product_id),
          outletId: input.outlet_id,
        });
        if (!resolved.is_active || !resolved.is_available) {
          throw new ValidationError(`product_id ${row.product_id} inactive or unavailable`);
        }
        const quantity = Number(row.quantity);
        if (resolved.track_inventory && resolved.effective_stock < quantity) {
          throw new ValidationError(`insufficient stock for product_id ${row.product_id}`);
        }
        resolvedItems.push({
          ...resolved,
          quantity,
        });
      }

      await applyInventoryDeduction({
        client,
        outletId: input.outlet_id,
        resolvedItems,
      });
    }

    if (shouldRestockInventory) {
      const itemResult = await client.query(
        `
        SELECT
          oi.product_id,
          oi.quantity
        FROM order_items oi
        WHERE oi.order_id = $1
        `,
        [orderId]
      );

      const resolvedItems = [];
      for (const row of itemResult.rows) {
        const resolved = await fetchLockedProductWithOutletSettings({
          client,
          productId: Number(row.product_id),
          outletId: input.outlet_id,
        });
        const quantity = Number(row.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) continue;
        resolvedItems.push({
          ...resolved,
          quantity,
        });
      }

      await applyInventoryRestock({
        client,
        outletId: input.outlet_id,
        resolvedItems,
      });
    }

    const nextPaymentStatus = input.payment_status ?? (nextStatus === 'completed' ? 'paid' : undefined);
    const markCompleted = nextStatus === 'completed';
    const markRefunded = nextStatus === 'refunded';
    const markInventoryDeducted = shouldDeductInventory;
    const markInventoryRestocked = shouldRestockInventory;

    const updateResult = await client.query(
      `
      UPDATE orders
      SET
        status = $2,
        order_channel = $3,
        source = COALESCE(source, $4),
        payment_status = COALESCE($5, payment_status),
        completed_at = CASE
          WHEN $6 AND completed_at IS NULL THEN now()
          ELSE completed_at
        END,
        refunded_at = CASE
          WHEN $7 THEN COALESCE(refunded_at, now())
          ELSE refunded_at
        END,
        metadata = CASE
          WHEN $9 THEN COALESCE(metadata, '{}'::jsonb) || '{"inventory_deducted": false, "inventory_restocked": true}'::jsonb
          WHEN $8 THEN COALESCE(metadata, '{}'::jsonb) || '{"inventory_deducted": true, "inventory_restocked": false}'::jsonb
          ELSE metadata
        END,
        updated_at = now()
      WHERE id = $1
      RETURNING id, status, order_channel, payment_status, completed_at, refunded_at, updated_at
      `,
      [
        orderId,
        nextStatus,
        currentChannel,
        DEFAULT_SOURCE_BY_CHANNEL[currentChannel] || 'pos',
        nextPaymentStatus,
        markCompleted,
        markRefunded,
        markInventoryDeducted,
        markInventoryRestocked,
      ]
    );

    await client.query(
      `
      INSERT INTO order_status_history (
        order_id,
        from_status,
        to_status,
        changed_by,
        reason,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [orderId, currentStatus, nextStatus, input.actor_id, input.reason, input.metadata]
    );

    await client.query('COMMIT');
    return updateResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  ALLOWED_SOURCES,
  ALLOWED_ORDER_CHANNELS,
  ALLOWED_ORDER_TYPES,
  ALLOWED_STATUSES,
  ALLOWED_PAYMENT_STATUSES,
  ALLOWED_PAYMENT_METHODS,
  ValidationError,
  createOrder,
  updateOrderStatus,
};
