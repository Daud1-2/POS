process.env.ALLOW_DEV_AUTH_BYPASS = 'true';

const request = require('supertest');

jest.mock('../src/services/db', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/discountsService', () => {
  class DiscountValidationError extends Error {
    constructor(message, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  return {
    DiscountValidationError,
    parsePagination: jest.fn(() => ({ page: 1, page_size: 25, offset: 0 })),
    toPositiveInt: jest.fn((value) => Number(value)),
    listPromoCodes: jest.fn(),
    createPromoCode: jest.fn(),
    updatePromoCode: jest.fn(),
    togglePromoCode: jest.fn(),
    softDeletePromoCode: jest.fn(),
    listBulkDiscounts: jest.fn(),
    createBulkDiscount: jest.fn(),
    updateBulkDiscount: jest.fn(),
    toggleBulkDiscount: jest.fn(),
    softDeleteBulkDiscount: jest.fn(),
    computeDiscountQuote: jest.fn(),
    validatePromoCode: jest.fn(),
  };
});

const db = require('../src/services/db');
const discountsService = require('../src/services/discountsService');
const app = require('../src/app');

describe('discounts routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockResolvedValue({ rows: [{ maintenance_mode: false }] });
  });

  test('returns paginated promo codes', async () => {
    discountsService.listPromoCodes.mockResolvedValue({
      data: [{ uuid: 'promo-1', code: 'SAVE20' }],
      meta: { page: 1, page_size: 25, total: 1, total_pages: 1 },
    });

    const res = await request(app).get('/api/discounts/promo-codes').query({ branch_id: 1, page: 1, page_size: 25 });

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, total: 1 });
    expect(discountsService.listPromoCodes).toHaveBeenCalled();
  });

  test('manager can create promo code', async () => {
    discountsService.createPromoCode.mockResolvedValue({
      uuid: '6ad832d9-7b41-49e6-95f4-42c06d24d7da',
      code: 'SAVE20',
    });

    const res = await request(app)
      .post('/api/discounts/promo-codes')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 })
      .send({
        code: 'SAVE20',
        name: 'Save 20',
        applicable_on: 'both',
        discount_type: 'percentage',
        discount_value: 20,
        start_time: '2026-02-12T00:00:00.000Z',
        end_time: '2026-02-28T23:59:59.000Z',
      });

    expect(res.status).toBe(201);
    expect(discountsService.createPromoCode).toHaveBeenCalled();
  });

  test('cashier cannot mutate discounts', async () => {
    const res = await request(app)
      .post('/api/discounts/bulk-discounts')
      .set('x-dev-role', 'cashier')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 })
      .send({ name: 'Happy Hour' });

    expect(res.status).toBe(403);
  });

  test('quote endpoint returns backend computed totals', async () => {
    discountsService.computeDiscountQuote.mockResolvedValue({
      subtotal: 100,
      bulk_discount_total: 10,
      promo_discount_total: 5,
      discount_total: 15,
      final_total: 85,
    });

    const res = await request(app)
      .post('/api/discounts/quote')
      .query({ branch_id: 1 })
      .send({
        source: 'pos',
        promo_code: 'SAVE5',
        items: [{ product_id: 1, quantity: 1 }],
      });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      subtotal: 100,
      discount_total: 15,
      final_total: 85,
    });
  });

  test('denies Cross-branch access for manager', async () => {
    const res = await request(app)
      .get('/api/discounts/promo-codes')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '2')
      .query({ branch_id: 1 });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Cross-branch/i);
  });
});

