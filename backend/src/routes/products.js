const express = require('express');
const router = express.Router();
const db = require('../services/db');

// GET /api/products
router.get('/', async (req, res, next) => {
  try {
    const result = await db.query(
      `
      SELECT id, name, sku, price, stock, is_active, created_at, updated_at
      FROM products
      ORDER BY id DESC
      `
    );
    res.json({ data: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid product id' });
  }

  try {
    const result = await db.query(
      `
      SELECT id, name, sku, price, stock, is_active, created_at, updated_at
      FROM products
      WHERE id = $1
      `,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Product not found' });
    }

    return res.json({ data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

// POST /api/products
router.post('/', async (req, res, next) => {
  const { name, sku, price, stock, isActive } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!sku || typeof sku !== 'string') {
    return res.status(400).json({ error: 'sku is required' });
  }
  if (typeof price !== 'number' || price < 0) {
    return res.status(400).json({ error: 'price must be a non-negative number' });
  }
  if (stock !== undefined && (!Number.isInteger(stock) || stock < 0)) {
    return res.status(400).json({ error: 'stock must be a non-negative integer' });
  }

  try {
    const result = await db.query(
      `
      INSERT INTO products (name, sku, price, stock, is_active, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, now(), now())
      RETURNING id, name, sku, price, stock, is_active, created_at, updated_at
      `,
      [name.trim(), sku.trim(), price, stock ?? 0, isActive ?? true]
    );
    return res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'sku already exists' });
    }
    return next(err);
  }
});

// PUT /api/products/:id
router.put('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid product id' });
  }

  const { name, sku, price, stock, isActive } = req.body || {};
  if (price !== undefined && (typeof price !== 'number' || price < 0)) {
    return res.status(400).json({ error: 'price must be a non-negative number' });
  }
  if (stock !== undefined && (!Number.isInteger(stock) || stock < 0)) {
    return res.status(400).json({ error: 'stock must be a non-negative integer' });
  }

  try {
    const current = await db.query('SELECT id FROM products WHERE id = $1', [id]);
    if (!current.rows[0]) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const result = await db.query(
      `
      UPDATE products
      SET
        name = COALESCE($2, name),
        sku = COALESCE($3, sku),
        price = COALESCE($4, price),
        stock = COALESCE($5, stock),
        is_active = COALESCE($6, is_active),
        updated_at = now()
      WHERE id = $1
      RETURNING id, name, sku, price, stock, is_active, created_at, updated_at
      `,
      [
        id,
        typeof name === 'string' ? name.trim() : null,
        typeof sku === 'string' ? sku.trim() : null,
        price ?? null,
        stock ?? null,
        isActive ?? null,
      ]
    );

    return res.json({ data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'sku already exists' });
    }
    return next(err);
  }
});

// DELETE /api/products/:id
router.delete('/:id', async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid product id' });
  }

  try {
    const result = await db.query(
      `
      DELETE FROM products
      WHERE id = $1
      RETURNING id, name, sku, price, stock, is_active, created_at, updated_at
      `,
      [id]
    );

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Product not found' });
    }

    return res.json({ data: result.rows[0] });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
