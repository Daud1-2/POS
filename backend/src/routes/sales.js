const express = require('express');
const db = require('../services/db');
const { createOrder, ValidationError } = require('../services/ordersService');

const router = express.Router();

const toPositiveInt = (value) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
};

const resolveBodyBranch = (body = {}) =>
  toPositiveInt(body.branch_id) || toPositiveInt(body.branchId) || null;

const normalizeLegacySource = (value) => {
  const source = String(value || 'pos').trim().toLowerCase();
  if (source === 'app') return 'kiosk';
  return source;
};

const mapSourceToChannel = (source) => {
  if (source === 'website') return 'online';
  return 'pos';
};

const buildCompatibilityCustomer = (body = {}) => {
  if (body.customer && typeof body.customer === 'object') {
    return body.customer;
  }

  const name = typeof body.customerName === 'string' ? body.customerName.trim() : null;
  const phone = typeof body.customerPhone === 'string' ? body.customerPhone.trim() : null;
  const email = typeof body.customerEmail === 'string' ? body.customerEmail.trim() : null;
  const id = toPositiveInt(body.customerId);

  if (!id && !name && !phone && !email) {
    return null;
  }

  return {
    id: id || undefined,
    name: name || undefined,
    phone: phone || undefined,
    email: email || undefined,
    type: body.customerType || 'guest',
  };
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
        order_channel,
        order_type,
        status,
        subtotal,
        tax,
        discount,
        total,
        payment_method,
        payment_status,
        outlet_id AS branch_id,
        customer_id,
        created_at,
        completed_at,
        refunded_at
      FROM orders
      WHERE deleted_at IS NULL
        AND outlet_id = ANY($1::int[])
      ORDER BY created_at DESC
      LIMIT 100
      `,
      [req.effectiveBranchIds]
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

    let scopedBranchId = req.effectiveBranchId;
    const requestedBranch = resolveBodyBranch(body);
    if (req.branchScope === 'all') {
      if (!requestedBranch) {
        return res.status(400).json({ error: 'branch_id is required when using all-branch admin scope' });
      }
      const allowed = Array.isArray(req.effectiveBranchIds) ? req.effectiveBranchIds : [];
      if (!allowed.includes(requestedBranch)) {
        return res.status(403).json({ error: 'Branch is not in admin scope' });
      }
      scopedBranchId = requestedBranch;
    } else if (requestedBranch && requestedBranch !== req.effectiveBranchId) {
      return res.status(403).json({ error: 'Cross-branch access denied' });
    }

    const paymentMethod = body.paymentMethod === 'credit' ? 'card' : body.paymentMethod;
    const customer = buildCompatibilityCustomer(body);
    const source = normalizeLegacySource(body.source || 'pos');
    const orderChannel = String(body.order_channel || body.orderChannel || mapSourceToChannel(source)).toLowerCase();
    const status = String(body.status || (orderChannel === 'pos' ? 'pending' : 'new')).toLowerCase();

    const created = await createOrder(
      {
        items: body.items || [],
        payment_method: paymentMethod,
        payment_status: body.paymentStatus || (paymentMethod === 'cash' ? 'paid' : 'unpaid'),
        customer_id: body.customerId || null,
        customer,
        order_type: body.orderType || 'takeaway',
        branch_id: scopedBranchId,
        source,
        order_channel: orderChannel,
        status,
        tax: body.tax ?? 0,
        promo_code: body.promoCode || body.promo_code || null,
        metadata: {
          cashier_id: cashierId,
          compatibility_route: '/api/sales',
        },
      },
      {
        branchId: scopedBranchId,
        actorId: String(cashierId),
        role: req.user?.role || 'cashier',
      }
    );

    return res.status(201).json({
      data: {
        order_id: created.id,
        legacy_order_id: created.legacy_order_id,
        total_amount: created.total,
        order_channel: created.order_channel,
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
        AND outlet_id = ANY($1::int[])
      `,
      [req.effectiveBranchIds]
    );
    return res.json({ data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

