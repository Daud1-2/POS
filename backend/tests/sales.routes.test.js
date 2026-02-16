process.env.ALLOW_DEV_AUTH_BYPASS = 'true';

const request = require('supertest');

jest.mock('../src/services/db', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/ordersService', () => {
  class ValidationError extends Error {
    constructor(message, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  return {
    createOrder: jest.fn(),
    ValidationError,
  };
});

const db = require('../src/services/db');
const { createOrder } = require('../src/services/ordersService');
const app = require('../src/app');

describe('sales routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/sales is branch-scoped', async () => {
    db.query.mockResolvedValue({
      rows: [{ id: '1', branch_id: 1, total: '100.00' }],
    });

    const res = await request(app).get('/api/sales').query({ branch_id: 1 });

    expect(res.status).toBe(200);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][1]).toEqual([[1]]);
  });

  test('POST /api/sales denies branch mismatch from body', async () => {
    const res = await request(app)
      .post('/api/sales')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '2')
      .query({ branch_id: 2 })
      .send({
        cashierId: 99,
        branch_id: 1,
        items: [{ productId: 1, quantity: 1 }],
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Cross-branch/i);
    expect(createOrder).not.toHaveBeenCalled();
  });

  test('POST /api/sales writes with effective branch id', async () => {
    createOrder.mockResolvedValue({
      id: 'f5940a7a-8034-4068-b11f-e20da04e3ea9',
      legacy_order_id: 55,
      total: 200,
      status: 'completed',
    });

    const res = await request(app)
      .post('/api/sales')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '3')
      .query({ branch_id: 3 })
      .send({
        cashierId: 7,
        branch_id: 3,
        items: [{ productId: 1, quantity: 1 }],
      });

    expect(res.status).toBe(201);
    expect(createOrder).toHaveBeenCalledTimes(1);
    const [payload, context] = createOrder.mock.calls[0];
    expect(payload.branch_id).toBe(3);
    expect(context.branchId).toBe(3);
  });
});

