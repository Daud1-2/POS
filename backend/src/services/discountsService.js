const db = require('./db');
const { applyRounding } = require('./moneyRounding');
const { resolveAddonSelections } = require('./addonPricing');

const PROMO_APPLICABLE = new Set(['app', 'web', 'both']);
const DISCOUNT_TYPES = new Set(['percentage', 'fixed']);
const PROMO_STATUSES = new Set(['active', 'inactive']);
const BULK_STATUSES = new Set(['active', 'inactive']);
const BULK_APPLIES_TO = new Set(['category', 'product', 'section', 'branch']);
const ORDER_SOURCES = new Set(['pos', 'website', 'phone', 'kiosk']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class DiscountValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'DiscountValidationError';
    this.statusCode = statusCode;
  }
}

const roundMoney = (value) => Number(Number(value).toFixed(2));

const toPositiveInt = (value, fieldName, { required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new DiscountValidationError(`${fieldName} is required`);
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new DiscountValidationError(`${fieldName} must be a positive integer`);
  }
  return parsed;
};

const toNonNegativeInt = (value, fieldName, { required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new DiscountValidationError(`${fieldName} is required`);
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new DiscountValidationError(`${fieldName} must be a non-negative integer`);
  }
  return parsed;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
};

const toMoney = (value, fieldName, { required = false, min = 0 } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new DiscountValidationError(`${fieldName} is required`);
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new DiscountValidationError(`${fieldName} must be a valid number`);
  }
  if (parsed < min) {
    throw new DiscountValidationError(`${fieldName} must be >= ${min}`);
  }
  return roundMoney(parsed);
};

const toDate = (value, fieldName, { required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) throw new DiscountValidationError(`${fieldName} is required`);
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DiscountValidationError(`${fieldName} must be a valid timestamp`);
  }
  return parsed;
};

const normalizeText = (value, fieldName, { required = false, max = 255, forceUpper = false } = {}) => {
  if (value === undefined || value === null) {
    if (required) throw new DiscountValidationError(`${fieldName} is required`);
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    if (required) throw new DiscountValidationError(`${fieldName} is required`);
    return null;
  }
  if (text.length > max) {
    throw new DiscountValidationError(`${fieldName} must be <= ${max} characters`);
  }
  return forceUpper ? text.toUpperCase() : text;
};

const normalizeObject = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value;
};

const normalizeSource = (value) => {
  if (!value) return 'pos';
  const source = String(value).trim().toLowerCase();
  if (source === 'app') return 'kiosk';
  if (!ORDER_SOURCES.has(source)) {
    throw new DiscountValidationError('source must be pos, website, phone, or kiosk');
  }
  return source;
};

const isUuid = (value) => typeof value === 'string' && UUID_RE.test(value);

const sourcePromoChannel = (source) => (source === 'website' ? 'web' : 'app');

const assertTimeWindow = (startTime, endTime) => {
  if (startTime && endTime && startTime >= endTime) {
    throw new DiscountValidationError('end_time must be later than start_time');
  }
};

const parsePagination = (query = {}) => {
  const page = toPositiveInt(query.page, 'page') || 1;
  const pageSizeRaw = toPositiveInt(query.page_size ?? query.pageSize, 'page_size') || 25;
  const pageSize = Math.min(pageSizeRaw, 100);
  return {
    page,
    page_size: pageSize,
    offset: (page - 1) * pageSize,
  };
};

const buildPagedResponse = ({ rows, total, pagination }) => ({
  data: rows,
  meta: {
    page: pagination.page,
    page_size: pagination.page_size,
    total,
    total_pages: total === 0 ? 0 : Math.ceil(total / pagination.page_size),
  },
});

const runQuery = (client, sql, params = []) => {
  if (client && typeof client.query === 'function') {
    return client.query(sql, params);
  }
  return db.query(sql, params);
};

const mapPromoEffectiveStatus = (promo, now = new Date()) => {
  const start = promo.start_time ? new Date(promo.start_time) : null;
  const end = promo.end_time ? new Date(promo.end_time) : null;
  const usageLimit = promo.usage_limit === null || promo.usage_limit === undefined ? null : Number(promo.usage_limit);
  const usedCount = Number(promo.used_count || 0);

  if (promo.status !== 'active') return 'inactive';
  if (start && now < start) return 'inactive';
  if (end && now > end) return 'expired';
  if (usageLimit !== null && usedCount >= usageLimit) return 'expired';
  return 'active';
};

const mapBulkEffectiveStatus = (rule, now = new Date()) => {
  const start = rule.start_time ? new Date(rule.start_time) : null;
  const end = rule.end_time ? new Date(rule.end_time) : null;

  if (rule.status !== 'active') return 'inactive';
  if (start && now < start) return 'inactive';
  if (end && now > end) return 'expired';
  return 'active';
};

