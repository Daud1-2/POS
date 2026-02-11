process.env.ALLOW_DEV_AUTH_BYPASS = 'true';

const request = require('supertest');

jest.mock('../src/services/db', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/ordersService', () => {
  class ValidationError extends Error {
    constructor(message) {
      super(message);
      this.statusCode = 400;
    }
  }

  return {
    createOrder: jest.fn(),
    updateOrderStatus: jest.fn(),
    ValidationError,
  };
});

const db = require('../src/services/db');
const { createOrder, updateOrderStatus } = require('../src/services/ordersService');
const app = require('../src/app');

describe('orders routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns paginated live orders', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({
        rows: [
          { id: '1', order_number: 'ORD-1', status: 'open', total: '100.00' },
          { id: '2', order_number: 'ORD-2', status: 'ready', total: '250.00' },
        ],
      });

    const res = await request(app)
      .get('/api/orders/live')
      .query({ outlet_id: 1, page: 1, page_size: 2 });

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({
      page: 1,
      page_size: 2,
      total: 2,
      total_pages: 1,
    });
    expect(res.body.data).toHaveLength(2);
  });

  test('creates order via POST /api/orders', async () => {
    createOrder.mockResolvedValue({
      id: 'f5940a7a-8034-4068-b11f-e20da04e3ea9',
      legacy_order_id: 123,
      order_number: 'ORD-20260211-00001',
      status: 'open',
      total: 120,
    });

    const res = await request(app)
      .post('/api/orders')
      .query({ outlet_id: 1 })
      .send({
        source: 'pos',
        items: [{ product_id: 1, quantity: 1 }],
      });

    expect(res.status).toBe(201);
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(res.body.data).toMatchObject({
      id: 'f5940a7a-8034-4068-b11f-e20da04e3ea9',
      status: 'open',
      total: 120,
    });
  });

  test('denies cross-outlet access for manager', async () => {
    const res = await request(app)
      .get('/api/orders/live')
      .set('x-dev-role', 'manager')
      .set('x-dev-outlet-id', '2')
      .query({ outlet_id: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/cross-outlet/i);
  });

  test('updates order status through patch endpoint', async () => {
    updateOrderStatus.mockResolvedValue({
      id: 'f5940a7a-8034-4068-b11f-e20da04e3ea9',
      status: 'completed',
    });

    const res = await request(app)
      .patch('/api/orders/f5940a7a-8034-4068-b11f-e20da04e3ea9/status')
      .query({ outlet_id: 1 })
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(res.body.data.status).toBe('completed');
  });
});
