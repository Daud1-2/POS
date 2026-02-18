jest.mock('../src/services/db', () => ({
  query: jest.fn(),
}));

const db = require('../src/services/db');
const { getInsights } = require('../src/services/customerSegmentationService');

describe('customerSegmentationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('scopes customer insights to website/app channels (excludes POS)', async () => {
    db.query.mockResolvedValue({
      rows: [
        {
          total_customers: 2,
          risk_count: 1,
          loyal_count: 1,
          champions_count: 1,
          loyal_customers_count: 0,
          need_attention_count: 1,
          at_risk_count: 0,
          hibernating_count: 0,
          high_value_count: 1,
          high_potential_count: 1,
          avg_clv_90d: 1200,
          avg_churn_risk_score: 35,
        },
      ],
    });

    await getInsights({
      outletId: 14,
      query: {},
    });

    expect(db.query).toHaveBeenCalledTimes(1);
    const executedSql = db.query.mock.calls[0][0];
    expect(executedSql).toContain("o.order_channel IN ('online','whatsapp','delivery_platform')");
    expect(executedSql).toContain("LOWER(COALESCE(o.source, '')) IN ('website', 'app')");
  });
});