const normalizePromoPayload = (payload = {}, { partial = false } = {}) => {
  const normalized = {};

  if (!partial || payload.code !== undefined) {
    normalized.code = normalizeText(payload.code, 'code', { required: !partial, max: 120, forceUpper: true });
  }
  if (!partial || payload.name !== undefined) {
    normalized.name = normalizeText(payload.name, 'name', { required: !partial, max: 255 });
  }
  if (!partial || payload.applicable_on !== undefined) {
    const applicableOnRaw = normalizeText(payload.applicable_on, 'applicable_on', { required: !partial, max: 10 });
    const applicableOn = applicableOnRaw ? applicableOnRaw.toLowerCase() : null;
    if (applicableOn && !PROMO_APPLICABLE.has(applicableOn)) {
      throw new DiscountValidationError('applicable_on must be app, web, or both');
    }
    normalized.applicable_on = applicableOn;
  }
  if (!partial || payload.discount_type !== undefined) {
    const typeRaw = normalizeText(payload.discount_type, 'discount_type', { required: !partial, max: 20 });
    const type = typeRaw ? typeRaw.toLowerCase() : null;
    if (type && !DISCOUNT_TYPES.has(type)) {
      throw new DiscountValidationError('discount_type must be percentage or fixed');
    }
    normalized.discount_type = type;
  }
  if (!partial || payload.discount_value !== undefined) {
    normalized.discount_value = toMoney(payload.discount_value, 'discount_value', { required: !partial, min: 0.01 });
  }
  if (payload.min_order_amount !== undefined || !partial) {
    normalized.min_order_amount = toMoney(payload.min_order_amount, 'min_order_amount', { required: false, min: 0 });
  }
  if (payload.max_discount_amount !== undefined || !partial) {
    normalized.max_discount_amount = toMoney(payload.max_discount_amount, 'max_discount_amount', { required: false, min: 0 });
  }
  if (payload.usage_limit !== undefined || !partial) {
    normalized.usage_limit = toPositiveInt(payload.usage_limit, 'usage_limit');
  }
  if (payload.per_user_limit !== undefined || !partial) {
    normalized.per_user_limit = toPositiveInt(payload.per_user_limit, 'per_user_limit');
  }
  if (!partial || payload.start_time !== undefined) {
    normalized.start_time = toDate(payload.start_time, 'start_time', { required: !partial });
  }
  if (!partial || payload.end_time !== undefined) {
    normalized.end_time = toDate(payload.end_time, 'end_time', { required: !partial });
  }
  if (!partial || payload.status !== undefined) {
    const statusRaw = normalizeText(payload.status, 'status', { required: !partial, max: 10 });
    const status = statusRaw ? statusRaw.toLowerCase() : null;
    if (status && !PROMO_STATUSES.has(status)) {
      throw new DiscountValidationError('status must be active or inactive');
    }
    normalized.status = status;
  }
  if (payload.used_count !== undefined) {
    normalized.used_count = toNonNegativeInt(payload.used_count, 'used_count', { required: false });
  }

  const discountType = normalized.discount_type;
  if (discountType === 'percentage' && normalized.discount_value !== null && normalized.discount_value > 100) {
    throw new DiscountValidationError('percentage promo discount_value must be <= 100');
  }

  if (normalized.start_time && normalized.end_time) {
    assertTimeWindow(normalized.start_time, normalized.end_time);
  }

  return normalized;
};

const normalizeBulkPayload = (payload = {}, { partial = false } = {}) => {
  const normalized = {};

  if (!partial || payload.name !== undefined) {
    normalized.name = normalizeText(payload.name, 'name', { required: !partial, max: 255 });
  }
  if (payload.description !== undefined || !partial) {
    normalized.description = normalizeText(payload.description, 'description', { required: false, max: 2000 });
  }
  if (!partial || payload.discount_type !== undefined) {
    const typeRaw = normalizeText(payload.discount_type, 'discount_type', { required: !partial, max: 20 });
    const type = typeRaw ? typeRaw.toLowerCase() : null;
    if (type && !DISCOUNT_TYPES.has(type)) {
      throw new DiscountValidationError('discount_type must be percentage or fixed');
    }
    normalized.discount_type = type;
  }
  if (!partial || payload.discount_value !== undefined) {
    normalized.discount_value = toMoney(payload.discount_value, 'discount_value', { required: !partial, min: 0.01 });
  }
  if (!partial || payload.applies_to !== undefined) {
    const appliesToRaw = normalizeText(payload.applies_to, 'applies_to', { required: !partial, max: 20 });
    const appliesTo = appliesToRaw ? appliesToRaw.toLowerCase() : null;
    if (appliesTo && !BULK_APPLIES_TO.has(appliesTo)) {
      throw new DiscountValidationError('applies_to must be category, product, section, or branch');
    }
    normalized.applies_to = appliesTo;
  }
  if (payload.category_id !== undefined || !partial) {
    normalized.category_id = toPositiveInt(payload.category_id, 'category_id');
  }
  if (payload.product_id !== undefined || !partial) {
    normalized.product_id = toPositiveInt(payload.product_id, 'product_id');
  }
  if (payload.section_id !== undefined || !partial) {
    normalized.section_id = payload.section_id ? String(payload.section_id).trim() : null;
    if (normalized.section_id && !isUuid(normalized.section_id)) {
      throw new DiscountValidationError('section_id must be a valid UUID');
    }
  }
  if (payload.branch_id !== undefined || !partial) {
    normalized.branch_id = toPositiveInt(payload.branch_id, 'branch_id');
  }
  if (payload.min_quantity !== undefined || !partial) {
    normalized.min_quantity = toPositiveInt(payload.min_quantity, 'min_quantity');
  }
  if (payload.priority !== undefined || !partial) {
    normalized.priority = payload.priority === undefined || payload.priority === null || payload.priority === '' ? 1 : Number(payload.priority);
    if (!Number.isInteger(normalized.priority)) {
      throw new DiscountValidationError('priority must be an integer');
    }
  }
  if (!partial || payload.start_time !== undefined) {
    normalized.start_time = toDate(payload.start_time, 'start_time', { required: !partial });
  }
  if (!partial || payload.end_time !== undefined) {
    normalized.end_time = toDate(payload.end_time, 'end_time', { required: !partial });
  }
  if (!partial || payload.status !== undefined) {
    const statusRaw = normalizeText(payload.status, 'status', { required: !partial, max: 10 });
    const status = statusRaw ? statusRaw.toLowerCase() : null;
    if (status && !BULK_STATUSES.has(status)) {
      throw new DiscountValidationError('status must be active or inactive');
    }
    normalized.status = status;
  }

  if (normalized.discount_type === 'percentage' && normalized.discount_value !== null && normalized.discount_value > 100) {
    throw new DiscountValidationError('percentage bulk discount_value must be <= 100');
  }

  if (normalized.start_time && normalized.end_time) {
    assertTimeWindow(normalized.start_time, normalized.end_time);
  }

  const appliesTo = normalized.applies_to;
  if (appliesTo === 'category') {
    if (!normalized.category_id) throw new DiscountValidationError('category_id is required for applies_to=category');
    normalized.product_id = null;
    normalized.section_id = null;
  } else if (appliesTo === 'product') {
    if (!normalized.product_id) throw new DiscountValidationError('product_id is required for applies_to=product');
    normalized.category_id = null;
    normalized.section_id = null;
  } else if (appliesTo === 'section') {
    if (!normalized.section_id) throw new DiscountValidationError('section_id is required for applies_to=section');
    normalized.category_id = null;
    normalized.product_id = null;
  } else if (appliesTo === 'branch') {
    normalized.category_id = null;
    normalized.product_id = null;
    normalized.section_id = null;
  }

  return normalized;
};

