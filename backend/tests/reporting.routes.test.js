process.env.ALLOW_DEV_AUTH_BYPASS = 'true';

const request = require('supertest');

jest.mock('../src/services/reportingService', () => {
  class ReportingValidationError extends Error {
    constructor(message, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  return {
    ReportingValidationError,
    getRevenueOverview: jest.fn(),
    getRevenueTrend: jest.fn(),
    getPaymentOverview: jest.fn(),
    getPaymentTrend: jest.fn(),
    getDiscountOverview: jest.fn(),
    getDiscountDeals: jest.fn(),
    getProductsIntelligence: jest.fn(),
    getTimeAnalysis: jest.fn(),
    getBranchComparison: jest.fn(),
  };
});

const reportingService = require('../src/services/reportingService');
const app = require('../src/app');

describe('reporting routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns revenue overview payload for scoped outlet', async () => {
    reportingService.getRevenueOverview.mockResolvedValue({
      total_collected: 1000,
      gross_revenue: 1100,
      net_revenue: 1000,
      discount_amount: 100,
      discount_impact_pct: 9.09,
      aov: 50,
      revenue_growth_pct: 10,
    });

    const res = await request(app)
      .get('/api/reporting/revenue/overview')
      .query({ branch_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.total_collected).toBe(1000);
    expect(reportingService.getRevenueOverview).toHaveBeenCalled();
  });

  test('admin branch comparison works with branch_ids', async () => {
    reportingService.getBranchComparison.mockResolvedValue({
      branches: [
        { branch_id: 1, revenue: 2000 },
        { branch_id: 2, revenue: 1500 },
      ],
    });

    const res = await request(app)
      .get('/api/reporting/branches/compare')
      .set('x-dev-role', 'admin')
      .set('x-dev-branch-ids', '1,2')
      .query({ branch_ids: '1,2' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.branches)).toBe(true);
    expect(reportingService.getBranchComparison).toHaveBeenCalled();
  });

  test('manager is blocked from branch comparison', async () => {
    const res = await request(app)
      .get('/api/reporting/branches/compare')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .query({ branch_ids: '1,2' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/admin/i);
  });

  test('admin request without branch_id for single-outlet endpoint fails', async () => {
    const res = await request(app)
      .get('/api/reporting/payments/overview')
      .set('x-dev-role', 'admin')
      .set('x-dev-branch-ids', '1,2');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/branch_id/i);
  });
});

