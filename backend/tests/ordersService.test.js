jest.mock('../src/services/db', () => ({
  getClient: jest.fn(),
}));

const db = require('../src/services/db');
const { createOrder, updateOrderStatus, ValidationError } = require('../src/services/ordersService');

const buildClient = ({ orderStatus = 'open', orderItems = [{ product_id: 1, quantity: 1 }] } = {}) => {
  const query = jest.fn(async (sql, params) => {
    if (sql.includes('FROM products p')) {
      return {
        rows: [
          {
            id: 1,
            name: 'Cola',
            base_price: 100,
            stock_quantity: 10,
            track_inventory: true,
            is_active: true,
          },
        ],
      };
    }

    if (sql.includes('FROM product_outlet_settings')) {
      return { rows: [] };
    }

    if (sql.includes('INSERT INTO orders')) {
      return {
        rows: [
          {
            id: 'f5940a7a-8034-4068-b11f-e20da04e3ea9',
            legacy_order_id: 999,
            order_number: 'ORD-20260211-00001',
            status: params[3],
            total: '100.00',
            outlet_id: 1,
            created_at: new Date().toISOString(),
          },
        ],
      };
    }

    if (sql.includes('SELECT id, status, outlet_id, completed_at')) {
      return {
        rows: [
          {
            id: params[0],
            status: orderStatus,
            outlet_id: 1,
            completed_at: null,
          },
        ],
      };
    }

    if (sql.includes('SELECT') && sql.includes('FROM order_items oi')) {
      return { rows: orderItems };
    }

    if (sql.includes('UPDATE orders')) {
      return {
        rows: [
          {
            id: params[0],
            status: params[1],
            payment_status: params[2] || 'paid',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
      };
    }

    if (sql.includes('UPDATE products') && sql.includes('stock_quantity = stock_quantity -')) {
      return { rows: [{ id: params[1] }] };
    }

    return { rows: [] };
  });

  return { query, release: jest.fn() };
};

describe('ordersService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rolls back when provided total does not match computed total', async () => {
    const client = buildClient();
    db.getClient.mockResolvedValue(client);

    await expect(
      createOrder(
        {
          source: 'pos',
          order_type: 'takeaway',
          payment_method: 'cash',
          items: [{ product_id: 1, quantity: 1 }],
          tax: 0,
          discount: 0,
          total: 120,
        },
        { outletId: 1, actorId: 'cashier-1' }
      )
    ).rejects.toBeInstanceOf(ValidationError);

    const executedSql = client.query.mock.calls.map((call) => call[0]);
    expect(executedSql.some((text) => text === 'ROLLBACK')).toBe(true);
    expect(executedSql.some((text) => text.includes('INSERT INTO orders'))).toBe(false);
  });

  test('creates order without stock deduction when status is open', async () => {
    const client = buildClient();
    db.getClient.mockResolvedValue(client);

    const created = await createOrder(
      {
        source: 'pos',
        order_type: 'takeaway',
        payment_method: 'cash',
        payment_status: 'paid',
        status: 'open',
        items: [{ product_id: 1, quantity: 1 }],
        tax: 0,
        discount: 0,
        total: 100,
      },
      { outletId: 1, actorId: 'cashier-1' }
    );

    expect(created).toMatchObject({
      id: 'f5940a7a-8034-4068-b11f-e20da04e3ea9',
      status: 'open',
      total: 100,
    });

    const executedSql = client.query.mock.calls.map((call) => call[0]);
    expect(executedSql.some((text) => text.includes('UPDATE products') && text.includes('stock_quantity = stock_quantity -'))).toBe(
      false
    );
    expect(executedSql.some((text) => text === 'COMMIT')).toBe(true);
  });

  test('creates order with stock deduction when status is completed', async () => {
    const client = buildClient();
    db.getClient.mockResolvedValue(client);

    await createOrder(
      {
        source: 'pos',
        order_type: 'takeaway',
        payment_method: 'cash',
        payment_status: 'paid',
        status: 'completed',
        items: [{ product_id: 1, quantity: 1 }],
        tax: 0,
        discount: 0,
        total: 100,
      },
      { outletId: 1, actorId: 'cashier-1' }
    );

    const executedSql = client.query.mock.calls.map((call) => call[0]);
    expect(executedSql.some((text) => text.includes('UPDATE products') && text.includes('stock_quantity = stock_quantity -'))).toBe(
      true
    );
  });

  test('status transition to completed deducts stock once', async () => {
    const client = buildClient({ orderStatus: 'ready' });
    db.getClient.mockResolvedValue(client);

    const updated = await updateOrderStatus(
      'f5940a7a-8034-4068-b11f-e20da04e3ea9',
      { status: 'completed' },
      { outletId: 1, actorId: 'manager-1' }
    );

    expect(updated.status).toBe('completed');
    const executedSql = client.query.mock.calls.map((call) => call[0]);
    expect(executedSql.some((text) => text.includes('UPDATE products') && text.includes('stock_quantity = stock_quantity -'))).toBe(
      true
    );
    expect(executedSql.some((text) => text.includes('INSERT INTO order_status_history'))).toBe(true);
  });
});