const applyPromoFilters = ({ filters, params, query }) => {
  const search = query.search ? String(query.search).trim().toLowerCase() : '';
  if (search) {
    params.push(`%${search}%`);
    filters.push(`(LOWER(pc.code) LIKE $${params.length} OR LOWER(pc.name) LIKE $${params.length})`);
  }

  const status = query.status ? String(query.status).trim().toLowerCase() : null;
  const activeNow = toBool(query.active_now, false);
  const expiredOnly = toBool(query.expired, false);
  const upcomingOnly = toBool(query.upcoming, false);

  if (activeNow || status === 'active') {
    filters.push(
      `pc.status = 'active'
       AND pc.start_time <= now()
       AND pc.end_time >= now()
       AND (pc.usage_limit IS NULL OR pc.used_count < pc.usage_limit)`
    );
  }

  if (upcomingOnly) {
    filters.push('pc.start_time > now()');
  }

  if (expiredOnly || status === 'expired') {
    filters.push('(pc.end_time < now() OR (pc.usage_limit IS NOT NULL AND pc.used_count >= pc.usage_limit))');
  }

  if (status === 'inactive') {
    filters.push(
      `(pc.status <> 'active' OR pc.start_time > now())
       AND pc.end_time >= now()
       AND (pc.usage_limit IS NULL OR pc.used_count < pc.usage_limit)`
    );
  }
};

const applyBulkFilters = ({ filters, params, query }) => {
  const search = query.search ? String(query.search).trim().toLowerCase() : '';
  if (search) {
    params.push(`%${search}%`);
    filters.push(`LOWER(bd.name) LIKE $${params.length}`);
  }

  const status = query.status ? String(query.status).trim().toLowerCase() : null;
  const activeNow = toBool(query.active_now, false);
  const expiredOnly = toBool(query.expired, false);
  const upcomingOnly = toBool(query.upcoming, false);

  if (activeNow || status === 'active') {
    filters.push(`bd.status = 'active' AND bd.start_time <= now() AND bd.end_time >= now()`);
  }

  if (upcomingOnly) {
    filters.push('bd.start_time > now()');
  }

  if (expiredOnly || status === 'expired') {
    filters.push('bd.end_time < now()');
  }

  if (status === 'inactive') {
    filters.push('(bd.status <> \'active\' OR bd.start_time > now()) AND bd.end_time >= now()');
  }
};

