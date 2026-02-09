const express = require('express');
const router = express.Router();
const { store } = require('../services/store');

// GET /api/products
router.get('/', (req, res) => {
  // Get all products
  res.json({ data: store.products });
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  // Get product by ID
  const id = Number(req.params.id);
  const product = store.products.find((p) => p.id === id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  return res.json({ data: product });
});

// POST /api/products
router.post('/', (req, res) => {
  // Create new product
  const { name, sku, price, stock } = req.body || {};
  if (!name || typeof price !== 'number') {
    return res.status(400).json({ error: 'name and numeric price are required' });
  }
  const product = {
    id: store.products.length + 1,
    name,
    sku: sku || null,
    price,
    stock: typeof stock === 'number' ? stock : null,
  };
  store.products.push(product);
  return res.status(201).json({ data: product });
});

// PUT /api/products/:id
router.put('/:id', (req, res) => {
  // Update product
  const id = Number(req.params.id);
  const product = store.products.find((p) => p.id === id);
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  const { name, sku, price, stock } = req.body || {};
  if (name) product.name = name;
  if (typeof sku === 'string') product.sku = sku;
  if (typeof price === 'number') product.price = price;
  if (typeof stock === 'number') product.stock = stock;
  product.updatedAt = new Date().toISOString();
  return res.json({ data: product });
});

// DELETE /api/products/:id
router.delete('/:id', (req, res) => {
  // Delete product
  const id = Number(req.params.id);
  const index = store.products.findIndex((p) => p.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Product not found' });
  }
  const deleted = store.products.splice(index, 1)[0];
  return res.json({ data: deleted });
});

module.exports = router;
