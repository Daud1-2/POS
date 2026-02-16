const express = require('express');
const db = require('../services/db');
const {
  createOrder,
  updateOrderStatus,
  ValidationError,
  ALLOWED_ORDER_CHANNELS,
  ALLOWED_STATUSES,
} = require('../services/ordersService');

const router = express.Router();

const toPositiveInt = (value, fallback = null) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return fallback;
  return num;
};

const parseCsvList = (value) =>
  String(value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

const parseIsoDate = (value, fieldName) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${fieldName} must be a valid ISO timestamp`);
  }
  return date.toISOString();
};

const parsePagination = (req) => {
  const page = toPositiveInt(req.query.page, 1);
  const pageSizeRaw = toPositiveInt(req.query.page_size ?? req.query.pageSize, 25);
  const pageSize = Math.min(pageSizeRaw, 100);
  const offset = (page - 1) * pageSize;
  return { page, page_size: pageSize, offset };
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

const fetchOrdersWithPagination = async ({ whereClause, whereParams, pagination }) => {
  const countResult = await db.query(
    `
    SELECT COUNT(*) AS count
    FROM orders o
    WHERE ${whereClause}
    `,
    whereParams
  );
  const total = Number(countResult.rows[0]?.count || 0);

  const dataResult = await db.query(
    `
    SELECT
      o.id,
      o.legacy_order_id,
      o.order_number,
      o.source,
      o.order_channel,
      o.order_type,
      o.status,
      o.scheduled_for,
      o.subtotal,
      o.tax,
      o.discount,
      o.bulk_discount_amount,
      o.promo_discount_amount,
      o.promo_code_id,
      o.total,
      o.payment_status,
      o.payment_method,
      o.customer_id,
      o.outlet_id AS branch_id,
      o.created_at,
      o.updated_at,
      o.completed_at,
      o.refunded_at
    FROM orders o
    WHERE ${whereClause}
    ORDER BY o.created_at DESC
    LIMIT $${whereParams.length + 1}
    OFFSET $${whereParams.length + 2}
    `,
    [...whereParams, pagination.page_size, pagination.offset]
  );

  return buildPagedResponse({
    rows: dataResult.rows,
    page: pagination.page,
    pageSize: pagination.page_size,
    total,
  });
};

router.post('/', async (req, res, next) => {
  try {
    let branchId = req.effectiveBranchId;
    if (req.branchScope === 'all') {
      const requested = toPositiveInt(req.body?.branch_id ?? req.body?.outlet_id);
      if (!requested) {
        return res.status(400).json({ error: 'branch_id is required when using all-branch admin scope' });
      }
      const allowed = Array.isArray(req.effectiveBranchIds) ? req.effectiveBranchIds : [];
      if (!allowed.includes(requested)) {
        return res.status(403).json({ error: 'Branch is not in admin scope' });
      }
      branchId = requested;
    }

    const created = await createOrder(req.body, {
      branchId,
      actorId: req.user?.sub || null,
      role: req.user?.role || 'cashier',
    });
    return res.status(201).json({ data: created });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

router.patch('/:order_id/status', async (req, res, next) => {
  try {
    const updated = await updateOrderStatus(req.params.order_id, req.body, {
      branchId: req.effectiveBranchId,
      actorId: req.user?.sub || null,
      role: req.user?.role || 'cashier',
    });
    return res.json({ data: updated });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

router.get('/', async (req, res, next) => {
  try {
    const pagination = parsePagination(req);
    const channels = parseCsvList(req.query.channel).filter((value) => ALLOWED_ORDER_CHANNELS.has(value));
    const statuses = parseCsvList(req.query.status).filter((value) => ALLOWED_STATUSES.has(value));
    const invalidChannels = parseCsvList(req.query.channel).filter((value) => !ALLOWED_ORDER_CHANNELS.has(value));
    const invalidStatuses = parseCsvList(req.query.status).filter((value) => !ALLOWED_STATUSES.has(value));
    if (invalidChannels.length > 0) {
      return res.status(400).json({ error: `Invalid channel filter: ${invalidChannels.join(', ')}` });
    }
    if (invalidStatuses.length > 0) {
      return res.status(400).json({ error: `Invalid status filter: ${invalidStatuses.join(', ')}` });
    }

    const search = String(req.query.search || '').trim();
    const dateFrom = parseIsoDate(req.query.date_from, 'date_from');
    const dateTo = parseIsoDate(req.query.date_to, 'date_to');
    if (dateFrom && dateTo && dateFrom >= dateTo) {
      return res.status(400).json({ error: 'date_from must be earlier than date_to' });
    }

    const whereParams = [req.effectiveBranchIds];
    const whereClauses = [
      'o.outlet_id = ANY($1::int[])',
      'o.deleted_at IS NULL',
    ];

    if (channels.length > 0) {
      whereParams.push(channels);
      whereClauses.push(`o.order_channel = ANY($${whereParams.length}::text[])`);
    }

    if (statuses.length > 0) {
      whereParams.push(statuses);
      whereClauses.push(`o.status = ANY($${whereParams.length}::text[])`);
    }

    if (search) {
      whereParams.push(`%${search}%`);
      whereClauses.push(`(
        o.order_number ILIKE $${whereParams.length}
        OR COALESCE(o.customer_name_snapshot, '') ILIKE $${whereParams.length}
      )`);
    }

    if (dateFrom) {
      whereParams.push(dateFrom);
      whereClauses.push(`o.created_at >= $${whereParams.length}`);
    }
    if (dateTo) {
      whereParams.push(dateTo);
      whereClauses.push(`o.created_at < $${whereParams.length}`);
    }

    const response = await fetchOrdersWithPagination({
      whereClause: whereClauses.join('\n        AND '),
      whereParams,
      pagination,
    });

    return res.json(response);
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

router.get('/live', async (req, res, next) => {
  try {
    const pagination = parsePagination(req);
    const channels = parseCsvList(req.query.channel).filter((value) => ALLOWED_ORDER_CHANNELS.has(value));
    const invalidChannels = parseCsvList(req.query.channel).filter((value) => !ALLOWED_ORDER_CHANNELS.has(value));
    if (invalidChannels.length > 0) {
      return res.status(400).json({ error: `Invalid channel filter: ${invalidChannels.join(', ')}` });
    }

    const whereParams = [req.effectiveBranchIds];
    let whereClause = `
      o.outlet_id = ANY($1::int[])
      AND o.deleted_at IS NULL
      AND o.status IN ('pending', 'new', 'accepted', 'preparing', 'ready')
      AND (o.scheduled_for IS NULL OR o.scheduled_for <= now())
    `;

    if (channels.length > 0) {
      whereParams.push(channels);
      whereClause += `\n      AND o.order_channel = ANY($${whereParams.length}::text[])`;
    }

    const response = await fetchOrdersWithPagination({
      whereClause,
      whereParams,
      pagination,
    });
    return res.json(response);
  } catch (err) {
    return next(err);
  }
});

router.get('/pre', async (req, res, next) => {
  try {
    const pagination = parsePagination(req);
    const response = await fetchOrdersWithPagination({
      whereClause: `
        o.outlet_id = ANY($1::int[])
        AND o.deleted_at IS NULL
        AND o.scheduled_for IS NOT NULL
        AND o.scheduled_for > now()
        AND o.status NOT IN ('cancelled', 'refunded', 'rejected')
      `,
      whereParams: [req.effectiveBranchIds],
      pagination,
    });
    return res.json(response);
  } catch (err) {
    return next(err);
  }
});

router.get('/phone', async (req, res, next) => {
  try {
    const pagination = parsePagination(req);
    const response = await fetchOrdersWithPagination({
      whereClause: `
        o.outlet_id = ANY($1::int[])
        AND o.deleted_at IS NULL
        AND o.order_channel = 'pos'
        AND o.source = 'phone'
      `,
      whereParams: [req.effectiveBranchIds],
      pagination,
    });
    return res.json(response);
  } catch (err) {
    return next(err);
  }
});

router.get('/reviews/summary', async (req, res, next) => {
  try {
    const pagination = parsePagination(req);

    const summaryResult = await db.query(
      `
      SELECT
        COUNT(*) AS total_reviews,
        COALESCE(ROUND(AVG(r.rating)::numeric, 2), 0) AS average_rating
      FROM order_reviews r
      JOIN orders o ON o.id = r.order_id
      WHERE o.outlet_id = ANY($1::int[])
        AND o.deleted_at IS NULL
      `,
      [req.effectiveBranchIds]
    );

    const totalReviews = Number(summaryResult.rows[0]?.total_reviews || 0);
    const averageRating = Number(summaryResult.rows[0]?.average_rating || 0);

    const listResult = await db.query(
      `
      SELECT
        r.id,
        r.order_id,
        r.rating,
        r.comment,
        r.source,
        r.created_at,
        o.order_number,
        o.total
      FROM order_reviews r
      JOIN orders o ON o.id = r.order_id
      WHERE o.outlet_id = ANY($1::int[])
        AND o.deleted_at IS NULL
      ORDER BY r.created_at DESC
      LIMIT $2
      OFFSET $3
      `,
      [req.effectiveBranchIds, pagination.page_size, pagination.offset]
    );

    return res.json({
      ...buildPagedResponse({
        rows: listResult.rows,
        page: pagination.page,
        pageSize: pagination.page_size,
        total: totalReviews,
      }),
      summary: {
        average_rating: averageRating,
        total_reviews: totalReviews,
      },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