const listPromoCodes = async ({ outletId, query = {}, pagination }) => {
  const filters = ['pc.outlet_id = $1', 'pc.deleted_at IS NULL'];
  const params = [outletId];
  applyPromoFilters({ filters, params, query });
  const whereClause = filters.join(' AND ');

  const countResult = await db.query(
    `
    SELECT COUNT(*) AS count
    FROM promo_codes pc
    WHERE ${whereClause}
    `,
    params
  );

  const total = Number(countResult.rows[0]?.count || 0);
  const rowsResult = await db.query(
    `
    SELECT
      pc.id,
      pc.uuid,
      pc.code,
      pc.name,
      pc.applicable_on,
      pc.discount_type,
      pc.discount_value,
      pc.min_order_amount,
      pc.max_discount_amount,
      pc.usage_limit,
      pc.used_count,
      pc.per_user_limit,
      pc.start_time,
      pc.end_time,
      pc.status,
      pc.outlet_id,
      pc.created_at,
      pc.updated_at,
      CASE
        WHEN pc.status <> 'active' OR pc.start_time > now() THEN 'inactive'
        WHEN pc.end_time < now() THEN 'expired'
        WHEN pc.usage_limit IS NOT NULL AND pc.used_count >= pc.usage_limit THEN 'expired'
        ELSE 'active'
      END AS effective_status
    FROM promo_codes pc
    WHERE ${whereClause}
    ORDER BY pc.created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, pagination.page_size, pagination.offset]
  );

  return buildPagedResponse({ rows: rowsResult.rows, total, pagination });
};

const createPromoCode = async ({ outletId, payload }) => {
  const input = normalizePromoPayload(payload, { partial: false });
  assertTimeWindow(input.start_time, input.end_time);

  const result = await db.query(
    `
    INSERT INTO promo_codes (
      outlet_id,
      code,
      name,
      applicable_on,
      discount_type,
      discount_value,
      min_order_amount,
      max_discount_amount,
      usage_limit,
      used_count,
      per_user_limit,
      start_time,
      end_time,
      status,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, COALESCE($10, 0), $11, $12, $13, $14, now(), now()
    )
    RETURNING *
    `,
    [
      outletId,
      input.code,
      input.name,
      input.applicable_on,
      input.discount_type,
      input.discount_value,
      input.min_order_amount,
      input.max_discount_amount,
      input.usage_limit,
      input.used_count,
      input.per_user_limit,
      input.start_time,
      input.end_time,
      input.status || 'active',
    ]
  );

  const promo = result.rows[0];
  promo.effective_status = mapPromoEffectiveStatus(promo);
  return promo;
};

const getPromoByUuid = async ({ outletId, promoUuid, client = null, forUpdate = false }) => {
  if (!isUuid(promoUuid)) {
    throw new DiscountValidationError('promo code uuid must be a valid UUID');
  }
  const sql = `
    SELECT *
    FROM promo_codes
    WHERE uuid = $1
      AND outlet_id = $2
      AND deleted_at IS NULL
    ${forUpdate ? 'FOR UPDATE' : ''}
  `;
  const result = await runQuery(client, sql, [promoUuid, outletId]);
  const promo = result.rows[0];
  if (!promo) throw new DiscountValidationError('promo code not found', 404);
  return promo;
};

const updatePromoCode = async ({ outletId, promoUuid, payload }) => {
  const current = await getPromoByUuid({ outletId, promoUuid });
  const input = normalizePromoPayload(payload, { partial: true });
  const nextStart = input.start_time || current.start_time;
  const nextEnd = input.end_time || current.end_time;
  assertTimeWindow(nextStart, nextEnd);

  const nextDiscountType = input.discount_type || current.discount_type;
  const nextDiscountValue =
    input.discount_value !== null && input.discount_value !== undefined
      ? input.discount_value
      : Number(current.discount_value);
  if (nextDiscountType === 'percentage' && nextDiscountValue > 100) {
    throw new DiscountValidationError('percentage promo discount_value must be <= 100');
  }

  const result = await db.query(
    `
    UPDATE promo_codes
    SET
      code = COALESCE($3, code),
      name = COALESCE($4, name),
      applicable_on = COALESCE($5, applicable_on),
      discount_type = COALESCE($6, discount_type),
      discount_value = COALESCE($7, discount_value),
      min_order_amount = COALESCE($8, min_order_amount),
      max_discount_amount = COALESCE($9, max_discount_amount),
      usage_limit = $10,
      used_count = COALESCE($11, used_count),
      per_user_limit = $12,
      start_time = COALESCE($13, start_time),
      end_time = COALESCE($14, end_time),
      status = COALESCE($15, status),
      updated_at = now()
    WHERE uuid = $1
      AND outlet_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [
      promoUuid,
      outletId,
      input.code,
      input.name,
      input.applicable_on,
      input.discount_type,
      input.discount_value,
      input.min_order_amount,
      input.max_discount_amount,
      input.usage_limit !== undefined ? input.usage_limit : current.usage_limit,
      input.used_count,
      input.per_user_limit !== undefined ? input.per_user_limit : current.per_user_limit,
      input.start_time,
      input.end_time,
      input.status,
    ]
  );

  const updated = result.rows[0];
  if (!updated) throw new DiscountValidationError('promo code not found', 404);
  updated.effective_status = mapPromoEffectiveStatus(updated);
  return updated;
};

const togglePromoCode = async ({ outletId, promoUuid }) => {
  const current = await getPromoByUuid({ outletId, promoUuid });
  const nextStatus = current.status === 'active' ? 'inactive' : 'active';
  const result = await db.query(
    `
    UPDATE promo_codes
    SET status = $3, updated_at = now()
    WHERE uuid = $1
      AND outlet_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [promoUuid, outletId, nextStatus]
  );
  const updated = result.rows[0];
  updated.effective_status = mapPromoEffectiveStatus(updated);
  return updated;
};

const softDeletePromoCode = async ({ outletId, promoUuid }) => {
  const result = await db.query(
    `
    UPDATE promo_codes
    SET deleted_at = now(), status = 'inactive', updated_at = now()
    WHERE uuid = $1
      AND outlet_id = $2
      AND deleted_at IS NULL
    RETURNING id
    `,
    [promoUuid, outletId]
  );
  if (!result.rows[0]) throw new DiscountValidationError('promo code not found', 404);
  return true;
};

const listBulkDiscounts = async ({ outletId, query = {}, pagination }) => {
  const filters = ['bd.outlet_id = $1', 'bd.deleted_at IS NULL'];
  const params = [outletId];
  applyBulkFilters({ filters, params, query });
  const whereClause = filters.join(' AND ');

  const countResult = await db.query(
    `
    SELECT COUNT(*) AS count
    FROM bulk_discounts bd
    WHERE ${whereClause}
    `,
    params
  );
  const total = Number(countResult.rows[0]?.count || 0);

  const rowsResult = await db.query(
    `
    SELECT
      bd.*,
      CASE
        WHEN bd.status <> 'active' OR bd.start_time > now() THEN 'inactive'
        WHEN bd.end_time < now() THEN 'expired'
        ELSE 'active'
      END AS effective_status
    FROM bulk_discounts bd
    WHERE ${whereClause}
    ORDER BY bd.priority DESC, bd.created_at ASC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    [...params, pagination.page_size, pagination.offset]
  );

  return buildPagedResponse({ rows: rowsResult.rows, total, pagination });
};

