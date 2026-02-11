const express = require('express');
const router = express.Router();
const db = require('../services/db');

const RANGE_PRESETS = new Set(['today', '30d', 'overall']);

const buildRangeClause = (range, column = 'created_at') => {
  if (!RANGE_PRESETS.has(range)) {
    return { clause: '1=1', params: [] };
  }
  if (range === 'today') {
    return {
      clause: `( ${column} AT TIME ZONE 'Asia/Karachi')::date = (now() AT TIME ZONE 'Asia/Karachi')::date`,
      params: [],
    };
  }
  if (range === '30d') {
    return {
      clause: `${column} >= now() - interval '30 days'`,
      params: [],
    };
  }
  return { clause: '1=1', params: [] };
};

router.get('/summary', async (req, res, next) => {
  try {
    const range = req.query.range || 'today';
    const { clause } = buildRangeClause(range);

    const summaryResult = await db.query(
      `
      SELECT
        COALESCE(SUM(total_amount), 0) AS total_sales,
        COUNT(*) AS total_orders,
        SUM(CASE WHEN source = 'website' THEN 1 ELSE 0 END) AS web_orders,
        COALESCE(SUM(CASE WHEN source = 'website' THEN total_amount ELSE 0 END), 0) AS web_sales,
        COALESCE(AVG(total_amount), 0) AS avg_order_value,
        COALESCE(MAX(total_amount), 0) AS highest_order_value
      FROM orders
      WHERE status = 'completed' AND ${clause}
      `
    );

    const customerCountResult = await db.query(
      `
      SELECT COUNT(*) AS count
      FROM orders
      WHERE status = 'completed'
        AND customer_id IS NOT NULL
        AND ${clause}
      `
    );

    let newVsOld = null;
    if (Number(customerCountResult.rows[0].count) > 0) {
      const newOldResult = await db.query(
        `
        SELECT
          SUM(CASE WHEN order_rank = 1 THEN 1 ELSE 0 END) AS new_orders,
          SUM(CASE WHEN order_rank > 1 THEN 1 ELSE 0 END) AS old_orders
        FROM (
          SELECT
            order_id,
            ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY created_at) AS order_rank
          FROM orders
          WHERE status = 'completed'
            AND customer_id IS NOT NULL
            AND ${clause}
        ) ranked
        `
      );
      const newOrders = Number(newOldResult.rows[0].new_orders || 0);
      const oldOrders = Number(newOldResult.rows[0].old_orders || 0);
      const total = newOrders + oldOrders || 1;
      newVsOld = {
        new_pct: Number(((newOrders / total) * 100).toFixed(2)),
        old_pct: Number(((oldOrders / total) * 100).toFixed(2)),
      };
    }

    res.json({
      data: {
        range,
        total_sales: Number(summaryResult.rows[0].total_sales),
        total_orders: Number(summaryResult.rows[0].total_orders),
        web_orders: Number(summaryResult.rows[0].web_orders),
        web_sales: Number(summaryResult.rows[0].web_sales),
        avg_order_value: Number(summaryResult.rows[0].avg_order_value),
        highest_order_value: Number(summaryResult.rows[0].highest_order_value),
        new_vs_old: newVsOld,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/sales-trend', async (req, res, next) => {
  try {
    const range = req.query.range || 'today';
    const { clause } = buildRangeClause(range);
    const groupBy =
      range === 'today'
        ? `date_trunc('hour', created_at AT TIME ZONE 'Asia/Karachi')`
        : `date_trunc('day', created_at AT TIME ZONE 'Asia/Karachi')`;

    const result = await db.query(
      `
      SELECT
        ${groupBy} AS bucket,
        COUNT(*) AS order_count,
        SUM(CASE WHEN source = 'website' THEN 1 ELSE 0 END) AS web_order_count,
        COALESCE(SUM(CASE WHEN source = 'website' THEN total_amount ELSE 0 END), 0) AS web_sales_total,
        COALESCE(SUM(total_amount), 0) AS sales_total
      FROM orders
      WHERE status = 'completed' AND ${clause}
      GROUP BY bucket
      ORDER BY bucket ASC
      `
    );

    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/rejected-trend', async (req, res, next) => {
  try {
    const range = req.query.range || '30d';
    const { clause } = buildRangeClause(range);

    const result = await db.query(
      `
      SELECT
        date_trunc('day', created_at AT TIME ZONE 'Asia/Karachi') AS bucket,
        COUNT(*) AS rejected_count
      FROM orders
      WHERE status = 'rejected' AND ${clause}
      GROUP BY bucket
      ORDER BY bucket ASC
      `
    );

    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/heatmap', async (req, res, next) => {
  try {
    const range = req.query.range || '30d';
    const { clause } = buildRangeClause(range);

    const result = await db.query(
      `
      SELECT
        EXTRACT(DOW FROM created_at AT TIME ZONE 'Asia/Karachi') AS day_of_week,
        EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Karachi') AS hour,
        COUNT(*) AS order_count
      FROM orders
      WHERE status = 'completed' AND ${clause}
      GROUP BY day_of_week, hour
      ORDER BY day_of_week, hour
      `
    );

    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/top-products', async (req, res, next) => {
  try {
    const range = req.query.range || '30d';
    const limit = Number(req.query.limit) || 10;
    const { clause } = buildRangeClause(range, 'o.created_at');

    const result = await db.query(
      `
      SELECT
        oi.product_id,
        oi.product_name,
        SUM(oi.quantity) AS unit_sold,
        COALESCE(SUM(oi.total_price), 0) AS total_sales,
        CASE
          WHEN SUM(oi.quantity) > 0 THEN ROUND(SUM(oi.total_price) / SUM(oi.quantity), 2)
          ELSE 0
        END AS avg_price
      FROM order_items oi
      JOIN orders o ON o.order_id = oi.order_id
      WHERE o.status = 'completed' AND ${clause}
      GROUP BY oi.product_id, oi.product_name
      ORDER BY unit_sold DESC
      LIMIT $1
      `,
      [limit]
    );

    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get('/channel-contribution', async (req, res, next) => {
  try {
    const range = req.query.range || '30d';
    const { clause } = buildRangeClause(range);

    const result = await db.query(
      `
      SELECT
        order_type,
        COALESCE(SUM(total_amount), 0) AS total_sales
      FROM orders
      WHERE status = 'completed' AND ${clause}
      GROUP BY order_type
      `
    );

    const total = result.rows.reduce((acc, row) => acc + Number(row.total_sales), 0) || 1;
    const data = result.rows.map((row) => ({
      order_type: row.order_type,
      total_sales: Number(row.total_sales),
      percent: Number(((Number(row.total_sales) / total) * 100).toFixed(2)),
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

router.get('/payment-type', async (req, res, next) => {
  try {
    const range = req.query.range || '30d';
    const { clause } = buildRangeClause(range);

    const result = await db.query(
      `
      SELECT
        payment_method,
        COUNT(*) AS order_count,
        COALESCE(SUM(total_amount), 0) AS total_sales
      FROM orders
      WHERE status = 'completed' AND ${clause}
      GROUP BY payment_method
      `
    );

    const totalOrders = result.rows.reduce((acc, row) => acc + Number(row.order_count), 0) || 1;
    const data = result.rows.map((row) => ({
      payment_method: row.payment_method,
      label: row.payment_method === 'cash' ? 'COD' : 'CARD',
      order_count: Number(row.order_count),
      total_sales: Number(row.total_sales),
      percent: Number(((Number(row.order_count) / totalOrders) * 100).toFixed(2)),
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
