jest.mock('../src/services/db', () => ({
  query: jest.fn(),
}));

const db = require('../src/services/db');
const {
  computeDiscountQuote,
  validatePromoCode,
  DiscountValidationError,
} = require('../src/services/discountsService');

describe('discountsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('applies bulk first then promo on remaining subtotal', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM products p')) {
        return {
          rows: [
            {
              id: 1,
              base_price: 100,
              is_active: true,
              section_id: 'section-1',
              category_id: 10,
            },
          ],
        };
      }
      if (sql.includes('FROM product_outlet_settings')) {
        return { rows: [] };
      }
      if (sql.includes('FROM bulk_discounts')) {
        return {
          rows: [
            {
              id: 1,
              uuid: 'bulk-1',
              name: 'Branch 10%',
              applies_to: 'branch',
              discount_type: 'percentage',
              discount_value: 10,
              min_quantity: null,
              priority: 5,
              branch_id: 1,
              created_at: new Date('2026-01-01').toISOString(),
            },
          ],
        };
      }
      if (sql.includes('FROM promo_codes')) {
        return {
          rows: [
            {
              id: 12,
              uuid: 'promo-1',
              code: 'SAVE20',
              name: 'Save 20%',
              applicable_on: 'both',
              discount_type: 'percentage',
              discount_value: 20,
              min_order_amount: null,
              max_discount_amount: null,
              per_user_limit: null,
              usage_limit: 100,
              used_count: 0,
              status: 'active',
              start_time: new Date('2026-01-01').toISOString(),
              end_time: new Date('2026-12-31').toISOString(),
            },
          ],
        };
      }
      if (sql.includes('FROM promo_usage_logs')) {
        return { rows: [{ count: '0' }] };
      }
      return { rows: [] };
    });

    const result = await computeDiscountQuote({
      outletId: 1,
      source: 'pos',
      promoCode: 'SAVE20',
      items: [{ product_id: 1, quantity: 1 }],
      tax: 0,
    });

    expect(result).toMatchObject({
      subtotal: 100,
      bulk_discount_total: 10,
      promo_discount_total: 18,
      discount_total: 28,
      final_total: 72,
    });
  });

  test('applies legacy promo aliases for percentage and channel', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM products p')) {
        return {
          rows: [
            {
              id: 1,
              base_price: 200,
              is_active: true,
              section_id: 'section-1',
              category_id: 10,
            },
          ],
        };
      }
      if (sql.includes('FROM product_outlet_settings')) {
        return { rows: [] };
      }
      if (sql.includes('FROM bulk_discounts')) {
        return { rows: [] };
      }
      if (sql.includes('FROM promo_codes')) {
        return {
          rows: [
            {
              id: 77,
              uuid: 'promo-legacy',
              code: 'LEGACY20',
              name: 'Legacy 20%',
              applicable_on: 'POS',
              discount_type: 'PERCENT',
              discount_value: 20,
              min_order_amount: null,
              max_discount_amount: null,
              per_user_limit: null,
              usage_limit: 100,
              used_count: 0,
              status: 'ACTIVE',
              start_time: new Date('2026-01-01').toISOString(),
              end_time: new Date('2026-12-31').toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await computeDiscountQuote({
      outletId: 1,
      source: 'pos',
      promoCode: 'LEGACY20',
      items: [{ product_id: 1, quantity: 1 }],
      tax: 0,
    });

    expect(result).toMatchObject({
      subtotal: 200,
      bulk_discount_total: 0,
      promo_discount_total: 40,
      discount_total: 40,
      final_total: 160,
    });
  });

  test('per-user promo can validate without customer_id for guest checkout', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM promo_codes')) {
        return {
          rows: [
            {
              id: 45,
              uuid: 'promo-2',
              code: 'FIRSTORDER',
              name: 'First Order',
              applicable_on: 'both',
              discount_type: 'fixed',
              discount_value: 50,
              min_order_amount: null,
              max_discount_amount: null,
              per_user_limit: 1,
              usage_limit: 100,
              used_count: 0,
              status: 'active',
              start_time: new Date('2026-01-01').toISOString(),
              end_time: new Date('2026-12-31').toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await validatePromoCode({
      outletId: 1,
      promoCode: 'FIRSTORDER',
      source: 'pos',
      amountBeforePromo: 500,
    });
    expect(result.valid).toBe(true);
    expect(result.promo_discount_total).toBe(50);
  });

  test('per-user promo limit is enforced when customer_id is provided', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM promo_codes')) {
        return {
          rows: [
            {
              id: 45,
              uuid: 'promo-2',
              code: 'FIRSTORDER',
              name: 'First Order',
              applicable_on: 'both',
              discount_type: 'fixed',
              discount_value: 50,
              min_order_amount: null,
              max_discount_amount: null,
              per_user_limit: 1,
              usage_limit: 100,
              used_count: 0,
              status: 'active',
              start_time: new Date('2026-01-01').toISOString(),
              end_time: new Date('2026-12-31').toISOString(),
            },
          ],
        };
      }
      if (sql.includes('FROM promo_usage_logs')) {
        return { rows: [{ count: '1' }] };
      }
      return { rows: [] };
    });

    await expect(
      validatePromoCode({
        outletId: 1,
        promoCode: 'FIRSTORDER',
        source: 'pos',
        customerId: 123,
        amountBeforePromo: 500,
      })
    ).rejects.toThrow('promo code per-user limit exceeded');
  });

  test('when stacking is disabled and discounts tie, promo wins if provided', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM products p')) {
        return {
          rows: [
            {
              id: 1,
              base_price: 100,
              is_active: true,
              section_id: 'section-1',
              category_id: 10,
            },
          ],
        };
      }
      if (sql.includes('FROM product_outlet_settings')) {
        return { rows: [] };
      }
      if (sql.includes('FROM bulk_discounts')) {
        return {
          rows: [
            {
              id: 2,
              uuid: 'bulk-2',
              name: 'Flat 20',
              applies_to: 'branch',
              discount_type: 'fixed',
              discount_value: 20,
              min_quantity: null,
              priority: 5,
              branch_id: 1,
              created_at: new Date('2026-01-01').toISOString(),
            },
          ],
        };
      }
      if (sql.includes('FROM promo_codes')) {
        return {
          rows: [
            {
              id: 99,
              uuid: 'promo-99',
              code: 'SAVE20',
              name: 'Save 20',
              applicable_on: 'both',
              discount_type: 'fixed',
              discount_value: 20,
              min_order_amount: null,
              max_discount_amount: null,
              per_user_limit: null,
              usage_limit: 100,
              used_count: 0,
              status: 'active',
              start_time: new Date('2026-01-01').toISOString(),
              end_time: new Date('2026-12-31').toISOString(),
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await computeDiscountQuote({
      outletId: 1,
      source: 'pos',
      promoCode: 'SAVE20',
      items: [{ product_id: 1, quantity: 1 }],
      tax: 0,
      discountStackingEnabled: false,
      roundingRule: 'none',
    });

    expect(result.bulk_discount_total).toBe(0);
    expect(result.promo_discount_total).toBe(20);
    expect(result.discount_total).toBe(20);
    expect(result.final_total).toBe(80);
  });

  test('quote includes add-on price deltas from section configuration', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM products p')) {
        return {
          rows: [
            {
              id: 1,
              base_price: 200,
              is_active: true,
              section_id: 'section-1',
              category_id: 10,
            },
          ],
        };
      }
      if (sql.includes('SELECT addon_groups') && sql.includes('FROM sections')) {
        return {
          rows: [
            {
              addon_groups: [
                {
                  id: 'size',
                  label: 'Size',
                  required: true,
                  multi: false,
                  min_select: 1,
                  max_select: 1,
                  options: [
                    { id: 'small', label: 'Small', price_delta: 0 },
                    { id: 'large', label: 'Large', price_delta: 80 },
                  ],
                },
              ],
            },
          ],
        };
      }
      if (sql.includes('FROM product_outlet_settings')) {
        return { rows: [] };
      }
      if (sql.includes('FROM bulk_discounts')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await computeDiscountQuote({
      outletId: 1,
      source: 'pos',
      items: [
        {
          product_id: 1,
          quantity: 2,
          modifiers: {
            addons: [{ group_id: 'size', option_ids: ['large'] }],
          },
        },
      ],
      tax: 0,
    });

    expect(result.subtotal).toBe(560);
    expect(result.final_total).toBe(560);
    expect(result.items[0]).toMatchObject({
      product_id: 1,
      quantity: 2,
      unit_price: 280,
      total_price: 560,
    });
  });
});