const createBulkDiscount = async ({ outletId, payload }) => {
  const input = normalizeBulkPayload(payload, { partial: false });
  assertTimeWindow(input.start_time, input.end_time);

  const result = await db.query(
    `
    INSERT INTO bulk_discounts (
      outlet_id,
      name,
      description,
      discount_type,
      discount_value,
      applies_to,
      category_id,
      product_id,
      section_id,
      branch_id,
      min_quantity,
      start_time,
      end_time,
      priority,
      status,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8,
      $9, $10, $11, $12, $13, $14, $15, now(), now()
    )
    RETURNING *
    `,
    [
      outletId,
      input.name,
      input.description,
      input.discount_type,
      input.discount_value,
      input.applies_to,
      input.category_id,
      input.product_id,
      input.section_id,
      input.branch_id,
      input.min_quantity,
      input.start_time,
      input.end_time,
      input.priority,
      input.status || 'active',
    ]
  );
  const created = result.rows[0];
  created.effective_status = mapBulkEffectiveStatus(created);
  return created;
};

const getBulkByUuid = async ({ outletId, bulkUuid }) => {
  if (!isUuid(bulkUuid)) {
    throw new DiscountValidationError('bulk discount uuid must be a valid UUID');
  }
  const result = await db.query(
    `
    SELECT *
    FROM bulk_discounts
    WHERE uuid = $1
      AND outlet_id = $2
      AND deleted_at IS NULL
    `,
    [bulkUuid, outletId]
  );
  const bulk = result.rows[0];
  if (!bulk) throw new DiscountValidationError('bulk discount not found', 404);
  return bulk;
};

