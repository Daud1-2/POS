const db = require('./db');

const ALLOWED_SOURCES = new Set(['pos', 'website', 'phone', 'kiosk']);
const ALLOWED_ORDER_TYPES = new Set(['dine_in', 'takeaway', 'delivery']);
const ALLOWED_STATUSES = new Set([
  'open',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
  'refunded',
]);
const ALLOWED_PAYMENT_STATUSES = new Set(['unpaid', 'paid', 'partially_paid']);
const ALLOWED_PAYMENT_METHODS = new Set(['cash', 'card', 'online']);

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
  const source = payload.source || 'pos';
  if (!ALLOWED_SOURCES.has(source)) {
    throw new ValidationError('source must be pos, website, phone, or kiosk');
  }

  const orderType = payload.order_type || payload.orderType || 'takeaway';
  if (!ALLOWED_ORDER_TYPES.has(orderType)) {
    throw new ValidationError('order_type must be dine_in, takeaway, or delivery');
  }

  const status = payload.status || 'open';
  if (!ALLOWED_STATUSES.has(status)) {
    throw new ValidationError(
      'status must be open, preparing, ready, out_for_delivery, completed, cancelled, or refunded'
    );
  }

  let paymentMethod = payload.payment_method || payload.paymentMethod || 'cash';
  if (paymentMethod === 'credit') paymentMethod = 'card';
  if (!ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
    throw new ValidationError('payment_method must be cash, card, or online');
  }

  const paymentStatus =
    payload.payment_status ||
    payload.paymentStatus ||
    (status === 'completed' ? 'paid' : 'unpaid');
  if (!ALLOWED_PAYMENT_STATUSES.has(paymentStatus)) {
    throw new ValidationError('payment_status must be unpaid, paid, or partially_paid');
  }

  const discount = toMoney(payload.discount, 'discount') ?? 0;
  const tax = toMoney(payload.tax, 'tax') ?? 0;
  const providedSubtotal = toMoney(payload.subtotal, 'subtotal');
  const providedTotal = toMoney(payload.total, 'total');
  const scheduledFor = toIsoTimestamp(payload.scheduled_for || payload.scheduledFor, 'scheduled_for');
  const completedAt = toIsoTimestamp(payload.completed_at || payload.completedAt, 'completed_at');
  const customerId = toPositiveInt(payload.customer_id || payload.customerId, 'customer_id');
  const outletId = toPositiveInt(
    context.outletId ?? payload.outlet_id ?? payload.outletId ?? payload.branchId ?? 1,
    'outlet_id',
    { required: true }
  );

  return {
    source,
    order_type: orderType,
    status,
    payment_method: paymentMethod,
    payment_status: paymentStatus,
    discount,
    tax,
    provided_subtotal: providedSubtotal,
    provided_total: providedTotal,
    scheduled_for: scheduledFor,
    completed_at: status === 'completed' ? completedAt || new Date().toISOString() : null,
    customer_id: customerId,
    outlet_id: outletId,
    external_order_id: payload.external_order_id || payload.externalOrderId || null,
    external_source: payload.external_source || payload.externalSource || null,
    metadata: normalizeObject(payload.metadata),
    order_number: typeof payload.order_number === 'string' ? payload.order_number.trim() : '',
    items: normalizeItems(payload.items),
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
      p.is_active
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
    outlet_setting_id: setting?.id || null,
    effective_price: effectivePrice,
    effective_stock: Number(effectiveStock),
    stock_source: setting?.stock_override !== null && setting?.stock_override !== undefined ? 'outlet' : 'global',
  };
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

