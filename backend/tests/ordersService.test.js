jest.mock('../src/services/db', () => ({
  getClient: jest.fn(),
}));

const db = require('../src/services/db');
const { createOrder, updateOrderStatus, ValidationError } = require('../src/services/ordersService');

const buildClient = ({
  orderStatus = 'pending',
  orderChannel = 'pos',
  orderSource = 'pos',
  orderMetadata = {},
  orderItems = [{ product_id: 1, quantity: 1 }],
  sectionAddonGroups = [],
  businessSettingsRow = null,
  branchSettingsRow = {
    branch_id: 1,
    outlet_id: 1,
    branch_name: 'Outlet 1',
    branch_timezone: 'UTC',
    branch_is_active: true,
    is_open: true,
    accepting_orders: true,
    maintenance_mode: false,
    temporary_closed: false,
    enforce_working_hours: false,
    working_hours: {
      monday: { open: '09:00', close: '22:00' },
      tuesday: { open: '09:00', close: '22:00' },
      wednesday: { open: '09:00', close: '22:00' },
      thursday: { open: '09:00', close: '22:00' },
      friday: { open: '09:00', close: '22:00' },
      saturday: { open: '09:00', close: '22:00' },
      sunday: { open: '09:00', close: '22:00' },
    },
  },
} = {}) => {
  const query = jest.fn(async (sql, params) => {
    if (sql.includes('FROM business_settings')) {
      return { rows: businessSettingsRow ? [businessSettingsRow] : [] };
    }

    if (sql.includes('FROM branches b')) {
      return { rows: branchSettingsRow ? [branchSettingsRow] : [] };
    }

    if (sql.includes('FROM outlets')) {
      return {
        rows: [
          {
            id: 1,
            name: 'Outlet 1',
            timezone: 'UTC',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deleted_at: null,
          },
        ],
      };
    }

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
            section_id: '1060ab07-e08f-4cbf-bf6a-4d0d1ac7348f',
            category_id: null,
          },
        ],
      };
    }

    if (sql.includes('SELECT addon_groups') && sql.includes('FROM sections')) {
      return {
        rows: [
          {
            addon_groups: sectionAddonGroups,
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
            source: params[1],
            order_channel: params[2],
            status: params[4],
            total: params[12],
            outlet_id: 1,
            created_at: new Date().toISOString(),
            customer_id: null,
            customer_name_snapshot: null,
            customer_phone_snapshot: null,
            customer_email_snapshot: null,
            promo_code_id: null,
            promo_discount_amount: 0,
            bulk_discount_amount: 0,
          },
        ],
      };
    }

    if (sql.includes('SELECT id, status, source, order_channel, outlet_id, completed_at, refunded_at, metadata')) {
      return {
        rows: [
          {
            id: params[0],
            status: orderStatus,
            source: orderSource,
            order_channel: orderChannel,
            outlet_id: 1,
            completed_at: null,
            refunded_at: null,
            metadata: orderMetadata,
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

    if (sql.includes('UPDATE products') && sql.includes('stock_quantity = stock_quantity +')) {
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

  test('creates order with stock deduction when status is pending', async () => {
    const client = buildClient();
    db.getClient.mockResolvedValue(client);

    const created = await createOrder(
      {
        source: 'pos',
        order_type: 'takeaway',
        payment_method: 'cash',
        payment_status: 'paid',
        status: 'pending',
        items: [{ product_id: 1, quantity: 1 }],
        tax: 0,
        discount: 0,
        total: 100,
      },
      { outletId: 1, actorId: 'cashier-1' }
    );

    expect(created).toMatchObject({
      id: 'f5940a7a-8034-4068-b11f-e20da04e3ea9',
      status: 'pending',
      total: 100,
    });

    const executedSql = client.query.mock.calls.map((call) => call[0]);
    expect(executedSql.some((text) => text.includes('UPDATE products') && text.includes('stock_quantity = stock_quantity -'))).toBe(
      true
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

  test('includes section add-on price deltas in order totals', async () => {
    const client = buildClient({
      sectionAddonGroups: [
        {
          id: 'size',
          label: 'Size',
          required: true,
          multi: false,
          min_select: 1,
          max_select: 1,
          options: [
            { id: 'small', label: 'Small', price_delta: 0 },
            { id: 'large', label: 'Large', price_delta: 50 },
          ],
        },
      ],
    });
    db.getClient.mockResolvedValue(client);

    const created = await createOrder(
      {
        source: 'pos',
        order_type: 'takeaway',
        payment_method: 'cash',
        payment_status: 'paid',
        status: 'pending',
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
        total: 300,
      },
      { outletId: 1, actorId: 'cashier-1' }
    );

    expect(created.subtotal).toBe(300);
    expect(created.total).toBe(300);
    expect(created.items[0]).toMatchObject({
      product_id: 1,
      quantity: 2,
      unit_price: 150,
      total_price: 300,
    });
  });

  test('uses business tax settings and ignores client-provided tax', async () => {
    const client = buildClient({
      businessSettingsRow: {
        id: 1,
        uuid: 'f5940a7a-8034-4068-b11f-e20da04e3ea9',
        default_currency: 'PKR',
        tax_enabled: true,
        default_tax_percent: 10,
        rounding_rule: 'none',
        discount_stacking_enabled: true,
      },
      branchSettingsRow: {
        branch_id: 1,
        outlet_id: 1,
        branch_name: 'Outlet 1',
        branch_timezone: 'UTC',
        branch_is_active: true,
        is_open: true,
        accepting_orders: true,
        maintenance_mode: false,
        temporary_closed: false,
        enforce_working_hours: false,
        working_hours: {
          monday: { open: '00:00', close: '23:59' },
          tuesday: { open: '00:00', close: '23:59' },
          wednesday: { open: '00:00', close: '23:59' },
          thursday: { open: '00:00', close: '23:59' },
          friday: { open: '00:00', close: '23:59' },
          saturday: { open: '00:00', close: '23:59' },
          sunday: { open: '00:00', close: '23:59' },
        },
      },
    });
    db.getClient.mockResolvedValue(client);

    const created = await createOrder(
      {
        source: 'pos',
        order_type: 'takeaway',
        payment_method: 'cash',
        payment_status: 'paid',
        status: 'pending',
        items: [{ product_id: 1, quantity: 1 }],
        tax: 999,
        total: 110,
      },
      { outletId: 1, actorId: 'cashier-1', role: 'manager' }
    );

    expect(created.tax).toBe(10);
    expect(created.total).toBe(110);
  });

  test('rejects order when branch open and close time are equal', async () => {
    const client = buildClient({
      branchSettingsRow: {
        branch_id: 1,
        outlet_id: 1,
        branch_name: 'Outlet 1',
        branch_timezone: 'UTC',
        branch_is_active: true,
        is_open: true,
        accepting_orders: true,
        maintenance_mode: false,
        temporary_closed: false,
        enforce_working_hours: true,
        working_hours: {
          monday: { open: '09:00', close: '09:00' },
          tuesday: { open: '09:00', close: '09:00' },
          wednesday: { open: '09:00', close: '09:00' },
          thursday: { open: '09:00', close: '09:00' },
          friday: { open: '09:00', close: '09:00' },
          saturday: { open: '09:00', close: '09:00' },
          sunday: { open: '09:00', close: '09:00' },
        },
      },
    });
    db.getClient.mockResolvedValue(client);

    await expect(
      createOrder(
        {
          source: 'pos',
          order_type: 'takeaway',
          payment_method: 'cash',
          payment_status: 'paid',
          status: 'pending',
          items: [{ product_id: 1, quantity: 1 }],
          total: 100,
        },
        { outletId: 1, actorId: 'cashier-1', role: 'manager' }
      )
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('status transition to completed deducts stock once', async () => {
    const client = buildClient({ orderStatus: 'pending' });
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

  test('status transition pending -> completed does not deduct stock twice when already deducted', async () => {
    const client = buildClient({ orderStatus: 'pending', orderMetadata: { inventory_deducted: true } });
    db.getClient.mockResolvedValue(client);

    const updated = await updateOrderStatus(
      'f5940a7a-8034-4068-b11f-e20da04e3ea9',
      { status: 'completed' },
      { outletId: 1, actorId: 'manager-1' }
    );

    expect(updated.status).toBe('completed');
    const executedSql = client.query.mock.calls.map((call) => call[0]);
    expect(executedSql.some((text) => text.includes('UPDATE products') && text.includes('stock_quantity = stock_quantity -'))).toBe(
      false
    );
  });

  test('status transition pending -> cancelled restocks stock when already deducted', async () => {
    const client = buildClient({ orderStatus: 'pending', orderMetadata: { inventory_deducted: true } });
    db.getClient.mockResolvedValue(client);

    const updated = await updateOrderStatus(
      'f5940a7a-8034-4068-b11f-e20da04e3ea9',
      { status: 'cancelled' },
      { outletId: 1, actorId: 'manager-1' }
    );

    expect(updated.status).toBe('cancelled');
    const executedSql = client.query.mock.calls.map((call) => call[0]);
    expect(executedSql.some((text) => text.includes('UPDATE products') && text.includes('stock_quantity = stock_quantity +'))).toBe(
      true
    );
  });

  test('status transition pending -> cancelled does not restock when inventory was not deducted', async () => {
    const client = buildClient({ orderStatus: 'pending', orderMetadata: { inventory_deducted: false } });
    db.getClient.mockResolvedValue(client);

    const updated = await updateOrderStatus(
      'f5940a7a-8034-4068-b11f-e20da04e3ea9',
      { status: 'cancelled' },
      { outletId: 1, actorId: 'manager-1' }
    );

    expect(updated.status).toBe('cancelled');
    const executedSql = client.query.mock.calls.map((call) => call[0]);
    expect(executedSql.some((text) => text.includes('UPDATE products') && text.includes('stock_quantity = stock_quantity +'))).toBe(
      false
    );
  });

  test('status transition completed -> completed does not deduct stock twice', async () => {
    const client = buildClient({ orderStatus: 'completed' });
    db.getClient.mockResolvedValue(client);

    const updated = await updateOrderStatus(
      'f5940a7a-8034-4068-b11f-e20da04e3ea9',
      { status: 'completed' },
      { outletId: 1, actorId: 'manager-1' }
    );

    expect(updated.status).toBe('completed');
    const executedSql = client.query.mock.calls.map((call) => call[0]);
    expect(executedSql.some((text) => text.includes('UPDATE products') && text.includes('stock_quantity = stock_quantity -'))).toBe(
      false
    );
  });
});
