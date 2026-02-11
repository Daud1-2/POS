jest.mock('../src/services/db', () => ({
  getClient: jest.fn(),
}));

const db = require('../src/services/db');
const { createOrder, ValidationError } = require('../src/services/ordersService');

describe('catalog inventory integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('uses outlet stock override for completed order deduction', async () => {
    const query = jest.fn(async (sql, params) => {
      if (sql.includes('FROM products p')) {
        return {
          rows: [
            {
              id: 1,
              name: 'Burger',
              base_price: 500,
              stock_quantity: 100,
              track_inventory: true,
              is_active: true,
            },
          ],
        };
      }
      if (sql.includes('FROM product_outlet_settings')) {
        return {
          rows: [
            {
              id: '8e1c2b3a-5f32-4b73-a56d-721f4508a1f5',
              is_available: true,
              price_override: 450,
              stock_override: 5,
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO orders')) {
        return {
          rows: [
            {
              id: 'f5940a7a-8034-4068-b11f-e20da04e3ea9',
              legacy_order_id: 12,
              order_number: 'ORD-1',
              status: 'completed',
              total: '450.00',
              outlet_id: 1,
              created_at: new Date().toISOString(),
            },
          ],
        };
      }
      if (sql.includes('UPDATE product_outlet_settings')) {
        return { rows: [{ id: '8e1c2b3a-5f32-4b73-a56d-721f4508a1f5' }] };
      }
      return { rows: [] };
    });
    const release = jest.fn();
    db.getClient.mockResolvedValue({ query, release });

    await createOrder(
      {
        source: 'pos',
        status: 'completed',
        items: [{ product_id: 1, quantity: 1 }],
        total: 450,
      },
      { outletId: 1, actorId: 'manager-1' }
    );

    const sqlCalls = query.mock.calls.map((call) => call[0]);
    expect(sqlCalls.some((text) => text.includes('UPDATE product_outlet_settings'))).toBe(true);
    expect(sqlCalls.some((text) => text.includes('UPDATE products') && text.includes('stock_quantity = stock_quantity -'))).toBe(
      false
    );
  });

  test('rolls back when stock is insufficient', async () => {
    const query = jest.fn(async (sql) => {
      if (sql.includes('FROM products p')) {
        return {
          rows: [
            {
              id: 1,
              name: 'Burger',
              base_price: 500,
              stock_quantity: 0,
              track_inventory: true,
              is_active: true,
            },
          ],
        };
      }
      if (sql.includes('FROM product_outlet_settings')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    const release = jest.fn();
    db.getClient.mockResolvedValue({ query, release });

    await expect(
      createOrder(
        {
          source: 'pos',
          status: 'completed',
          items: [{ product_id: 1, quantity: 1 }],
          total: 500,
        },
        { outletId: 1, actorId: 'manager-1' }
      )
    ).rejects.toBeInstanceOf(ValidationError);

    expect(query.mock.calls.map((call) => call[0]).some((text) => text === 'ROLLBACK')).toBe(true);
  });
});
