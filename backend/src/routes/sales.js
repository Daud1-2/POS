const express = require('express');
const db = require('../services/db');
const { createOrder, ValidationError } = require('../services/ordersService');

const router = express.Router();

const toPositiveInt = (value) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
};

// GET /api/sales
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(
      `
      SELECT
        id,
        legacy_order_id,
        order_number,
        source,
        order_type,
        status,
        subtotal,
        tax,
        discount,
        total,
        payment_method,
        payment_status,
        outlet_id,
        customer_id,
        created_at,
        completed_at
      FROM orders
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 100
      `
    );
    return res.json({ data: result.rows });
  } catch (err) {
    return next(err);
  }
});

// POST /api/sales (compatibility alias)
router.post('/', async (req, res, next) => {
  try {
    const body = req.body || {};
    const cashierId = toPositiveInt(body.cashierId);
    if (!cashierId) {
      return res.status(400).json({ error: 'cashierId is required' });
    }

    const paymentMethod = body.paymentMethod === 'credit' ? 'card' : body.paymentMethod;

    const created = await createOrder(
      {
        items: body.items || [],
        payment_method: paymentMethod,
        payment_status: body.paymentStatus || (paymentMethod === 'cash' ? 'paid' : 'unpaid'),
        customer_id: body.customerId || null,
        order_type: body.orderType || 'takeaway',
        outlet_id: body.branchId || body.outletId || 1,
        source: body.source === 'app' ? 'kiosk' : body.source || 'pos',
        status: body.status || 'completed',
        discount: body.discount ?? 0,
        tax: body.tax ?? 0,
        metadata: {
          cashier_id: cashierId,
          compatibility_route: '/api/sales',
        },
      },
      {
        outletId: body.branchId || body.outletId || 1,
        actorId: String(cashierId),
      }
    );

    return res.status(201).json({
      data: {
        order_id: created.id,
        legacy_order_id: created.legacy_order_id,
        total_amount: created.total,
        status: created.status,
      },
    });
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

// GET /api/sales/report
router.get('/report', async (req, res, next) => {
  try {
    const result = await db.query(
      `
      SELECT
        COUNT(*) AS count,
        COALESCE(SUM(subtotal), 0) AS subtotal,
        COALESCE(SUM(tax), 0) AS tax,
        COALESCE(SUM(total), 0) AS total
      FROM orders
      WHERE deleted_at IS NULL
        AND status = 'completed'
      `
    );
    return res.json({ data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
