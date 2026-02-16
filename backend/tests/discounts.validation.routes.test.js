process.env.ALLOW_DEV_AUTH_BYPASS = 'true';

const request = require('supertest');

jest.mock('../src/services/db', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
}));

const app = require('../src/app');

describe('discount routes validation', () => {
  test('PATCH promo with invalid uuid returns 400', async () => {
    const res = await request(app)
      .patch('/api/discounts/promo-codes/not-a-uuid')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 })
      .send({ name: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uuid/i);
  });

  test('PATCH bulk with invalid uuid returns 400', async () => {
    const res = await request(app)
      .patch('/api/discounts/bulk-discounts/not-a-uuid')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 })
      .send({ name: 'x' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/uuid/i);
  });
});

