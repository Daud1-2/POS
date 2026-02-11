process.env.ALLOW_DEV_AUTH_BYPASS = 'true';

const request = require('supertest');

jest.mock('../src/services/db', () => ({
  query: jest.fn(),
}));

const db = require('../src/services/db');
const app = require('../src/app');

describe('dashboard routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns summary from backend-authoritative query', async () => {
    db.query
      .mockResolvedValueOnce({
        rows: [{
          total_sales: '250.00',
          total_orders: '5',
          web_orders: '2',
          web_sales: '100.00',
          avg_order_value: '50.00',
          highest_order_value: '70.00',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ count: '0' }] });

    const res = await request(app)
      .get('/api/dashboard/summary')
      .query({ range: 'day', outlet_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      range: 'day',
      total_sales: 250,
      total_orders: 5,
      web_orders: 2,
      web_sales: 100,
      avg_order_value: 50,
      highest_order_value: 70,
      new_vs_old: null,
    });
  });

  test('returns 400 when admin request has no outlet_id', async () => {
    const res = await request(app)
      .get('/api/dashboard/summary')
      .set('x-dev-role', 'admin');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/outlet_id is required/i);
  });
});
