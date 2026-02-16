process.env.ALLOW_DEV_AUTH_BYPASS = 'true';

const request = require('supertest');

jest.mock('../src/services/customerSegmentationService', () => {
  class CustomerSegmentationError extends Error {
    constructor(message, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  return {
    CustomerSegmentationError,
    getSegments: jest.fn(),
    getInsights: jest.fn(),
  };
});

jest.mock('../src/services/customerCampaignService', () => {
  class CustomerCampaignError extends Error {
    constructor(message, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  return {
    CustomerCampaignError,
    previewSmsCampaign: jest.fn(),
    createSmsTemplate: jest.fn(),
    listSmsTemplates: jest.fn(),
    createAudienceTemplate: jest.fn(),
    listAudienceTemplates: jest.fn(),
    exportAudienceTemplate: jest.fn(),
  };
});

const segmentationService = require('../src/services/customerSegmentationService');
const campaignService = require('../src/services/customerCampaignService');
const app = require('../src/app');

describe('customers routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns paginated customer segments', async () => {
    segmentationService.getSegments.mockResolvedValue({
      data: [{ customer_name: 'John', total_orders: 3 }],
      meta: { page: 1, page_size: 25, total: 1, total_pages: 1 },
      ai_recommendations: [],
    });

    const res = await request(app).get('/api/customers/segments').query({ branch_id: 1, page: 1 });

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(segmentationService.getSegments).toHaveBeenCalled();
  });

  test('returns customer insights for cashier', async () => {
    segmentationService.getInsights.mockResolvedValue({
      total_customers: 10,
      segment_counts: { champions: 2 },
    });

    const res = await request(app)
      .get('/api/customers/insights')
      .set('x-dev-role', 'cashier')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.total_customers).toBe(10);
  });

  test('manager can export audience template payload', async () => {
    campaignService.exportAudienceTemplate.mockResolvedValue({
      platform: 'meta',
      matched_count: 5,
      excluded_missing_contact_count: 1,
      file_name: 'audience.csv',
      csv: 'email,phone\n',
    });

    const res = await request(app)
      .get('/api/customers/audiences/templates/11111111-1111-4111-8111-111111111111/export')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1, platform: 'meta' });

    expect(res.status).toBe(200);
    expect(res.body.data.matched_count).toBe(5);
  });
});

