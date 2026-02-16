process.env.ALLOW_DEV_AUTH_BYPASS = 'true';

const request = require('supertest');

jest.mock('../src/services/db', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/shiftService', () => ({
  getDailyShiftSummary: jest.fn(),
}));

const { getDailyShiftSummary } = require('../src/services/shiftService');
const app = require('../src/app');

describe('dashboard shift-summary route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns today shift summary for scoped branch', async () => {
    getDailyShiftSummary.mockResolvedValue({
      date: '2026-02-16',
      total_shifts: 1,
      open_shifts: 0,
      closed_shifts: 1,
      perfect_count: 1,
      over_count: 0,
      short_count: 0,
      total_opening_cash: 10000,
      total_cash_sales: 3500,
      total_expenses: 200,
      total_expected_cash: 13300,
      total_closing_cash: 13300,
      total_difference: 0,
      records: [],
    });

    const res = await request(app)
      .get('/api/dashboard/shift-summary')
      .query({ branch_id: 1 });

    expect(res.status).toBe(200);
    expect(getDailyShiftSummary).toHaveBeenCalledTimes(1);
    expect(res.body.data).toMatchObject({
      date: '2026-02-16',
      total_shifts: 1,
      perfect_count: 1,
    });
  });
});
