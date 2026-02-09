const express = require('express');
const router = express.Router();
const { store, buildSale } = require('../services/store');

// GET /api/sales
router.get('/', (req, res) => {
  // Get all sales
  res.json({ data: store.sales });
});

// POST /api/sales
router.post('/', (req, res) => {
  // Create new sale/transaction
  const { items, paymentMethod, cashierId, customerId } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items are required' });
  }
  if (!['cash', 'credit'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'paymentMethod must be cash or credit' });
  }
  if (!cashierId) {
    return res.status(400).json({ error: 'cashierId is required' });
  }

  for (const item of items) {
    if (!item.productId || typeof item.quantity !== 'number' || item.quantity <= 0) {
      return res.status(400).json({ error: 'each item requires productId and positive quantity' });
    }
    const product = store.products.find((p) => p.id === item.productId);
    if (!product) {
      return res.status(400).json({ error: `productId ${item.productId} not found` });
    }
    if (typeof product.stock === 'number' && product.stock < item.quantity) {
      return res.status(400).json({ error: `insufficient stock for productId ${item.productId}` });
    }
  }

  const sale = buildSale({ items, paymentMethod, cashierId, customerId });
  return res.status(201).json({ data: sale });
});

// GET /api/sales/report
router.get('/report', (req, res) => {
  // Get sales report
  const totals = store.sales.reduce(
    (acc, sale) => {
      acc.count += 1;
      acc.subtotal += sale.subtotal;
      acc.tax += sale.tax;
      acc.total += sale.total;
      return acc;
    },
    { count: 0, subtotal: 0, tax: 0, total: 0 }
  );
  res.json({ data: totals });
});

module.exports = router;
