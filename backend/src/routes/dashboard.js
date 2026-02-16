const express = require('express');
const db = require('../services/db');
const { getDailyShiftSummary } = require('../services/shiftService');

const router = express.Router();

const ALLOWED_RANGES = new Set(['day', 'month']);
const DEFAULT_TIMEZONE = 'Asia/Karachi';

const toNumber = (value) => Number(value || 0);

const normalizeRange = (rangeValue, fallback = 'day') => (
  ALLOWED_RANGES.has(rangeValue) ? rangeValue : fallback
);

const buildRangeClause = (range, column = 'created_at') => {
  if (range === 'day') {
    return `timezone($2, ${column})::date = timezone($2, now())::date`;
  }
  return `date_trunc('month', timezone($2, ${column})) = date_trunc('month', timezone($2, now()))`;
};

const getBucketExpression = (range, column = 'created_at') => (
  range === 'day'
    ? `date_trunc('hour', timezone($2, ${column}))`
    : `date_trunc('day', timezone($2, ${column}))`
);

router.get('/summary', async (req, res, next) => {
  try {
    const range = normalizeRange(req.query.range, 'day');
    const rangeClause = buildRangeClause(range, 'created_at');
    const params = [req.effectiveBranchIds, req.effectiveTimezone || DEFAULT_TIMEZONE];

    const summaryResult = await db.query(
      `
      SELECT
        COALESCE(SUM(total), 0) AS total_sales,
        COUNT(*) AS total_orders,
        SUM(CASE WHEN order_channel IN ('online', 'whatsapp', 'delivery_platform') THEN 1 ELSE 0 END) AS online_orders,
        COALESCE(SUM(CASE WHEN order_channel IN ('online', 'whatsapp', 'delivery_platform') THEN total ELSE 0 END), 0) AS online_sales,
        COALESCE(AVG(total), 0) AS avg_order_value,
        COALESCE(MAX(total), 0) AS highest_order_value
      FROM orders
      WHERE outlet_id = ANY($1::int[])
        AND deleted_at IS NULL
        AND status = 'completed'
        AND ${rangeClause}
      `,
      params
    );

    const customerCountResult = await db.query(
      `
      SELECT COUNT(*) AS count
      FROM orders
      WHERE outlet_id = ANY($1::int[])
        AND deleted_at IS NULL
        AND status = 'completed'
        AND customer_id IS NOT NULL
        AND ${rangeClause}
      `,
      params
    );

    let newVsOld = null;
    if (toNumber(customerCountResult.rows[0]?.count) > 0) {
      const newOldResult = await db.query(
        `
        WITH ranked AS (
          SELECT
            customer_id,
            created_at,
            ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at) AS order_rank
          FROM orders
          WHERE outlet_id = ANY($1::int[])
            AND deleted_at IS NULL
            AND status = 'completed'
            AND customer_id IS NOT NULL
        ),
        in_window AS (
          SELECT *
          FROM ranked
          WHERE ${rangeClause}
        )
        SELECT
          SUM(CASE WHEN order_rank = 1 THEN 1 ELSE 0 END) AS new_orders,
          SUM(CASE WHEN order_rank > 1 THEN 1 ELSE 0 END) AS old_orders
        FROM in_window
        `,
        params
      );

      const newOrders = toNumber(newOldResult.rows[0]?.new_orders);
      const oldOrders = toNumber(newOldResult.rows[0]?.old_orders);
      const totalOrders = newOrders + oldOrders;

      newVsOld = totalOrders > 0
        ? {
            new_pct: Number(((newOrders / totalOrders) * 100).toFixed(2)),
            old_pct: Number(((oldOrders / totalOrders) * 100).toFixed(2)),
          }
        : null;
    }

    return res.json({
      data: {
        range,
        total_sales: toNumber(summaryResult.rows[0]?.total_sales),
        total_orders: toNumber(summaryResult.rows[0]?.total_orders),
        online_orders: toNumber(summaryResult.rows[0]?.online_orders),
        online_sales: toNumber(summaryResult.rows[0]?.online_sales),
        web_orders: toNumber(summaryResult.rows[0]?.online_orders),
        web_sales: toNumber(summaryResult.rows[0]?.online_sales),
        avg_order_value: toNumber(summaryResult.rows[0]?.avg_order_value),
        highest_order_value: toNumber(summaryResult.rows[0]?.highest_order_value),
        new_vs_old: newVsOld,
      },
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/shift-summary', async (req, res, next) => {
  try {
    const summary = await getDailyShiftSummary({
      outletIds: req.effectiveBranchIds,
      timezone: req.effectiveTimezone || DEFAULT_TIMEZONE,
    });
    return res.json({ data: summary });
  } catch (err) {
    return next(err);
  }
});

router.get('/sales-trend', async (req, res, next) => {
  try {
    const range = normalizeRange(req.query.range, 'month');
    const rangeClause = buildRangeClause(range, 'created_at');
    const bucketExpr = getBucketExpression(range, 'created_at');

    const result = await db.query(
      `
      SELECT
        ${bucketExpr} AS bucket,
        COUNT(*) AS order_count,
        SUM(CASE WHEN order_channel IN ('online', 'whatsapp', 'delivery_platform') THEN 1 ELSE 0 END) AS online_order_count,
        COALESCE(SUM(CASE WHEN order_channel IN ('online', 'whatsapp', 'delivery_platform') THEN total ELSE 0 END), 0) AS online_sales_total,
        COALESCE(SUM(total), 0) AS sales_total
      FROM orders
      WHERE outlet_id = ANY($1::int[])
        AND deleted_at IS NULL
        AND status = 'completed'
        AND ${rangeClause}
      GROUP BY bucket
      ORDER BY bucket ASC
      `,
      [req.effectiveBranchIds, req.effectiveTimezone || DEFAULT_TIMEZONE]
    );

    return res.json({
      data: result.rows.map((row) => ({
        ...row,
        order_count: toNumber(row.order_count),
        online_order_count: toNumber(row.online_order_count),
        online_sales_total: toNumber(row.online_sales_total),
        web_order_count: toNumber(row.online_order_count),
        web_sales_total: toNumber(row.online_sales_total),
        sales_total: toNumber(row.sales_total),
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/rejected-trend', async (req, res, next) => {
  try {
    const range = normalizeRange(req.query.range, 'month');
    const rangeClause = buildRangeClause(range, 'created_at');
    const bucketExpr = getBucketExpression(range, 'created_at');
    const params = [req.effectiveBranchIds, req.effectiveTimezone || DEFAULT_TIMEZONE];

    const avgResult = await db.query(
      `
      SELECT COALESCE(AVG(total), 0) AS avg_completed_total
      FROM orders
      WHERE outlet_id = ANY($1::int[])
        AND deleted_at IS NULL
        AND status = 'completed'
        AND ${rangeClause}
      `,
      params
    );
    const avgCompletedTotal = toNumber(avgResult.rows[0]?.avg_completed_total);

    const result = await db.query(
      `
      SELECT
        ${bucketExpr} AS bucket,
        COUNT(*) AS rejected_count
      FROM orders
      WHERE outlet_id = ANY($1::int[])
        AND deleted_at IS NULL
        AND status IN ('cancelled', 'rejected')
        AND ${rangeClause}
      GROUP BY bucket
      ORDER BY bucket ASC
      `,
      params
    );

    return res.json({
      data: result.rows.map((row) => {
        const rejectedCount = toNumber(row.rejected_count);
        return {
          ...row,
          rejected_count: rejectedCount,
          loss_of_business: Number((rejectedCount * avgCompletedTotal).toFixed(2)),
        };
      }),
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/heatmap', async (req, res, next) => {
  try {
    const range = normalizeRange(req.query.range, 'month');
    const rangeClause = buildRangeClause(range, 'created_at');

    const result = await db.query(
      `
      SELECT
        EXTRACT(DOW FROM timezone($2, created_at)) AS day_of_week,
        EXTRACT(HOUR FROM timezone($2, created_at)) AS hour,
        COUNT(*) AS order_count
      FROM orders
      WHERE outlet_id = ANY($1::int[])
        AND deleted_at IS NULL
        AND status = 'completed'
        AND ${rangeClause}
      GROUP BY day_of_week, hour
      ORDER BY day_of_week ASC, hour ASC
      `,
      [req.effectiveBranchIds, req.effectiveTimezone || DEFAULT_TIMEZONE]
    );

    return res.json({
      data: result.rows.map((row) => ({
        ...row,
        day_of_week: toNumber(row.day_of_week),
        hour: toNumber(row.hour),
        order_count: toNumber(row.order_count),
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/top-products', async (req, res, next) => {
  try {
    const range = normalizeRange(req.query.range, 'month');
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    const rangeClause = buildRangeClause(range, 'o.created_at');

    const result = await db.query(
      `
      SELECT
        oi.product_id,
        COALESCE(MAX(oi.product_name), MAX(p.name), 'Unknown') AS product_name,
        SUM(oi.quantity) AS unit_sold,
        COALESCE(SUM(oi.total_price), 0) AS total_sales,
        CASE
          WHEN SUM(oi.quantity) > 0 THEN ROUND(SUM(oi.total_price) / SUM(oi.quantity), 2)
          ELSE 0
        END AS avg_price
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id
      WHERE o.outlet_id = ANY($1::int[])
        AND o.deleted_at IS NULL
        AND o.status = 'completed'
        AND ${rangeClause}
      GROUP BY oi.product_id
      ORDER BY unit_sold DESC
      LIMIT $3
      `,
      [req.effectiveBranchIds, req.effectiveTimezone || DEFAULT_TIMEZONE, limit]
    );

    return res.json({
      data: result.rows.map((row) => ({
        ...row,
        unit_sold: toNumber(row.unit_sold),
        total_sales: toNumber(row.total_sales),
        avg_price: toNumber(row.avg_price),
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/channel-contribution', async (req, res, next) => {
  try {
    const range = normalizeRange(req.query.range, 'month');
    const rangeClause = buildRangeClause(range, 'created_at');

    const result = await db.query(
      `
      SELECT
        order_type,
        COUNT(*) AS order_count,
        COALESCE(SUM(total), 0) AS total_sales
      FROM orders
      WHERE outlet_id = ANY($1::int[])
        AND deleted_at IS NULL
        AND status = 'completed'
        AND ${rangeClause}
      GROUP BY order_type
      `,
      [req.effectiveBranchIds, req.effectiveTimezone || DEFAULT_TIMEZONE]
    );

    const totalOrders = result.rows.reduce((sum, row) => sum + toNumber(row.order_count), 0);
    const denominator = totalOrders === 0 ? 1 : totalOrders;

    return res.json({
      data: result.rows.map((row) => ({
        order_type: row.order_type,
        order_count: toNumber(row.order_count),
        total_sales: toNumber(row.total_sales),
        percent: Number(((toNumber(row.order_count) / denominator) * 100).toFixed(2)),
      })),
    });
  } catch (err) {
    return next(err);
  }
});

router.get('/payment-type', async (req, res, next) => {
  try {
    const range = normalizeRange(req.query.range, 'month');
    const rangeClause = buildRangeClause(range, 'created_at');

    const result = await db.query(
      `
      SELECT
        payment_method,
        COUNT(*) AS order_count,
        COALESCE(SUM(total), 0) AS total_sales
      FROM orders
      WHERE outlet_id = ANY($1::int[])
        AND deleted_at IS NULL
        AND status = 'completed'
        AND ${rangeClause}
      GROUP BY payment_method
      `,
      [req.effectiveBranchIds, req.effectiveTimezone || DEFAULT_TIMEZONE]
    );

    const totalOrders = result.rows.reduce((sum, row) => sum + toNumber(row.order_count), 0);
    const denominator = totalOrders === 0 ? 1 : totalOrders;

    return res.json({
      data: result.rows.map((row) => ({
        payment_method: row.payment_method,
        order_count: toNumber(row.order_count),
        total_sales: toNumber(row.total_sales),
        percent: Number(((toNumber(row.order_count) / denominator) * 100).toFixed(2)),
      })),
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

