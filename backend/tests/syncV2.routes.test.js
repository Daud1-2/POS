process.env.ALLOW_DEV_AUTH_BYPASS = 'true';

const request = require('supertest');

jest.mock('../src/services/syncService', () => ({
  SyncValidationError: class SyncValidationError extends Error {
    constructor(message, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  },
  registerDevice: jest.fn(),
  pushSyncBatch: jest.fn(),
  pullSync: jest.fn(),
  bootstrapSync: jest.fn(),
  resolveSyncConflict: jest.fn(),
}));

const {
  registerDevice,
  pushSyncBatch,
  pullSync,
  bootstrapSync,
  resolveSyncConflict,
} = require('../src/services/syncService');
const app = require('../src/app');

describe('sync v2 routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('registers device (manager/admin only)', async () => {
    registerDevice.mockResolvedValue({
      device_id: 'f5940a7a-8034-4068-b11f-e20da04e3ea9',
      terminal_code: 'BR001-T03',
      key_version: 1,
      device_secret: 'secret',
    });

    const res = await request(app)
      .post('/api/v2/devices/register')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 })
      .send({
        terminal_code: 'BR001-T03',
      });

    expect(res.status).toBe(201);
    expect(registerDevice).toHaveBeenCalledTimes(1);
    expect(res.body.data.device_id).toBe('f5940a7a-8034-4068-b11f-e20da04e3ea9');
  });

  test('pushes sync batch', async () => {
    pushSyncBatch.mockResolvedValue({
      branch_id: 1,
      device_id: 'f5940a7a-8034-4068-b11f-e20da04e3ea9',
      results: [{ event_id: 'e1', status: 'accepted' }],
    });

    const res = await request(app)
      .post('/api/v2/sync/push')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .set('x-device-id', 'f5940a7a-8034-4068-b11f-e20da04e3ea9')
      .set('x-terminal-code', 'BR001-T03')
      .set('x-request-timestamp', new Date().toISOString())
      .set('x-signature', 'test-signature')
      .set('x-idempotency-key', 'req-key')
      .query({ branch_id: 1 })
      .send({
        events: [],
      });

    expect(res.status).toBe(200);
    expect(pushSyncBatch).toHaveBeenCalledTimes(1);
    expect(res.body.data.branch_id).toBe(1);
  });

  test('pulls sync deltas', async () => {
    pullSync.mockResolvedValue({
      branch_id: 1,
      server_time: new Date().toISOString(),
      deltas: {
        catalog_products: [],
      },
    });

    const res = await request(app)
      .get('/api/v2/sync/pull')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .set('x-device-id', 'f5940a7a-8034-4068-b11f-e20da04e3ea9')
      .set('x-terminal-code', 'BR001-T03')
      .set('x-request-timestamp', new Date().toISOString())
      .set('x-signature', 'test-signature')
      .set('x-idempotency-key', 'req-key')
      .query({ branch_id: 1 });

    expect(res.status).toBe(200);
    expect(pullSync).toHaveBeenCalledTimes(1);
  });

  test('bootstraps sync snapshot', async () => {
    bootstrapSync.mockResolvedValue({
      branch_id: 1,
      snapshot: {
        catalog_products: [],
      },
    });

    const res = await request(app)
      .get('/api/v2/sync/bootstrap')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .set('x-device-id', 'f5940a7a-8034-4068-b11f-e20da04e3ea9')
      .set('x-terminal-code', 'BR001-T03')
      .set('x-request-timestamp', new Date().toISOString())
      .set('x-signature', 'test-signature')
      .set('x-idempotency-key', 'req-key')
      .query({ branch_id: 1 });

    expect(res.status).toBe(200);
    expect(bootstrapSync).toHaveBeenCalledTimes(1);
  });

  test('resolves conflict as manager', async () => {
    resolveSyncConflict.mockResolvedValue({
      id: '4f00e7bd-4e2f-4f2b-8e53-15f45f709f2e',
      status: 'resolved',
    });

    const res = await request(app)
      .post('/api/v2/sync/conflicts/4f00e7bd-4e2f-4f2b-8e53-15f45f709f2e/resolve')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 })
      .send({ action: 'resolve' });

    expect(res.status).toBe(200);
    expect(resolveSyncConflict).toHaveBeenCalledTimes(1);
    expect(res.body.data.status).toBe('resolved');
  });
});
