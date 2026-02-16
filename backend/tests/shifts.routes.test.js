process.env.ALLOW_DEV_AUTH_BYPASS = 'true';

const request = require('supertest');

jest.mock('../src/services/db', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/shiftService', () => {
  class ShiftValidationError extends Error {
    constructor(message, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  return {
    ShiftValidationError,
    getTodayShift: jest.fn(),
    startShift: jest.fn(),
    addShiftExpense: jest.fn(),
    endShift: jest.fn(),
  };
});

const {
  getTodayShift,
  startShift,
  addShiftExpense,
  endShift,
  ShiftValidationError,
} = require('../src/services/shiftService');
const app = require('../src/app');

describe('shifts routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns today shift', async () => {
    getTodayShift.mockResolvedValue({
      date: '2026-02-16',
      shift: null,
    });

    const res = await request(app)
      .get('/api/shifts/today')
      .query({ branch_id: 1 });

    expect(res.status).toBe(200);
    expect(getTodayShift).toHaveBeenCalledTimes(1);
    expect(res.body.data).toMatchObject({ date: '2026-02-16' });
  });

  test('starts shift and stores opening cash', async () => {
    startShift.mockResolvedValue({
      id: 'ee0f0adb-e31e-4add-b08b-b1a02bddf1db',
      status: 'OPEN',
      opening_cash: 10000,
    });

    const res = await request(app)
      .post('/api/shifts/start')
      .query({ branch_id: 1 })
      .send({ opening_cash: 10000 });

    expect(res.status).toBe(201);
    expect(startShift).toHaveBeenCalledTimes(1);
    expect(res.body.data).toMatchObject({
      status: 'OPEN',
      opening_cash: 10000,
    });
  });

  test('blocks all-branch scope for shift writes', async () => {
    const res = await request(app)
      .post('/api/shifts/start')
      .set('x-dev-role', 'admin')
      .set('x-dev-branch-ids', '1,2')
      .query({ branch_id: 'all' })
      .send({ opening_cash: 10000 });

    expect(res.status).toBe(400);
    expect(startShift).not.toHaveBeenCalled();
  });

  test('returns service validation errors', async () => {
    endShift.mockRejectedValue(
      new ShiftValidationError('Opening cash already recorded for 2026-02-16 and cannot be changed', 409)
    );

    const res = await request(app)
      .post('/api/shifts/ee0f0adb-e31e-4add-b08b-b1a02bddf1db/end')
      .query({ branch_id: 1 })
      .send({ closing_cash: 11000 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/cannot be changed/i);
  });

  test('adds shift expense', async () => {
    addShiftExpense.mockResolvedValue({
      id: 'ee0f0adb-e31e-4add-b08b-b1a02bddf1db',
      status: 'OPEN',
      expenses: 250,
    });

    const res = await request(app)
      .post('/api/shifts/ee0f0adb-e31e-4add-b08b-b1a02bddf1db/expenses')
      .query({ branch_id: 1 })
      .send({ amount: 250 });

    expect(res.status).toBe(200);
    expect(addShiftExpense).toHaveBeenCalledTimes(1);
    expect(res.body.data.expenses).toBe(250);
  });
});
