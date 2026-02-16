const db = require('./db');

class ShiftValidationError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = 'ShiftValidationError';
    this.statusCode = statusCode;
  }
}

const SHIFT_STATUSES = new Set(['OPEN', 'CLOSED']);
const RECON_STATUSES = new Set(['Perfect', 'Over', 'Short']);

const SHIFT_SCHEMA_DDL = [
  'CREATE EXTENSION IF NOT EXISTS pgcrypto',
  `
  CREATE TABLE IF NOT EXISTS cashier_shifts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outlet_id BIGINT NOT NULL,
    shift_date DATE NOT NULL,
    cashier_id TEXT NULL,
    status VARCHAR(10) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
    end_time TIMESTAMPTZ NULL,
    opening_cash NUMERIC(12,2) NOT NULL DEFAULT 0,
    expenses NUMERIC(12,2) NOT NULL DEFAULT 0,
    expected_cash NUMERIC(12,2) NULL,
    closing_cash NUMERIC(12,2) NULL,
    difference NUMERIC(12,2) NULL,
    reconciliation_status VARCHAR(10) NULL CHECK (reconciliation_status IN ('Perfect', 'Over', 'Short')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT cashier_shifts_opening_cash_non_negative CHECK (opening_cash >= 0),
    CONSTRAINT cashier_shifts_expenses_non_negative CHECK (expenses >= 0),
    CONSTRAINT cashier_shifts_closing_cash_non_negative CHECK (closing_cash IS NULL OR closing_cash >= 0),
    CONSTRAINT cashier_shifts_expected_cash_non_negative CHECK (expected_cash IS NULL OR expected_cash >= 0),
    CONSTRAINT cashier_shifts_one_opening_per_day UNIQUE (outlet_id, shift_date)
  )
  `,
  'CREATE INDEX IF NOT EXISTS idx_cashier_shifts_outlet_date ON cashier_shifts (outlet_id, shift_date DESC)',
  'CREATE INDEX IF NOT EXISTS idx_cashier_shifts_status ON cashier_shifts (status, start_time DESC)',
];

const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

const toMoney = (value, fieldName, { min = 0 } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ShiftValidationError(`${fieldName} must be a valid number`);
  }
  if (parsed < min) {
    throw new ShiftValidationError(`${fieldName} must be >= ${min}`);
  }
  return roundMoney(parsed);
};

const toPositiveInt = (value, fieldName = 'value') => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ShiftValidationError(`${fieldName} must be a positive integer`);
  }
  return parsed;
};

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const ensureShiftSchema = async (client) => {
  for (const statement of SHIFT_SCHEMA_DDL) {
    await client.query(statement);
  }
};

const getTodayKeyForTimezone = async ({ client, timezone }) => {
  const result = await client.query(
    `
    SELECT timezone($1, now())::date::text AS day_key
    `,
    [timezone]
  );
  return result.rows[0]?.day_key || null;
};

const getShiftCashSales = async ({ client, outletId, startTime, endTime = null }) => {
  const result = await client.query(
    `
    SELECT COALESCE(SUM(o.total), 0) AS cash_sales
    FROM orders o
    WHERE o.outlet_id = $1
      AND o.deleted_at IS NULL
      AND o.order_channel = 'pos'
      AND o.status = 'completed'
      AND o.payment_method = 'cash'
      AND o.payment_status IN ('paid', 'partially_paid')
      AND COALESCE(o.completed_at, o.created_at) >= $2
      AND COALESCE(o.completed_at, o.created_at) <= COALESCE($3::timestamptz, now())
    `,
    [outletId, startTime, endTime]
  );
  return roundMoney(result.rows[0]?.cash_sales);
};

