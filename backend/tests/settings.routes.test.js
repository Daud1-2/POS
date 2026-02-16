process.env.ALLOW_DEV_AUTH_BYPASS = 'true';

const request = require('supertest');

jest.mock('../src/services/settingsService', () => {
  class SettingsValidationError extends Error {
    constructor(message, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  return {
    SettingsValidationError,
    getBusinessSettings: jest.fn(),
    updateBusinessSettings: jest.fn(),
    getBranchSettingsById: jest.fn(),
    listBranchesByScope: jest.fn(),
    createBranch: jest.fn(),
    deleteBranch: jest.fn(),
    updateBranchSettings: jest.fn(),
  };
});

const {
  getBusinessSettings,
  updateBusinessSettings,
  getBranchSettingsById,
  listBranchesByScope,
  createBranch,
  deleteBranch,
  updateBranchSettings,
} = require('../src/services/settingsService');
const app = require('../src/app');

describe('settings routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/settings/business returns business settings', async () => {
    getBusinessSettings.mockResolvedValue({
      default_currency: 'PKR',
      tax_enabled: true,
      default_tax_percent: 16,
      rounding_rule: 'none',
      discount_stacking_enabled: true,
    });

    const res = await request(app)
      .get('/api/settings/business')
      .query({ branch_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.default_currency).toBe('PKR');
    expect(getBusinessSettings).toHaveBeenCalledTimes(1);
  });

  test('PUT /api/settings/business is admin-only', async () => {
    const res = await request(app)
      .put('/api/settings/business')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 })
      .send({ tax_enabled: true });

    expect(res.status).toBe(403);
    expect(updateBusinessSettings).not.toHaveBeenCalled();
  });

  test('PUT /api/settings/business updates settings for admin', async () => {
    updateBusinessSettings.mockResolvedValue({
      default_currency: 'PKR',
      tax_enabled: false,
      default_tax_percent: 0,
      rounding_rule: 'none',
      discount_stacking_enabled: true,
    });

    const res = await request(app)
      .put('/api/settings/business')
      .set('x-dev-role', 'admin')
      .set('x-dev-branch-ids', '1,2')
      .query({ branch_id: 1 })
      .send({ tax_enabled: false, default_tax_percent: 0 });

    expect(res.status).toBe(200);
    expect(updateBusinessSettings).toHaveBeenCalledTimes(1);
  });

  test('GET /api/settings/branch returns branch settings', async () => {
    getBranchSettingsById.mockResolvedValue({
      branch: { id: 1, branch_id: 1, name: 'Branch 1', timezone: 'UTC' },
      settings: { is_open: true, accepting_orders: true },
    });

    const res = await request(app)
      .get('/api/settings/branch')
      .query({ branch_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.branch.id).toBe(1);
  });

  test('PUT /api/settings/branch allows manager and blocks cashier', async () => {
    const denied = await request(app)
      .put('/api/settings/branch')
      .set('x-dev-role', 'cashier')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 })
      .send({ is_open: false });

    expect(denied.status).toBe(403);
    expect(updateBranchSettings).not.toHaveBeenCalled();

    updateBranchSettings.mockResolvedValue({
      branch: { id: 1, branch_id: 1, name: 'Branch 1', timezone: 'UTC' },
      settings: { is_open: false, accepting_orders: true },
    });

    const allowed = await request(app)
      .put('/api/settings/branch')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 })
      .send({ is_open: false });

    expect(allowed.status).toBe(200);
    expect(updateBranchSettings).toHaveBeenCalledTimes(1);
  });

  test('GET /api/settings/branches returns scoped branch list', async () => {
    listBranchesByScope.mockResolvedValue([
      { id: 1, branch_id: 1, name: 'Main', timezone: 'UTC', is_active: true },
      { id: 2, branch_id: 2, name: 'Airport', timezone: 'UTC', is_active: true },
    ]);

    const res = await request(app)
      .get('/api/settings/branches')
      .set('x-dev-role', 'admin')
      .set('x-dev-branch-ids', '1,2')
      .query({ branch_id: 1 });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(2);
  });

  test('POST /api/settings/branches is admin only', async () => {
    const denied = await request(app)
      .post('/api/settings/branches')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 })
      .send({ name: 'New Branch', timezone: 'UTC' });

    expect(denied.status).toBe(403);
    expect(createBranch).not.toHaveBeenCalled();

    createBranch.mockResolvedValue({
      branch: { id: 3, branch_id: 3, name: 'New Branch', timezone: 'UTC' },
      settings: { is_open: true, accepting_orders: true },
    });

    const allowed = await request(app)
      .post('/api/settings/branches')
      .set('x-dev-role', 'admin')
      .set('x-dev-branch-ids', '1,2,3')
      .query({ branch_id: 1 })
      .send({ name: 'New Branch', timezone: 'UTC' });

    expect(allowed.status).toBe(201);
    expect(createBranch).toHaveBeenCalledTimes(1);
  });

  test('DELETE /api/settings/branches/:branch_id is admin only', async () => {
    const denied = await request(app)
      .delete('/api/settings/branches/2')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 });

    expect(denied.status).toBe(403);
    expect(deleteBranch).not.toHaveBeenCalled();

    deleteBranch.mockResolvedValue({ branch_id: 2, deleted: true });

    const allowed = await request(app)
      .delete('/api/settings/branches/2')
      .set('x-dev-role', 'admin')
      .set('x-dev-branch-ids', '1,2,3')
      .query({ branch_id: 1 });

    expect(allowed.status).toBe(200);
    expect(deleteBranch).toHaveBeenCalledTimes(1);
    expect(allowed.body.data).toEqual({ branch_id: 2, deleted: true });
  });
});

