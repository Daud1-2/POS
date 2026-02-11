const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const db = require('./services/db');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const salesRoutes = require('./routes/sales');
const dashboardRoutes = require('./routes/dashboard');
const ordersRoutes = require('./routes/orders');
const authClaims = require('./middleware/authClaims');
const outletScope = require('./middleware/outletScope');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

app.get('/api/health', (req, res) => {
  res.json({ status: 'POS Backend is running' });
});

app.get('/api/health/db', async (req, res, next) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    next(err);
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/products', authClaims, outletScope, productRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/dashboard', authClaims, outletScope, dashboardRoutes);
app.use('/api/orders', authClaims, outletScope, ordersRoutes);

app.use((err, req, res, next) => {
  console.error(err.stack);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Uploaded file exceeds max size (500KB)' });
  }
  const statusCode = err.statusCode || err.status || 500;
  return res.status(statusCode).json({ error: err.message || 'Something went wrong' });
});

module.exports = app;
