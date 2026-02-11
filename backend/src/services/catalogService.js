const db = require('./db');

class CatalogValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'CatalogValidationError';
    this.statusCode = statusCode;
  }
}

const toPositiveInt = (value) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return fallback;
};

const toMoney = (value, fieldName, { required = false } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new CatalogValidationError(`${fieldName} is required`);
    }
    return null;
  }

  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new CatalogValidationError(`${fieldName} must be a valid number`);
  }
  if (num < 0) {
    throw new CatalogValidationError(`${fieldName} must be >= 0`);
  }
  return Number(num.toFixed(2));
};

const normalizeString = (value, fieldName, { required = false, max = 255 } = {}) => {
  if (value === undefined || value === null) {
    if (required) throw new CatalogValidationError(`${fieldName} is required`);
    return null;
  }
  const text = String(value).trim();
  if (!text) {
    if (required) throw new CatalogValidationError(`${fieldName} is required`);
    return null;
  }
  if (text.length > max) {
    throw new CatalogValidationError(`${fieldName} must be <= ${max} characters`);
  }
  return text;
};

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const parsePagination = (query = {}) => {
  const page = toPositiveInt(query.page) || 1;
  const pageSizeRaw = toPositiveInt(query.page_size ?? query.pageSize) || 25;
  const pageSize = Math.min(pageSizeRaw, 100);
  return {
    page,
    page_size: pageSize,
    offset: (page - 1) * pageSize,
  };
};

const buildPagedResponse = ({ rows, page, pageSize, total }) => ({
  data: rows,
  meta: {
    page,
    page_size: pageSize,
    total,
    total_pages: total === 0 ? 0 : Math.ceil(total / pageSize),
  },
});

const runQuery = (client, text, params = []) => {
  if (client && typeof client.query === 'function') {
    return client.query(text, params);
  }
  return db.query(text, params);
};

const assertSectionExists = async (sectionId, outletId) => {
  if (!sectionId || !isUuid(sectionId)) {
    throw new CatalogValidationError('section_id must be a valid UUID');
  }

  const result = await db.query(
    `
    SELECT id
    FROM sections
    WHERE id = $1
      AND deleted_at IS NULL
      AND (outlet_id IS NULL OR outlet_id = $2)
    `,
    [sectionId, outletId]
  );

  if (!result.rows[0]) {
    throw new CatalogValidationError('section_id is invalid for this outlet');
  }
};

const getDefaultSectionId = async (outletId) => {
  const result = await db.query(
    `
    SELECT id
    FROM sections
    WHERE deleted_at IS NULL
      AND is_active = TRUE
      AND LOWER(name) = 'uncategorized'
      AND (outlet_id IS NULL OR outlet_id = $1)
    ORDER BY outlet_id NULLS FIRST, created_at ASC
    LIMIT 1
    `,
    [outletId]
  );
  if (result.rows[0]) {
    return result.rows[0].id;
  }

  const activeFallback = await db.query(
    `
    SELECT id
    FROM sections
    WHERE deleted_at IS NULL
      AND is_active = TRUE
      AND (outlet_id IS NULL OR outlet_id = $1)
    ORDER BY display_order ASC, created_at ASC
    LIMIT 1
    `,
    [outletId]
  );

  if (activeFallback.rows[0]) {
    return activeFallback.rows[0].id;
  }

  const created = await db.query(
    `
    INSERT INTO sections (
      name, description, display_order, is_active, outlet_id, created_at, updated_at
    )
    VALUES ('Uncategorized', 'Auto-created default section', 0, TRUE, NULL, now(), now())
    RETURNING id
    `
  );
  return created.rows[0].id;
};

