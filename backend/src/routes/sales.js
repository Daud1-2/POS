const express = require('express');
const router = express.Router();
const db = require('../services/db');

const ALLOWED_PAYMENT_METHODS = new Set(['cash', 'credit']);
const ALLOWED_ORDER_TYPES = new Set(['dine_in', 'takeaway', 'delivery']);
const ALLOWED_STATUSES = new Set(['new', 'preparing', 'ready', 'completed', 'rejected']);
const ALLOWED_SOURCES = new Set(['pos', 'website', 'app']);

const toPositiveInt = (value) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
};

// GET /api/sales
router.get('/', (req, res) => {
  // Get recent orders
  db.query('SELECT * FROM orders ORDER BY created_at DESC LIMIT 100')
    .then((result) => res.json({ data: result.rows }))
    .catch((err) => res.status(500).json({ error: err.message }));
});

// POST /api/sales
router.post('/', async (req, res, next) => {
  const {
    items,
    paymentMethod,
    cashierId,
    customerId,
    orderType,
    branchId,
    source,
    status,
    discount,
    tax,
  } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items are required' });
  }
  if (!ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
    return res.status(400).json({ error: 'paymentMethod must be cash or credit' });
  }
  if (!toPositiveInt(cashierId)) {
    return res.status(400).json({ error: 'cashierId is required' });
  }
  if (orderType && !ALLOWED_ORDER_TYPES.has(orderType)) {
    return res.status(400).json({ error: 'orderType must be dine_in, takeaway, or delivery' });
  }
  if (source && !ALLOWED_SOURCES.has(source)) {
    return res.status(400).json({ error: 'source must be pos, website, or app' });
  }
  if (status && !ALLOWED_STATUSES.has(status)) {
    return res.status(400).json({ error: 'status must be new, preparing, ready, completed, or rejected' });
  }
  if (discount !== undefined && (typeof discount !== 'number' || discount < 0)) {
    return res.status(400).json({ error: 'discount must be a non-negative number' });
  }
  if (tax !== undefined && (typeof tax !== 'number' || tax < 0)) {
    return res.status(400).json({ error: 'tax must be a non-negative number' });
  }

  try {
    const normalizedItems = [];
    for (const item of items) {
      const productId = toPositiveInt(item.productId);
      const quantity = toPositiveInt(item.quantity);
      if (!productId || !quantity) {
        return res.status(400).json({ error: 'each item requires productId and positive integer quantity' });
      }
      normalizedItems.push({ productId, quantity });
    }

    const client = await db.getClient();
    const discountValue = typeof discount === 'number' ? discount : 0;
    const taxValue = typeof tax === 'number' ? tax : 0;
    const finalStatus = status || 'completed';
    const normalizedOrderType = orderType || 'takeaway';
    const normalizedSource = source || 'pos';
    const payment = paymentMethod === 'credit' ? 'card' : 'cash';
    const completedAt = finalStatus === 'completed' ? new Date() : null;

    try {
      await client.query('BEGIN');

      const orderItems = [];
      for (const item of normalizedItems) {
        const productResult = await client.query(
          `
          SELECT id, name, price, stock, is_active
          FROM products
          WHERE id = $1
          FOR UPDATE
          `,
          [item.productId]
        );
        const product = productResult.rows[0];

        if (!product || !product.is_active) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `productId ${item.productId} not found` });
        }

        if (Number(product.stock) < item.quantity) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `insufficient stock for productId ${item.productId}` });
        }

        const unitPrice = Number(product.price);
        orderItems.push({
          productId: Number(product.id),
          productName: product.name,
          unitPrice,
          quantity: item.quantity,
          totalPrice: unitPrice * item.quantity,
        });
      }

      const subtotal = orderItems.reduce((sum, item) => sum + item.totalPrice, 0);
      const totalAmount = subtotal - discountValue + taxValue;
      if (totalAmount < 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'total amount cannot be negative' });
      }

      const orderResult = await client.query(
        `
        INSERT INTO orders (
          branch_id,
          order_type,
          status,
          subtotal,
          discount,
          tax,
          total_amount,
          source,
          payment_method,
          cashier_id,
          customer_id,
          created_at,
          completed_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now(), $12)
        RETURNING order_id
        `,
        [
          branchId || null,
          normalizedOrderType,
          finalStatus,
          subtotal,
          discountValue,
          taxValue,
          totalAmount,
          normalizedSource,
          payment,
          toPositiveInt(cashierId),
          customerId || null,
          completedAt,
        ]
      );
      const orderId = orderResult.rows[0].order_id;

      for (const item of orderItems) {
        await client.query(
          `
          INSERT INTO order_items (
            order_id,
            product_id,
            product_name,
            unit_price,
            quantity,
            total_price,
            created_at
          ) VALUES ($1,$2,$3,$4,$5,$6, now())
          `,
          [
            orderId,
            item.productId,
            item.productName,
            item.unitPrice,
            item.quantity,
            item.totalPrice,
          ]
        );

        await client.query(
          `
          UPDATE products
          SET stock = stock - $1, updated_at = now()
          WHERE id = $2
          `,
          [item.quantity, item.productId]
        );
      }

      await client.query('COMMIT');

      return res.status(201).json({
        data: {
          order_id: orderId,
          total_amount: totalAmount,
          status: finalStatus,
        },
      });
    } catch (err) {
      await client.query('ROLLBACK');
      return next(err);
    } finally {
      client.release();
    }
  } catch (err) {
    return next(err);
  }
});

// GET /api/sales/report
router.get('/report', (req, res) => {
  db.query(
    `
    SELECT
      COUNT(*) AS count,
      COALESCE(SUM(subtotal), 0) AS subtotal,
      COALESCE(SUM(tax), 0) AS tax,
      COALESCE(SUM(total_amount), 0) AS total
    FROM orders
    WHERE status = 'completed'
    `
  )
    .then((result) => res.json({ data: result.rows[0] }))
    .catch((err) => res.status(500).json({ error: err.message }));
});

module.exports = router;
