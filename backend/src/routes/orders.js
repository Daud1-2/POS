const express = require('express');
const db = require('../services/db');
const { createOrder, updateOrderStatus, ValidationError } = require('../services/ordersService');

const router = express.Router();

const toPositiveInt = (value, fallback = null) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return fallback;
  return num;
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
      o.order_type,
      o.status,
      o.scheduled_for,
      o.subtotal,
      o.tax,
      o.discount,
      o.total,
      o.payment_status,
      o.payment_method,
      o.customer_id,
      o.outlet_id,
      o.created_at,
      o.updated_at,
      o.completed_at
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
    const created = await createOrder(req.body, {
      outletId: req.effectiveOutletId,
      actorId: req.user?.sub || null,
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
      outletId: req.effectiveOutletId,
      actorId: req.user?.sub || null,
    });
    return res.json({ data: updated });
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
    const response = await fetchOrdersWithPagination({
      whereClause: `
        o.outlet_id = $1
        AND o.deleted_at IS NULL
        AND o.status IN ('open', 'preparing', 'ready', 'out_for_delivery')
        AND (o.scheduled_for IS NULL OR o.scheduled_for <= now())
      `,
      whereParams: [req.effectiveOutletId],
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
        o.outlet_id = $1
        AND o.deleted_at IS NULL
        AND o.scheduled_for IS NOT NULL
        AND o.scheduled_for > now()
        AND o.status NOT IN ('cancelled', 'refunded')
      `,
      whereParams: [req.effectiveOutletId],
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
        o.outlet_id = $1
        AND o.deleted_at IS NULL
        AND o.source = 'phone'
      `,
      whereParams: [req.effectiveOutletId],
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
      WHERE o.outlet_id = $1
        AND o.deleted_at IS NULL
      `,
      [req.effectiveOutletId]
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
      WHERE o.outlet_id = $1
        AND o.deleted_at IS NULL
      ORDER BY r.created_at DESC
      LIMIT $2
      OFFSET $3
      `,
      [req.effectiveOutletId, pagination.page_size, pagination.offset]
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