const createOrder = async (payload = {}, context = {}) => {
  const input = normalizeCreateOrderInput(payload, context);
  const shouldDeductInventory = input.status === 'completed';
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const resolvedItems = [];

    for (const item of input.items) {
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

      resolvedItems.push({
        ...resolved,
        quantity: item.quantity,
        unit_price: resolved.effective_price,
        total_price: roundMoney(resolved.effective_price * item.quantity),
        modifiers: item.modifiers,
      });
    }

    const subtotal = roundMoney(resolvedItems.reduce((sum, item) => sum + item.total_price, 0));
    const total = roundMoney(subtotal + input.tax - input.discount);
    if (total < 0) {
      throw new ValidationError('total cannot be negative');
    }

    assertMoneyMatch(subtotal, input.provided_subtotal, 'subtotal');
    assertMoneyMatch(total, input.provided_total, 'total');

    const orderNumber = input.order_number || generateOrderNumber();

    const orderInsert = await client.query(
      `
      INSERT INTO orders (
        order_number,
        source,
        order_type,
        status,
        scheduled_for,
        subtotal,
        tax,
        discount,
        total,
        payment_status,
        payment_method,
        customer_id,
        outlet_id,
        external_order_id,
        external_source,
        metadata,
        created_at,
        updated_at,
        completed_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15, $16, now(), now(), $17
      )
      RETURNING id, legacy_order_id, order_number, status, total, outlet_id, created_at
      `,
      [
        orderNumber,
        input.source,
        input.order_type,
        input.status,
        input.scheduled_for,
        subtotal,
        input.tax,
        input.discount,
        total,
        input.payment_status,
        input.payment_method,
        input.customer_id,
        input.outlet_id,
        input.external_order_id,
        input.external_source,
        input.metadata,
        input.completed_at,
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
      status: order.status,
      total: roundMoney(order.total),
      outlet_id: Number(order.outlet_id),
      created_at: order.created_at,
      items: resolvedItems.map((item) => ({
        product_id: item.product_id,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: item.total_price,
      })),
      subtotal,
      tax: input.tax,
      discount: input.discount,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const normalizeStatusUpdateInput = (payload = {}, context = {}) => {
  const status = payload.status;
  if (!ALLOWED_STATUSES.has(status)) {
    throw new ValidationError(
      'status must be open, preparing, ready, out_for_delivery, completed, cancelled, or refunded'
    );
  }

  const paymentStatus = payload.payment_status ?? payload.paymentStatus;
  if (paymentStatus !== undefined && !ALLOWED_PAYMENT_STATUSES.has(paymentStatus)) {
    throw new ValidationError('payment_status must be unpaid, paid, or partially_paid');
  }

  return {
    status,
    payment_status: paymentStatus,
    reason: typeof payload.reason === 'string' ? payload.reason : null,
    metadata: normalizeObject(payload.metadata),
    actor_id: context.actorId ? String(context.actorId) : null,
    outlet_id: toPositiveInt(context.outletId, 'outlet_id', { required: true }),
  };
};

const updateOrderStatus = async (orderId, payload = {}, context = {}) => {
  if (!isUuid(orderId)) {
    throw new ValidationError('order_id must be a valid UUID');
  }

  const input = normalizeStatusUpdateInput(payload, context);
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const currentResult = await client.query(
      `
      SELECT id, status, outlet_id, completed_at
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

    if (current.status === 'completed' && input.status !== 'completed') {
      throw new ValidationError('completed orders cannot transition to another status');
    }

    if (current.status === input.status) {
      await client.query('COMMIT');
      return {
        id: current.id,
        status: current.status,
        completed_at: current.completed_at,
      };
    }

    const enteringCompleted = current.status !== 'completed' && input.status === 'completed';

    if (enteringCompleted) {
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

    const updateResult = await client.query(
      `
      UPDATE orders
      SET
        status = $2,
        payment_status = COALESCE($3, payment_status),
        updated_at = now(),
        completed_at = CASE
          WHEN $2 = 'completed' AND completed_at IS NULL THEN now()
          ELSE completed_at
        END
      WHERE id = $1
      RETURNING id, status, payment_status, completed_at, updated_at
      `,
      [orderId, input.status, input.payment_status]
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
      [orderId, current.status, input.status, input.actor_id, input.reason, input.metadata]
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
  ALLOWED_ORDER_TYPES,
  ALLOWED_STATUSES,
  ALLOWED_PAYMENT_STATUSES,
  ALLOWED_PAYMENT_METHODS,
  ValidationError,
  createOrder,
  updateOrderStatus,
};