const normalizeShiftRow = async ({ client, row }) => {
  if (!row) return null;

  const cashSales = await getShiftCashSales({
    client,
    outletId: Number(row.outlet_id),
    startTime: row.start_time,
    endTime: row.end_time,
  });

  const openingCash = roundMoney(row.opening_cash);
  const expenses = roundMoney(row.expenses);
  const expectedCash = row.expected_cash === null || row.expected_cash === undefined
    ? roundMoney(openingCash + cashSales - expenses)
    : roundMoney(row.expected_cash);
  const closingCash = row.closing_cash === null || row.closing_cash === undefined
    ? null
    : roundMoney(row.closing_cash);
  const difference = row.difference === null || row.difference === undefined
    ? null
    : roundMoney(row.difference);

  const status = SHIFT_STATUSES.has(row.status) ? row.status : 'OPEN';
  const reconciliationStatus = RECON_STATUSES.has(row.reconciliation_status)
    ? row.reconciliation_status
    : (
      difference === null
        ? null
        : Math.abs(difference) < 0.01
          ? 'Perfect'
          : difference > 0
            ? 'Over'
            : 'Short'
    );

  return {
    id: row.id,
    outlet_id: Number(row.outlet_id),
    shift_date: row.shift_date,
    cashier_id: row.cashier_id,
    status,
    start_time: row.start_time,
    end_time: row.end_time,
    opening_cash: openingCash,
    cash_sales: cashSales,
    expenses,
    expected_cash: expectedCash,
    closing_cash: closingCash,
    difference,
    reconciliation_status: reconciliationStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

const getTodayShift = async ({ outletId, timezone = 'Asia/Karachi' }) => {
  const numericOutletId = toPositiveInt(outletId, 'outlet_id');
  const client = await db.getClient();
  try {
    await ensureShiftSchema(client);
    const dayKey = await getTodayKeyForTimezone({ client, timezone });
    const result = await client.query(
      `
      SELECT
        id,
        outlet_id,
        shift_date::text AS shift_date,
        cashier_id,
        status,
        start_time,
        end_time,
        opening_cash,
        expenses,
        expected_cash,
        closing_cash,
        difference,
        reconciliation_status,
        created_at,
        updated_at
      FROM cashier_shifts
      WHERE outlet_id = $1
        AND shift_date = $2::date
      LIMIT 1
      `,
      [numericOutletId, dayKey]
    );
    const shift = await normalizeShiftRow({ client, row: result.rows[0] || null });
    return {
      date: dayKey,
      shift,
    };
  } finally {
    client.release();
  }
};

const startShift = async ({ outletId, openingCash, cashierId = null, timezone = 'Asia/Karachi' }) => {
  const numericOutletId = toPositiveInt(outletId, 'outlet_id');
  const opening = toMoney(openingCash, 'opening_cash');
  const actor = cashierId ? String(cashierId) : null;
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await ensureShiftSchema(client);
    const dayKey = await getTodayKeyForTimezone({ client, timezone });

    const existingResult = await client.query(
      `
      SELECT id
      FROM cashier_shifts
      WHERE outlet_id = $1
        AND shift_date = $2::date
      LIMIT 1
      FOR UPDATE
      `,
      [numericOutletId, dayKey]
    );
    if (existingResult.rows[0]) {
      throw new ShiftValidationError(
        `Opening cash already recorded for ${dayKey} and cannot be changed`,
        409
      );
    }

    const insertResult = await client.query(
      `
      INSERT INTO cashier_shifts (
        outlet_id,
        shift_date,
        cashier_id,
        status,
        start_time,
        opening_cash,
        expenses,
        metadata,
        created_at,
        updated_at
      )
      VALUES (
        $1,
        $2::date,
        $3,
        'OPEN',
        now(),
        $4,
        0,
        '{}'::jsonb,
        now(),
        now()
      )
      RETURNING
        id,
        outlet_id,
        shift_date::text AS shift_date,
        cashier_id,
        status,
        start_time,
        end_time,
        opening_cash,
        expenses,
        expected_cash,
        closing_cash,
        difference,
        reconciliation_status,
        created_at,
        updated_at
      `,
      [numericOutletId, dayKey, actor, opening]
    );
    const shift = await normalizeShiftRow({ client, row: insertResult.rows[0] });
    await client.query('COMMIT');
    return shift;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const addShiftExpense = async ({ shiftId, outletId, amount }) => {
  if (!isUuid(shiftId)) {
    throw new ShiftValidationError('shift_id must be a valid UUID');
  }
  const numericOutletId = toPositiveInt(outletId, 'outlet_id');
  const expenseAmount = toMoney(amount, 'amount', { min: 0.01 });
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await ensureShiftSchema(client);
    const currentResult = await client.query(
      `
      SELECT
        id,
        outlet_id,
        shift_date::text AS shift_date,
        cashier_id,
        status,
        start_time,
        end_time,
        opening_cash,
        expenses,
        expected_cash,
        closing_cash,
        difference,
        reconciliation_status,
        created_at,
        updated_at
      FROM cashier_shifts
      WHERE id = $1
        AND outlet_id = $2
      LIMIT 1
      FOR UPDATE
      `,
      [shiftId, numericOutletId]
    );
    const row = currentResult.rows[0];
    if (!row) {
      throw new ShiftValidationError('shift not found', 404);
    }
    if (row.status !== 'OPEN') {
      throw new ShiftValidationError('Cannot add expense to a closed shift', 409);
    }

    const updateResult = await client.query(
      `
      UPDATE cashier_shifts
      SET
        expenses = expenses + $2,
        updated_at = now()
      WHERE id = $1
      RETURNING
        id,
        outlet_id,
        shift_date::text AS shift_date,
        cashier_id,
        status,
        start_time,
        end_time,
        opening_cash,
        expenses,
        expected_cash,
        closing_cash,
        difference,
        reconciliation_status,
        created_at,
        updated_at
      `,
      [shiftId, expenseAmount]
    );

    const shift = await normalizeShiftRow({ client, row: updateResult.rows[0] });
    await client.query('COMMIT');
    return shift;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const endShift = async ({ shiftId, outletId, closingCash }) => {
  if (!isUuid(shiftId)) {
    throw new ShiftValidationError('shift_id must be a valid UUID');
  }
  const numericOutletId = toPositiveInt(outletId, 'outlet_id');
  const actualCash = toMoney(closingCash, 'closing_cash');
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await ensureShiftSchema(client);
    const currentResult = await client.query(
      `
      SELECT
        id,
        outlet_id,
        shift_date::text AS shift_date,
        cashier_id,
        status,
        start_time,
        end_time,
        opening_cash,
        expenses,
        expected_cash,
        closing_cash,
        difference,
        reconciliation_status,
        created_at,
        updated_at
      FROM cashier_shifts
      WHERE id = $1
        AND outlet_id = $2
      LIMIT 1
      FOR UPDATE
      `,
      [shiftId, numericOutletId]
    );
    const row = currentResult.rows[0];
    if (!row) {
      throw new ShiftValidationError('shift not found', 404);
    }
    if (row.status !== 'OPEN') {
      throw new ShiftValidationError('Shift is already closed', 409);
    }

    const cashSales = await getShiftCashSales({
      client,
      outletId: numericOutletId,
      startTime: row.start_time,
      endTime: null,
    });
    const opening = roundMoney(row.opening_cash);
    const expenses = roundMoney(row.expenses);
    const expectedCash = roundMoney(opening + cashSales - expenses);
    const difference = roundMoney(actualCash - expectedCash);
    const reconciliationStatus =
      Math.abs(difference) < 0.01 ? 'Perfect' : difference > 0 ? 'Over' : 'Short';

    const updateResult = await client.query(
      `
      UPDATE cashier_shifts
      SET
        status = 'CLOSED',
        end_time = now(),
        expected_cash = $2,
        closing_cash = $3,
        difference = $4,
        reconciliation_status = $5,
        updated_at = now()
      WHERE id = $1
      RETURNING
        id,
        outlet_id,
        shift_date::text AS shift_date,
        cashier_id,
        status,
        start_time,
        end_time,
        opening_cash,
        expenses,
        expected_cash,
        closing_cash,
        difference,
        reconciliation_status,
        created_at,
        updated_at
      `,
      [shiftId, expectedCash, actualCash, difference, reconciliationStatus]
    );

    const shift = await normalizeShiftRow({ client, row: updateResult.rows[0] });
    await client.query('COMMIT');
    return shift;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const getDailyShiftSummary = async ({ outletIds = [], timezone = 'Asia/Karachi' }) => {
  const scopedOutletIds = Array.isArray(outletIds)
    ? outletIds
      .map((value) => Number(value))
      .filter((value, index, list) => Number.isInteger(value) && value > 0 && list.indexOf(value) === index)
    : [];

  if (!scopedOutletIds.length) {
    return {
      date: null,
      total_shifts: 0,
      open_shifts: 0,
      closed_shifts: 0,
      perfect_count: 0,
      over_count: 0,
      short_count: 0,
      total_opening_cash: 0,
      total_cash_sales: 0,
      total_expenses: 0,
      total_expected_cash: 0,
      total_closing_cash: 0,
      total_difference: 0,
      records: [],
    };
  }

  const client = await db.getClient();
  try {
    await ensureShiftSchema(client);
    const dayKey = await getTodayKeyForTimezone({ client, timezone });
    const result = await client.query(
      `
      SELECT
        s.id,
        s.outlet_id,
        s.shift_date::text AS shift_date,
        s.cashier_id,
        s.status,
        s.start_time,
        s.end_time,
        s.opening_cash,
        s.expenses,
        s.expected_cash,
        s.closing_cash,
        s.difference,
        s.reconciliation_status,
        s.created_at,
        s.updated_at,
        b.name AS branch_name
      FROM cashier_shifts s
      LEFT JOIN branches b
        ON b.id = s.outlet_id
      WHERE s.outlet_id = ANY($1::int[])
        AND s.shift_date = $2::date
      ORDER BY s.start_time DESC
      `,
      [scopedOutletIds, dayKey]
    );

    const records = [];
    for (const row of result.rows) {
      // eslint-disable-next-line no-await-in-loop
      const normalized = await normalizeShiftRow({ client, row });
      records.push({
        ...normalized,
        branch_name: row.branch_name || `Branch ${row.outlet_id}`,
      });
    }

    const summary = records.reduce(
      (acc, row) => {
        acc.total_shifts += 1;
        if (row.status === 'OPEN') acc.open_shifts += 1;
        if (row.status === 'CLOSED') acc.closed_shifts += 1;
        if (row.reconciliation_status === 'Perfect') acc.perfect_count += 1;
        if (row.reconciliation_status === 'Over') acc.over_count += 1;
        if (row.reconciliation_status === 'Short') acc.short_count += 1;
        acc.total_opening_cash = roundMoney(acc.total_opening_cash + row.opening_cash);
        acc.total_cash_sales = roundMoney(acc.total_cash_sales + row.cash_sales);
        acc.total_expenses = roundMoney(acc.total_expenses + row.expenses);
        acc.total_expected_cash = roundMoney(acc.total_expected_cash + row.expected_cash);
        acc.total_closing_cash = roundMoney(acc.total_closing_cash + (row.closing_cash || 0));
        acc.total_difference = roundMoney(acc.total_difference + (row.difference || 0));
        return acc;
      },
      {
        date: dayKey,
        total_shifts: 0,
        open_shifts: 0,
        closed_shifts: 0,
        perfect_count: 0,
        over_count: 0,
        short_count: 0,
        total_opening_cash: 0,
        total_cash_sales: 0,
        total_expenses: 0,
        total_expected_cash: 0,
        total_closing_cash: 0,
        total_difference: 0,
      }
    );

    return {
      ...summary,
      records,
    };
  } finally {
    client.release();
  }
};

module.exports = {
  ShiftValidationError,
  getTodayShift,
  startShift,
  addShiftExpense,
  endShift,
  getDailyShiftSummary,
};