const mapProductRow = (row) => ({
  id: Number(row.id),
  product_uid: row.product_uid,
  name: row.name,
  description: row.description,
  sku: row.sku,
  barcode: row.barcode,
  base_price: Number(row.base_price),
  cost_price: row.cost_price === null ? null : Number(row.cost_price),
  tax_rate: Number(row.tax_rate),
  is_active: row.is_active,
  track_inventory: row.track_inventory,
  stock_quantity: Number(row.stock_quantity),
  section_id: row.section_id,
  section_name: row.section_name,
  image_url: row.image_url,
  effective_price: Number(row.effective_price),
  effective_stock: row.effective_stock === null ? null : Number(row.effective_stock),
  is_available: row.is_available,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const getCompatProducts = async ({ outletId }) => {
  const result = await db.query(
    `
    SELECT
      p.id,
      p.name,
      p.sku,
      COALESCE(pos.price_override, p.base_price)::numeric(12,2) AS price,
      COALESCE(pos.stock_override, p.stock_quantity) AS stock,
      p.is_active,
      p.created_at,
      p.updated_at
    FROM products p
    LEFT JOIN product_outlet_settings pos
      ON pos.product_id = p.id
      AND pos.outlet_id = $1
      AND pos.deleted_at IS NULL
    WHERE p.deleted_at IS NULL
      AND p.is_active = TRUE
      AND COALESCE(pos.is_available, TRUE) = TRUE
    ORDER BY p.id DESC
    `,
    [outletId]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.name,
    sku: row.sku,
    price: Number(row.price),
    stock: Number(row.stock),
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
};

const listSections = async ({ outletId }) => {
  const result = await db.query(
    `
    SELECT id, name, description, display_order, is_active, outlet_id, created_at, updated_at
    FROM sections
    WHERE deleted_at IS NULL
      AND (outlet_id IS NULL OR outlet_id = $1)
    ORDER BY display_order ASC, created_at ASC
    `,
    [outletId]
  );
  return result.rows;
};

const createSection = async ({ outletId, payload }) => {
  const name = normalizeString(payload.name, 'name', { required: true, max: 120 });
  const description = normalizeString(payload.description, 'description', { max: 1000 });
  const displayOrder = Number.isInteger(payload.display_order) ? payload.display_order : 0;
  const isActive = toBool(payload.is_active, true);
  const requestedOutlet = payload.outlet_id === null ? null : toPositiveInt(payload.outlet_id);
  const scopeOutletId = requestedOutlet === null ? null : requestedOutlet || outletId;

  const result = await db.query(
    `
    INSERT INTO sections (name, description, display_order, is_active, outlet_id, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, now(), now())
    RETURNING id, name, description, display_order, is_active, outlet_id, created_at, updated_at
    `,
    [name, description, displayOrder, isActive, scopeOutletId]
  );
  return result.rows[0];
};

const updateSection = async ({ sectionId, payload, outletId }) => {
  if (!isUuid(sectionId)) throw new CatalogValidationError('section_id must be UUID');
  const existing = await db.query(
    `
    SELECT id
    FROM sections
    WHERE id = $1
      AND deleted_at IS NULL
      AND (outlet_id IS NULL OR outlet_id = $2)
    `,
    [sectionId, outletId]
  );
  if (!existing.rows[0]) {
    throw new CatalogValidationError('section not found', 404);
  }

  const name = payload.name !== undefined ? normalizeString(payload.name, 'name', { required: true, max: 120 }) : null;
  const description =
    payload.description !== undefined ? normalizeString(payload.description, 'description', { max: 1000 }) : null;
  const displayOrder = payload.display_order !== undefined ? Number(payload.display_order) : null;
  const isActive = payload.is_active !== undefined ? toBool(payload.is_active, true) : null;

  if (displayOrder !== null && !Number.isInteger(displayOrder)) {
    throw new CatalogValidationError('display_order must be an integer');
  }

  const result = await db.query(
    `
    UPDATE sections
    SET
      name = COALESCE($2, name),
      description = COALESCE($3, description),
      display_order = COALESCE($4, display_order),
      is_active = COALESCE($5, is_active),
      updated_at = now()
    WHERE id = $1
    RETURNING id, name, description, display_order, is_active, outlet_id, created_at, updated_at
    `,
    [sectionId, name, description, displayOrder, isActive]
  );
  return result.rows[0];
};

const reorderSections = async ({ items, outletId }) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new CatalogValidationError('items are required');
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    for (const entry of items) {
      if (!isUuid(entry.id) || !Number.isInteger(entry.display_order)) {
        throw new CatalogValidationError('each item must include id and display_order');
      }
      await client.query(
        `
        UPDATE sections
        SET display_order = $2, updated_at = now()
        WHERE id = $1
          AND deleted_at IS NULL
          AND (outlet_id IS NULL OR outlet_id = $3)
        `,
        [entry.id, entry.display_order, outletId]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const softDeleteSection = async ({ sectionId, outletId }) => {
  if (!isUuid(sectionId)) throw new CatalogValidationError('section_id must be UUID');

  const current = await db.query(
    `
    SELECT id, name, outlet_id
    FROM sections
    WHERE id = $1
      AND deleted_at IS NULL
      AND (outlet_id IS NULL OR outlet_id = $2)
    `,
    [sectionId, outletId]
  );

  if (!current.rows[0]) {
    throw new CatalogValidationError('section not found', 404);
  }

  const result = await db.query(
    `
    UPDATE sections
    SET deleted_at = now(), is_active = FALSE, updated_at = now()
    WHERE id = $1
      AND deleted_at IS NULL
      AND (outlet_id IS NULL OR outlet_id = $2)
    RETURNING id
    `,
    [sectionId, outletId]
  );
  if (!result.rows[0]) {
    throw new CatalogValidationError('section not found', 404);
  }
  return true;
};

const listItems = async ({
  outletId,
  sectionId,
  search,
  pagination,
  includeInactive = false,
  includeUnavailable = false,
}) => {
  const filters = ['p.deleted_at IS NULL'];
  const params = [outletId];

  if (!includeInactive) {
    filters.push('p.is_active = TRUE');
  }

  if (!includeUnavailable) {
    filters.push('COALESCE(pos.is_available, TRUE) = TRUE');
  }

  if (sectionId) {
    if (!isUuid(sectionId)) throw new CatalogValidationError('section_id must be UUID');
    params.push(sectionId);
    filters.push(`p.section_id = $${params.length}`);
  }

  if (search && typeof search === 'string') {
    params.push(`%${search.trim().toLowerCase()}%`);
    filters.push(`(LOWER(p.name) LIKE $${params.length} OR LOWER(p.sku) LIKE $${params.length})`);
  }

  const whereClause = filters.join(' AND ');

  const countResult = await db.query(
    `
    SELECT COUNT(*) AS count
    FROM products p
    LEFT JOIN product_outlet_settings pos
      ON pos.product_id = p.id
      AND pos.outlet_id = $1
      AND pos.deleted_at IS NULL
    WHERE ${whereClause}
    `,
    params
  );

  const total = Number(countResult.rows[0]?.count || 0);

  const dataParams = [...params, pagination.page_size, pagination.offset];
  const dataResult = await db.query(
    `
    SELECT
      p.id,
      p.product_uid,
      p.name,
      p.description,
      p.sku,
      p.barcode,
      p.base_price,
      p.cost_price,
      p.tax_rate,
      p.is_active,
      p.track_inventory,
      p.stock_quantity,
      p.section_id,
      p.created_at,
      p.updated_at,
      s.name AS section_name,
      COALESCE(pos.price_override, p.base_price)::numeric(12,2) AS effective_price,
      COALESCE(pos.stock_override, p.stock_quantity) AS effective_stock,
      COALESCE(pos.is_available, TRUE) AS is_available,
      img.image_url
    FROM products p
    LEFT JOIN sections s ON s.id = p.section_id
    LEFT JOIN product_outlet_settings pos
      ON pos.product_id = p.id
      AND pos.outlet_id = $1
      AND pos.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT image_url
      FROM product_images pi
      WHERE pi.product_id = p.id
        AND pi.deleted_at IS NULL
      ORDER BY pi.is_primary DESC, pi.display_order ASC, pi.created_at ASC
      LIMIT 1
    ) img ON TRUE
    WHERE ${whereClause}
    ORDER BY p.updated_at DESC, p.id DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
    `,
    dataParams
  );

  return buildPagedResponse({
    rows: dataResult.rows.map(mapProductRow),
    page: pagination.page,
    pageSize: pagination.page_size,
    total,
  });
};

const getProductByUid = async ({ productUid }) => {
  if (!isUuid(productUid)) {
    throw new CatalogValidationError('product_uid must be UUID');
  }
  const result = await db.query(
    `
    SELECT
      p.id,
      p.product_uid,
      p.name,
      p.description,
      p.sku,
      p.barcode,
      p.base_price,
      p.cost_price,
      p.section_id,
      s.name AS section_name,
      p.tax_rate,
      p.is_active,
      p.track_inventory,
      p.stock_quantity,
      p.created_at,
      p.updated_at
    FROM products p
    LEFT JOIN sections s ON s.id = p.section_id
    WHERE product_uid = $1
      AND p.deleted_at IS NULL
    `,
    [productUid]
  );
  if (!result.rows[0]) {
    throw new CatalogValidationError('product not found', 404);
  }
  return {
    ...result.rows[0],
    id: Number(result.rows[0].id),
    base_price: Number(result.rows[0].base_price),
    cost_price: result.rows[0].cost_price === null ? null : Number(result.rows[0].cost_price),
    tax_rate: Number(result.rows[0].tax_rate),
    stock_quantity: Number(result.rows[0].stock_quantity),
  };
};

const createItem = async ({ outletId, payload }) => {
  const name = normalizeString(payload.name, 'name', { required: true, max: 255 });
  const sku = normalizeString(payload.sku, 'sku', { required: true, max: 100 });
  const description = normalizeString(payload.description, 'description', { max: 1000 });
  const barcode = normalizeString(payload.barcode, 'barcode', { max: 120 });
  const basePrice = toMoney(payload.base_price ?? payload.price, 'base_price', { required: true });
  const costPrice = toMoney(payload.cost_price, 'cost_price');
  const taxRate = toMoney(payload.tax_rate, 'tax_rate') ?? 0;
  const stockQuantity = toPositiveInt(payload.stock_quantity ?? payload.stock) ?? 0;
  const isActive = toBool(payload.is_active, true);
  const trackInventory = toBool(payload.track_inventory, true);
  const sectionId = payload.section_id || (await getDefaultSectionId(outletId));
  await assertSectionExists(sectionId, outletId);

  const result = await db.query(
    `
    INSERT INTO products (
      name, description, sku, barcode, base_price, cost_price, section_id, tax_rate,
      is_active, track_inventory, stock_quantity, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
    RETURNING product_uid
    `,
    [name, description, sku, barcode, basePrice, costPrice, sectionId, taxRate, isActive, trackInventory, stockQuantity]
  );

  return getProductByUid({ productUid: result.rows[0].product_uid });
};

const updateItem = async ({ productUid, payload, outletId }) => {
  const current = await getProductByUid({ productUid });
  const name = payload.name !== undefined ? normalizeString(payload.name, 'name', { required: true, max: 255 }) : null;
  const sku = payload.sku !== undefined ? normalizeString(payload.sku, 'sku', { required: true, max: 100 }) : null;
  const description =
    payload.description !== undefined ? normalizeString(payload.description, 'description', { max: 1000 }) : null;
  const barcode = payload.barcode !== undefined ? normalizeString(payload.barcode, 'barcode', { max: 120 }) : null;
  const basePrice = payload.base_price !== undefined ? toMoney(payload.base_price, 'base_price') : null;
  const costPrice = payload.cost_price !== undefined ? toMoney(payload.cost_price, 'cost_price') : null;
  const taxRate = payload.tax_rate !== undefined ? toMoney(payload.tax_rate, 'tax_rate') : null;
  const trackInventory = payload.track_inventory !== undefined ? toBool(payload.track_inventory, true) : null;
  const isActive = payload.is_active !== undefined ? toBool(payload.is_active, true) : null;
  const stockQuantity =
    payload.stock_quantity !== undefined
      ? (() => {
          const value = Number(payload.stock_quantity);
          if (!Number.isInteger(value) || value < 0) {
            throw new CatalogValidationError('stock_quantity must be a non-negative integer');
          }
          return value;
        })()
      : null;
  const sectionId = payload.section_id ?? null;

  if (sectionId) {
    await assertSectionExists(sectionId, outletId);
  }

  await db.query(
    `
    UPDATE products
    SET
      name = COALESCE($2, name),
      sku = COALESCE($3, sku),
      description = COALESCE($4, description),
      barcode = COALESCE($5, barcode),
      base_price = COALESCE($6, base_price),
      cost_price = COALESCE($7, cost_price),
      section_id = COALESCE($8, section_id),
      tax_rate = COALESCE($9, tax_rate),
      track_inventory = COALESCE($10, track_inventory),
      stock_quantity = COALESCE($11, stock_quantity),
      is_active = COALESCE($12, is_active),
      updated_at = now()
    WHERE id = $1
    `,
    [
      current.id,
      name,
      sku,
      description,
      barcode,
      basePrice,
      costPrice,
      sectionId,
      taxRate,
      trackInventory,
      stockQuantity,
      isActive,
    ]
  );

  return getProductByUid({ productUid });
};

const setItemActive = async ({ productUid, isActive }) => {
  const current = await getProductByUid({ productUid });
  await db.query(
    `
    UPDATE products
    SET is_active = $2, updated_at = now()
    WHERE id = $1
    `,
    [current.id, isActive]
  );
  return true;
};

const softDeleteItem = async ({ productUid }) => {
  const result = await db.query(
    `
    UPDATE products
    SET deleted_at = now(), is_active = FALSE, updated_at = now()
    WHERE product_uid = $1
      AND deleted_at IS NULL
    RETURNING id
    `,
    [productUid]
  );
  if (!result.rows[0]) {
    throw new CatalogValidationError('product not found', 404);
  }
  return true;
};

const listImages = async ({ productUid }) => {
  const product = await getProductByUid({ productUid });
  const result = await db.query(
    `
    SELECT id, image_url, display_order, is_primary, created_at, updated_at
    FROM product_images
    WHERE product_id = $1
      AND deleted_at IS NULL
    ORDER BY is_primary DESC, display_order ASC, created_at ASC
    `,
    [product.id]
  );
  return result.rows;
};

const addImage = async ({ productUid, payload }) => {
  const product = await getProductByUid({ productUid });
  const imageUrl = normalizeString(payload.image_url, 'image_url', { required: true, max: 5000 });
  const displayOrder = Number.isInteger(payload.display_order) ? payload.display_order : 0;
  const markPrimary = toBool(payload.is_primary, false);

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM product_images
      WHERE product_id = $1
        AND deleted_at IS NULL
      `,
      [product.id]
    );

    const isPrimary = markPrimary || Number(existing.rows[0]?.count || 0) === 0;
    if (isPrimary) {
      await client.query(
        `
        UPDATE product_images
        SET is_primary = FALSE, updated_at = now()
        WHERE product_id = $1
          AND deleted_at IS NULL
        `,
        [product.id]
      );
    }

    const inserted = await client.query(
      `
      INSERT INTO product_images (product_id, image_url, display_order, is_primary, created_at, updated_at)
      VALUES ($1, $2, $3, $4, now(), now())
      RETURNING id, image_url, display_order, is_primary, created_at, updated_at
      `,
      [product.id, imageUrl, displayOrder, isPrimary]
    );

    await client.query('COMMIT');
    return inserted.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const updateImage = async ({ productUid, imageId, payload }) => {
  if (!isUuid(imageId)) throw new CatalogValidationError('image_id must be UUID');
  const product = await getProductByUid({ productUid });

  const displayOrder = payload.display_order !== undefined ? Number(payload.display_order) : null;
  if (displayOrder !== null && !Number.isInteger(displayOrder)) {
    throw new CatalogValidationError('display_order must be an integer');
  }
  const isPrimary = payload.is_primary !== undefined ? toBool(payload.is_primary, false) : null;
  const imageUrl = payload.image_url !== undefined ? normalizeString(payload.image_url, 'image_url', { required: true, max: 5000 }) : null;

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `
      SELECT id
      FROM product_images
      WHERE id = $1
        AND product_id = $2
        AND deleted_at IS NULL
      `,
      [imageId, product.id]
    );

    if (!existing.rows[0]) {
      throw new CatalogValidationError('image not found', 404);
    }

    if (isPrimary === true) {
      await client.query(
        `
        UPDATE product_images
        SET is_primary = FALSE, updated_at = now()
        WHERE product_id = $1
          AND deleted_at IS NULL
        `,
        [product.id]
      );
    }

    const result = await client.query(
      `
      UPDATE product_images
      SET
        image_url = COALESCE($3, image_url),
        display_order = COALESCE($4, display_order),
        is_primary = COALESCE($5, is_primary),
        updated_at = now()
      WHERE id = $1
        AND product_id = $2
        AND deleted_at IS NULL
      RETURNING id, image_url, display_order, is_primary, created_at, updated_at
      `,
      [imageId, product.id, imageUrl, displayOrder, isPrimary]
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const softDeleteImage = async ({ productUid, imageId }) => {
  if (!isUuid(imageId)) throw new CatalogValidationError('image_id must be UUID');
  const product = await getProductByUid({ productUid });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const deleted = await client.query(
      `
      UPDATE product_images
      SET deleted_at = now(), is_primary = FALSE, updated_at = now()
      WHERE id = $1
        AND product_id = $2
        AND deleted_at IS NULL
      RETURNING id
      `,
      [imageId, product.id]
    );

    if (!deleted.rows[0]) {
      throw new CatalogValidationError('image not found', 404);
    }

    const hasPrimary = await client.query(
      `
      SELECT 1
      FROM product_images
      WHERE product_id = $1
        AND deleted_at IS NULL
        AND is_primary = TRUE
      LIMIT 1
      `,
      [product.id]
    );

    if (!hasPrimary.rows[0]) {
      await client.query(
        `
        UPDATE product_images
        SET is_primary = TRUE, updated_at = now()
        WHERE id = (
          SELECT id
          FROM product_images
          WHERE product_id = $1
            AND deleted_at IS NULL
          ORDER BY display_order ASC, created_at ASC
          LIMIT 1
        )
        `,
        [product.id]
      );
    }

    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const listOutletSettings = async ({ productUid, outletId }) => {
  const product = await getProductByUid({ productUid });
  const result = await db.query(
    `
    SELECT id, product_id, outlet_id, is_available, price_override, stock_override, created_at, updated_at
    FROM product_outlet_settings
    WHERE product_id = $1
      AND outlet_id = $2
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [product.id, outletId]
  );
  return result.rows[0] || null;
};

const upsertOutletSetting = async ({ productUid, outletId, payload }) => {
  const product = await getProductByUid({ productUid });
  const isAvailable = toBool(payload.is_available, true);
  const priceOverride = toMoney(payload.price_override, 'price_override');
  const stockOverride =
    payload.stock_override === null || payload.stock_override === undefined || payload.stock_override === ''
      ? null
      : (() => {
          const value = Number(payload.stock_override);
          if (!Number.isInteger(value) || value < 0) {
            throw new CatalogValidationError('stock_override must be a non-negative integer');
          }
          return value;
        })();

  const existing = await db.query(
    `
    SELECT id
    FROM product_outlet_settings
    WHERE product_id = $1
      AND outlet_id = $2
      AND deleted_at IS NULL
    LIMIT 1
    `,
    [product.id, outletId]
  );

  if (existing.rows[0]) {
    const updated = await db.query(
      `
      UPDATE product_outlet_settings
      SET
        is_available = $2,
        price_override = $3,
        stock_override = $4,
        updated_at = now()
      WHERE id = $1
      RETURNING id, product_id, outlet_id, is_available, price_override, stock_override, created_at, updated_at
      `,
      [existing.rows[0].id, isAvailable, priceOverride, stockOverride]
    );
    return updated.rows[0];
  }

  const inserted = await db.query(
    `
    INSERT INTO product_outlet_settings (
      product_id, outlet_id, is_available, price_override, stock_override, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, now(), now())
    RETURNING id, product_id, outlet_id, is_available, price_override, stock_override, created_at, updated_at
    `,
    [product.id, outletId, isAvailable, priceOverride, stockOverride]
  );
  return inserted.rows[0];
};

module.exports = {
  CatalogValidationError,
  parsePagination,
  buildPagedResponse,
  toPositiveInt,
  toBool,
  getCompatProducts,
  listSections,
  createSection,
  updateSection,
  reorderSections,
  softDeleteSection,
  listItems,
  getProductByUid,
  createItem,
  updateItem,
  setItemActive,
  softDeleteItem,
  listImages,
  addImage,
  updateImage,
  softDeleteImage,
  listOutletSettings,
  upsertOutletSetting,
  getDefaultSectionId,
  runQuery,
};
