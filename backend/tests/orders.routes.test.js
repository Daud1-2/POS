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
      .query({ branch_id: 1, page: 1, page_size: 2 });

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
      .query({ branch_id: 1 })
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

  test('denies Cross-branch access for manager', async () => {
    const res = await request(app)
      .get('/api/orders/live')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '2')
      .query({ branch_id: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Cross-branch/i);
  });

  test('updates order status through patch endpoint', async () => {
    updateOrderStatus.mockResolvedValue({
      id: 'f5940a7a-8034-4068-b11f-e20da04e3ea9',
      status: 'completed',
    });

    const res = await request(app)
      .patch('/api/orders/f5940a7a-8034-4068-b11f-e20da04e3ea9/status')
      .query({ branch_id: 1 })
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(res.body.data.status).toBe('completed');
  });

  test('blocks write requests during maintenance mode for non-admin', async () => {
    const fullDaySchedule = {
      monday: { open: '00:00', close: '23:59' },
      tuesday: { open: '00:00', close: '23:59' },
      wednesday: { open: '00:00', close: '23:59' },
      thursday: { open: '00:00', close: '23:59' },
      friday: { open: '00:00', close: '23:59' },
      saturday: { open: '00:00', close: '23:59' },
      sunday: { open: '00:00', close: '23:59' },
    };

    db.query.mockResolvedValueOnce({
      rows: [
        {
          branch_id: 1,
          branch_id: 1,
          branch_name: 'Outlet 1',
          branch_timezone: 'UTC',
          branch_is_active: true,
          is_open: true,
          accepting_orders: true,
          maintenance_mode: true,
          temporary_closed: false,
          enforce_working_hours: true,
          working_hours: fullDaySchedule,
        },
      ],
    });

    const res = await request(app)
      .post('/api/orders')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 })
      .send({
        source: 'pos',
        items: [{ product_id: 1, quantity: 1 }],
      });

    expect(res.status).toBe(503);
    expect(createOrder).not.toHaveBeenCalled();
  });
});