const updateBulkDiscount = async ({ outletId, bulkUuid, payload }) => {
  const current = await getBulkByUuid({ outletId, bulkUuid });
  const input = normalizeBulkPayload(payload, { partial: true });

  const appliesTo = input.applies_to || current.applies_to;
  const merged = {
    category_id: input.category_id !== undefined ? input.category_id : current.category_id,
    product_id: input.product_id !== undefined ? input.product_id : current.product_id,
    section_id: input.section_id !== undefined ? input.section_id : current.section_id,
    branch_id: input.branch_id !== undefined ? input.branch_id : current.branch_id,
  };

  if (appliesTo === 'category') {
    if (!merged.category_id) throw new DiscountValidationError('category_id is required for applies_to=category');
    merged.product_id = null;
    merged.section_id = null;
  } else if (appliesTo === 'product') {
    if (!merged.product_id) throw new DiscountValidationError('product_id is required for applies_to=product');
    merged.category_id = null;
    merged.section_id = null;
  } else if (appliesTo === 'section') {
    if (!merged.section_id) throw new DiscountValidationError('section_id is required for applies_to=section');
    merged.category_id = null;
    merged.product_id = null;
  } else if (appliesTo === 'branch') {
    merged.category_id = null;
    merged.product_id = null;
    merged.section_id = null;
  }

  const nextStart = input.start_time || current.start_time;
  const nextEnd = input.end_time || current.end_time;
  assertTimeWindow(nextStart, nextEnd);

  const nextType = input.discount_type || current.discount_type;
  const nextValue =
    input.discount_value !== null && input.discount_value !== undefined
      ? input.discount_value
      : Number(current.discount_value);
  if (nextType === 'percentage' && nextValue > 100) {
    throw new DiscountValidationError('percentage bulk discount_value must be <= 100');
  }

  const result = await db.query(
    `
    UPDATE bulk_discounts
    SET
      name = COALESCE($3, name),
      description = COALESCE($4, description),
      discount_type = COALESCE($5, discount_type),
      discount_value = COALESCE($6, discount_value),
      applies_to = COALESCE($7, applies_to),
      category_id = $8,
      product_id = $9,
      section_id = $10,
      branch_id = $11,
      min_quantity = $12,
      start_time = COALESCE($13, start_time),
      end_time = COALESCE($14, end_time),
      priority = COALESCE($15, priority),
      status = COALESCE($16, status),
      updated_at = now()
    WHERE uuid = $1
      AND outlet_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [
      bulkUuid,
      outletId,
      input.name,
      input.description,
      input.discount_type,
      input.discount_value,
      input.applies_to,
      merged.category_id,
      merged.product_id,
      merged.section_id,
      merged.branch_id,
      input.min_quantity !== undefined ? input.min_quantity : current.min_quantity,
      input.start_time,
      input.end_time,
      input.priority,
      input.status,
    ]
  );

  const updated = result.rows[0];
  if (!updated) throw new DiscountValidationError('bulk discount not found', 404);
  updated.effective_status = mapBulkEffectiveStatus(updated);
  return updated;
};

const toggleBulkDiscount = async ({ outletId, bulkUuid }) => {
  const current = await getBulkByUuid({ outletId, bulkUuid });
  const nextStatus = current.status === 'active' ? 'inactive' : 'active';
  const result = await db.query(
    `
    UPDATE bulk_discounts
    SET status = $3, updated_at = now()
    WHERE uuid = $1
      AND outlet_id = $2
      AND deleted_at IS NULL
    RETURNING *
    `,
    [bulkUuid, outletId, nextStatus]
  );
  const updated = result.rows[0];
  updated.effective_status = mapBulkEffectiveStatus(updated);
  return updated;
};

const softDeleteBulkDiscount = async ({ outletId, bulkUuid }) => {
  const result = await db.query(
    `
    UPDATE bulk_discounts
    SET deleted_at = now(), status = 'inactive', updated_at = now()
    WHERE uuid = $1
      AND outlet_id = $2
      AND deleted_at IS NULL
    RETURNING id
    `,
    [bulkUuid, outletId]
  );
  if (!result.rows[0]) throw new DiscountValidationError('bulk discount not found', 404);
  return true;
};

const normalizeOrderItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new DiscountValidationError('items are required');
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

const fetchSectionAddonGroups = async ({ sectionId }) => {
  if (!sectionId) return [];
  const result = await db.query(
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

const resolveItemsForQuote = async ({ outletId, items }) => {
  const normalizedItems = normalizeOrderItems(items);
  const resolved = [];
  const sectionAddonGroupCache = new Map();
  for (let itemIndex = 0; itemIndex < normalizedItems.length; itemIndex += 1) {
    const item = normalizedItems[itemIndex];
    const productResult = await db.query(
      `
      SELECT
        p.id,
        p.base_price,
        p.is_active,
        p.section_id,
        p.category_id
      FROM products p
      WHERE p.id = $1
        AND p.deleted_at IS NULL
      `,
      [item.product_id]
    );
    const product = productResult.rows[0];
    if (!product || !product.is_active) {
      throw new DiscountValidationError(`product_id ${item.product_id} not found or inactive`);
    }

    const settingResult = await db.query(
      `
      SELECT is_available, price_override
      FROM product_outlet_settings
      WHERE product_id = $1
        AND outlet_id = $2
        AND deleted_at IS NULL
      LIMIT 1
      `,
      [item.product_id, outletId]
    );
    const setting = settingResult.rows[0] || null;
    if (setting && setting.is_available === false) {
      throw new DiscountValidationError(`product_id ${item.product_id} is unavailable for this outlet`);
    }

    const sectionId = product.section_id || null;
    if (!sectionAddonGroupCache.has(sectionId)) {
      const addonGroups = await fetchSectionAddonGroups({ sectionId });
      sectionAddonGroupCache.set(sectionId, addonGroups);
    }
    const addonResolution = resolveAddonSelections({
      addonGroups: sectionAddonGroupCache.get(sectionId),
      modifiers: item.modifiers,
      createError: (message) => new DiscountValidationError(`items[${itemIndex}].${message}`),
      fieldPath: 'modifiers.addons',
    });
    const baseUnitPrice = Number(setting?.price_override ?? product.base_price);
    const unitPrice = roundMoney(baseUnitPrice + Number(addonResolution.unit_price_delta || 0));

    resolved.push({
      product_id: item.product_id,
      quantity: item.quantity,
      section_id: product.section_id,
      category_id: product.category_id,
      modifiers: {
        ...item.modifiers,
        addons: addonResolution.addons,
        addon_unit_price_delta: addonResolution.unit_price_delta,
      },
      unit_price: unitPrice,
      total_price: roundMoney(unitPrice * item.quantity),
    });
  }
  return resolved;
};

const computeBulkCandidates = ({ rules, items, subtotal, outletId, roundingRule = 'none' }) => {
  const candidates = [];
  for (const rule of rules) {
    let matchedItems = [];

    if (rule.applies_to === 'product') {
      matchedItems = items.filter((item) => Number(item.product_id) === Number(rule.product_id));
    } else if (rule.applies_to === 'section') {
      matchedItems = items.filter((item) => String(item.section_id || '') === String(rule.section_id || ''));
    } else if (rule.applies_to === 'category') {
      matchedItems = items.filter((item) => Number(item.category_id || 0) === Number(rule.category_id || 0));
    } else if (rule.applies_to === 'branch') {
      if (rule.branch_id && Number(rule.branch_id) !== Number(outletId)) {
        continue;
      }
      matchedItems = items;
    }

    if (matchedItems.length === 0) continue;

    const quantitySum = matchedItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    if (rule.min_quantity && quantitySum < Number(rule.min_quantity)) {
      continue;
    }

    const baseAmount =
      rule.applies_to === 'branch'
        ? applyRounding(subtotal, roundingRule)
        : applyRounding(
            matchedItems.reduce((sum, item) => sum + Number(item.total_price || 0), 0),
            roundingRule
          );
    if (baseAmount <= 0) continue;

    const rawDiscount =
      rule.discount_type === 'percentage'
        ? (baseAmount * Number(rule.discount_value)) / 100
        : Number(rule.discount_value);
    const computedDiscount = Math.min(baseAmount, applyRounding(rawDiscount, roundingRule));
    if (computedDiscount <= 0) continue;

    candidates.push({
      rule,
      base_amount: baseAmount,
      discount_amount: computedDiscount,
    });
  }

  return candidates;
};

const pickWinningBulkCandidate = (candidates) => {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const priorityDiff = Number(b.rule.priority) - Number(a.rule.priority);
    if (priorityDiff !== 0) return priorityDiff;
    const discountDiff = Number(b.discount_amount) - Number(a.discount_amount);
    if (discountDiff !== 0) return discountDiff;
    return new Date(a.rule.created_at).getTime() - new Date(b.rule.created_at).getTime();
  })[0];
};

const evaluateBulkDiscount = async ({
  client = null,
  outletId,
  items,
  subtotal,
  now = new Date(),
  roundingRule = 'none',
}) => {
  const result = await runQuery(
    client,
    `
    SELECT *
    FROM bulk_discounts
    WHERE outlet_id = $1
      AND deleted_at IS NULL
      AND status = 'active'
      AND start_time <= $2
      AND end_time >= $2
    ORDER BY priority DESC, created_at ASC
    `,
    [outletId, now]
  );
  const candidates = computeBulkCandidates({
    rules: result.rows,
    items,
    subtotal,
    outletId,
    roundingRule,
  });
  const winner = pickWinningBulkCandidate(candidates);
  if (!winner) {
    return {
      bulk_discount_total: 0,
      applied_bulk_discount: null,
    };
  }

  return {
    bulk_discount_total: applyRounding(winner.discount_amount, roundingRule),
    applied_bulk_discount: {
      id: winner.rule.id,
      uuid: winner.rule.uuid,
      name: winner.rule.name,
      applies_to: winner.rule.applies_to,
      discount_type: winner.rule.discount_type,
      discount_value: Number(winner.rule.discount_value),
      priority: Number(winner.rule.priority),
      matched_base_amount: winner.base_amount,
      discount_amount: applyRounding(winner.discount_amount, roundingRule),
    },
  };
};

const getPromoByCode = async ({ client = null, outletId, code, forUpdate = false }) => {
  const normalizedCode = normalizeText(code, 'promo_code', { required: true, max: 120, forceUpper: true });
  const result = await runQuery(
    client,
    `
    SELECT *
    FROM promo_codes
    WHERE outlet_id = $1
      AND LOWER(code) = LOWER($2)
      AND deleted_at IS NULL
    ${forUpdate ? 'FOR UPDATE' : ''}
    LIMIT 1
    `,
    [outletId, normalizedCode]
  );
  const promo = result.rows[0];
  if (!promo) throw new DiscountValidationError('promo code not found', 404);
  return promo;
};

const validatePromoForAmount = async ({
  client = null,
  outletId,
  promoCode,
  source,
  customerId = null,
  amountBeforePromo,
  now = new Date(),
  forUpdate = false,
  roundingRule = 'none',
}) => {
  if (!promoCode) {
    return {
      promo: null,
      promo_discount_total: 0,
      applied_promo: null,
    };
  }

  const normalizedSource = normalizeSource(source);
  const promo = await getPromoByCode({
    client,
    outletId,
    code: promoCode,
    forUpdate,
  });
  const effectiveStatus = mapPromoEffectiveStatus(promo, now);
  if (effectiveStatus !== 'active') {
    throw new DiscountValidationError(`promo code is ${effectiveStatus}`);
  }

  const expectedChannel = sourcePromoChannel(normalizedSource);
  if (promo.applicable_on !== 'both' && promo.applicable_on !== expectedChannel) {
    throw new DiscountValidationError('promo code is not valid for this order source');
  }

  const minOrderAmount = promo.min_order_amount === null ? null : Number(promo.min_order_amount);
  if (minOrderAmount !== null && amountBeforePromo < minOrderAmount) {
    throw new DiscountValidationError(`promo code requires minimum order amount ${minOrderAmount.toFixed(2)}`);
  }

  const perUserLimit = promo.per_user_limit === null ? null : Number(promo.per_user_limit);
  if (perUserLimit !== null) {
    // Guest checkout is allowed without customer_id; enforce per-user only when an identified customer is provided.
    if (customerId) {
      const usageResult = await runQuery(
        client,
        `
        SELECT COUNT(*) AS count
        FROM promo_usage_logs
        WHERE promo_code_id = $1
          AND user_id = $2
        `,
        [promo.id, String(customerId)]
      );
      const usedByCustomer = Number(usageResult.rows[0]?.count || 0);
      if (usedByCustomer >= perUserLimit) {
        throw new DiscountValidationError('promo code per-user limit exceeded');
      }
    }
  }

  let promoDiscount =
    promo.discount_type === 'percentage'
      ? (amountBeforePromo * Number(promo.discount_value)) / 100
      : Number(promo.discount_value);

  const maxDiscount = promo.max_discount_amount === null ? null : Number(promo.max_discount_amount);
  if (maxDiscount !== null) {
    promoDiscount = Math.min(promoDiscount, maxDiscount);
  }
  promoDiscount = Math.min(amountBeforePromo, applyRounding(promoDiscount, roundingRule));

  return {
    promo,
    promo_discount_total: promoDiscount,
    applied_promo: {
      id: promo.id,
      uuid: promo.uuid,
      code: promo.code,
      name: promo.name,
      applicable_on: promo.applicable_on,
      discount_type: promo.discount_type,
      discount_value: Number(promo.discount_value),
      discount_amount: promoDiscount,
    },
  };
};

const resolveDiscountSelection = ({
  bulkResult,
  promoResult,
  promoCode,
  discountStackingEnabled,
  roundingRule,
}) => {
  const bulkAmount = applyRounding(Number(bulkResult.bulk_discount_total || 0), roundingRule);
  const promoAmount = applyRounding(Number(promoResult.promo_discount_total || 0), roundingRule);
  const hasPromoCode = Boolean(promoCode);

  if (discountStackingEnabled) {
    return {
      bulk_discount_total: bulkAmount,
      promo_discount_total: promoAmount,
      discount_total: applyRounding(bulkAmount + promoAmount, roundingRule),
      promo_code_id: promoAmount > 0 && promoResult.promo ? Number(promoResult.promo.id) : null,
      applied_bulk_discount: bulkAmount > 0 ? bulkResult.applied_bulk_discount : null,
      applied_promo_code: promoAmount > 0 ? promoResult.applied_promo : null,
    };
  }

  const promoWinsTie = hasPromoCode && promoAmount > 0 && promoAmount === bulkAmount;
  const promoWins = promoWinsTie || promoAmount > bulkAmount;
  if (promoWins) {
    return {
      bulk_discount_total: 0,
      promo_discount_total: promoAmount,
      discount_total: promoAmount,
      promo_code_id: promoResult.promo ? Number(promoResult.promo.id) : null,
      applied_bulk_discount: null,
      applied_promo_code: promoResult.applied_promo,
    };
  }

  return {
    bulk_discount_total: bulkAmount,
    promo_discount_total: 0,
    discount_total: bulkAmount,
    promo_code_id: null,
    applied_bulk_discount: bulkAmount > 0 ? bulkResult.applied_bulk_discount : null,
    applied_promo_code: null,
  };
};

const computeDiscountQuote = async ({
  outletId,
  source,
  customerId = null,
  promoCode = null,
  items,
  tax = 0,
  now = new Date(),
  discountStackingEnabled = true,
  roundingRule = 'none',
}) => {
  const resolvedItems = await resolveItemsForQuote({ outletId, items });
  const subtotal = applyRounding(
    resolvedItems.reduce((sum, item) => sum + item.total_price, 0),
    roundingRule
  );
  const bulkResult = await evaluateBulkDiscount({
    outletId,
    items: resolvedItems,
    subtotal,
    now,
    roundingRule,
  });
  const promoBaseAmount = discountStackingEnabled
    ? Math.max(0, applyRounding(subtotal - bulkResult.bulk_discount_total, roundingRule))
    : subtotal;
  const promoResult = await validatePromoForAmount({
    outletId,
    promoCode,
    source,
    customerId,
    amountBeforePromo: promoBaseAmount,
    now,
    forUpdate: false,
    roundingRule,
  });
  const discountSelection = resolveDiscountSelection({
    bulkResult,
    promoResult,
    promoCode,
    discountStackingEnabled,
    roundingRule,
  });
  const discountTotal = applyRounding(discountSelection.discount_total, roundingRule);
  const taxAmount = toMoney(tax, 'tax') || 0;
  const finalTotal = Math.max(
    0,
    applyRounding(subtotal - discountTotal + taxAmount, roundingRule)
  );

  return {
    subtotal,
    bulk_discount_total: discountSelection.bulk_discount_total,
    promo_discount_total: discountSelection.promo_discount_total,
    discount_total: discountTotal,
    tax: taxAmount,
    final_total: finalTotal,
    applied_bulk_discount: discountSelection.applied_bulk_discount,
    applied_promo_code: discountSelection.applied_promo_code,
    items: resolvedItems.map((item) => ({
      product_id: item.product_id,
      quantity: item.quantity,
      modifiers: item.modifiers,
      unit_price: item.unit_price,
      total_price: item.total_price,
    })),
  };
};

const evaluateOrderDiscountsInTx = async ({
  client,
  outletId,
  source,
  customerId = null,
  promoCode = null,
  resolvedItems,
  subtotal,
  now = new Date(),
  discountStackingEnabled = true,
  roundingRule = 'none',
}) => {
  const bulkResult = await evaluateBulkDiscount({
    client,
    outletId,
    items: resolvedItems,
    subtotal,
    now,
    roundingRule,
  });
  const promoBaseAmount = discountStackingEnabled
    ? Math.max(0, applyRounding(subtotal - bulkResult.bulk_discount_total, roundingRule))
    : subtotal;
  const promoResult = await validatePromoForAmount({
    client,
    outletId,
    promoCode,
    source,
    customerId,
    amountBeforePromo: promoBaseAmount,
    now,
    forUpdate: true,
    roundingRule,
  });
  const discountSelection = resolveDiscountSelection({
    bulkResult,
    promoResult,
    promoCode,
    discountStackingEnabled,
    roundingRule,
  });

  return {
    bulk_discount_amount: applyRounding(discountSelection.bulk_discount_total, roundingRule),
    promo_discount_amount: applyRounding(discountSelection.promo_discount_total, roundingRule),
    discount: applyRounding(discountSelection.discount_total, roundingRule),
    promo_code_id: discountSelection.promo_code_id,
    applied_bulk_discount: discountSelection.applied_bulk_discount,
    applied_promo_code: discountSelection.applied_promo_code,
  };
};

const recordPromoUsage = async ({
  client,
  promoCodeId,
  orderId,
  userId,
  outletId,
  discountAmount,
}) => {
  if (!promoCodeId || !discountAmount || discountAmount <= 0) {
    return;
  }

  const updateResult = await runQuery(
    client,
    `
    UPDATE promo_codes
    SET used_count = used_count + 1, updated_at = now()
    WHERE id = $1
      AND deleted_at IS NULL
      AND (usage_limit IS NULL OR used_count < usage_limit)
    RETURNING id
    `,
    [promoCodeId]
  );
  if (!updateResult.rows[0]) {
    throw new DiscountValidationError('promo code usage limit reached', 409);
  }

  await runQuery(
    client,
    `
    INSERT INTO promo_usage_logs (
      promo_code_id,
      order_id,
      user_id,
      discount_amount,
      used_at,
      outlet_id
    )
    VALUES ($1, $2, $3, $4, now(), $5)
    `,
    [promoCodeId, orderId, String(userId || 'anonymous'), discountAmount, outletId]
  );
};

const validatePromoCode = async ({
  outletId,
  promoCode,
  source,
  customerId = null,
  amountBeforePromo,
}) => {
  const normalizedAmount = toMoney(amountBeforePromo, 'amount_before_promo', { required: true, min: 0 });
  const result = await validatePromoForAmount({
    outletId,
    promoCode,
    source,
    customerId,
    amountBeforePromo: normalizedAmount,
    forUpdate: false,
    roundingRule: 'none',
  });
  return {
    valid: true,
    promo_discount_total: result.promo_discount_total,
    applied_promo_code: result.applied_promo,
  };
};

module.exports = {
  DiscountValidationError,
  parsePagination,
  toBool,
  toPositiveInt,
  normalizeSource,
  normalizeOrderItems,
  resolveItemsForQuote,
  listPromoCodes,
  createPromoCode,
  updatePromoCode,
  togglePromoCode,
  softDeletePromoCode,
  listBulkDiscounts,
  createBulkDiscount,
  updateBulkDiscount,
  toggleBulkDiscount,
  softDeleteBulkDiscount,
  mapPromoEffectiveStatus,
  mapBulkEffectiveStatus,
  evaluateBulkDiscount,
  validatePromoForAmount,
  computeDiscountQuote,
  evaluateOrderDiscountsInTx,
  recordPromoUsage,
  validatePromoCode,
  roundMoney,
};
