const express = require('express');
const {
  SyncValidationError,
  registerDevice,
  pushSyncBatch,
  pullSync,
  bootstrapSync,
  resolveSyncConflict,
} = require('../services/syncService');

const router = express.Router();

const toPositiveInt = (value, fallback = null) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const ensureRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient role permissions' });
  }
  return next();
};

const resolveScopedBranchId = (req, explicitValue = null) => {
  if (req.branchScope === 'all') {
    const requested = toPositiveInt(explicitValue ?? req.query?.branch_id ?? req.body?.branch_id, null);
    if (!requested) {
      throw new SyncValidationError('branch_id is required when admin scope is all');
    }
    const allowed = Array.isArray(req.effectiveBranchIds) ? req.effectiveBranchIds : [];
    if (!allowed.includes(requested)) {
      throw new SyncValidationError('Branch is not in admin scope', 403);
    }
    return requested;
  }
  return req.effectiveBranchId;
};

const handleSyncError = (res, err, next) => {
  if (err instanceof SyncValidationError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  return next(err);
};

router.post('/devices/register', ensureRole(['manager', 'admin']), async (req, res, next) => {
  try {
    const branchId = resolveScopedBranchId(req, req.body?.branch_id ?? req.body?.branchId);
    const data = await registerDevice({
      payload: req.body || {},
      context: {
        branchId,
        actorId: req.user?.sub || 'unknown-user',
        role: req.user?.role || 'cashier',
      },
    });
    return res.status(201).json({ data });
  } catch (err) {
    return handleSyncError(res, err, next);
  }
});

router.post('/sync/push', async (req, res, next) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query?.branch_id ?? req.body?.branch_id ?? req.body?.branchId);
    const data = await pushSyncBatch({
      payload: req.body || {},
      context: {
        branchId,
        actorId: req.user?.sub || 'unknown-user',
        role: req.user?.role || 'cashier',
        headers: req.headers || {},
      },
    });
    return res.json({ data });
  } catch (err) {
    return handleSyncError(res, err, next);
  }
});

router.get('/sync/pull', async (req, res, next) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query?.branch_id);
    const data = await pullSync({
      query: req.query || {},
      context: {
        branchId,
        headers: req.headers || {},
      },
    });
    return res.json({ data });
  } catch (err) {
    return handleSyncError(res, err, next);
  }
});

router.get('/sync/bootstrap', async (req, res, next) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query?.branch_id);
    const data = await bootstrapSync({
      context: {
        branchId,
        headers: req.headers || {},
      },
    });
    return res.json({ data });
  } catch (err) {
    return handleSyncError(res, err, next);
  }
});

router.post('/sync/conflicts/:conflict_id/resolve', ensureRole(['manager', 'admin']), async (req, res, next) => {
  try {
    const branchId = resolveScopedBranchId(req, req.query?.branch_id ?? req.body?.branch_id ?? req.body?.branchId);
    const data = await resolveSyncConflict({
      conflictId: req.params.conflict_id,
      payload: req.body || {},
      context: {
        branchId,
        actorId: req.user?.sub || 'unknown-user',
        role: req.user?.role || 'cashier',
      },
    });
    return res.json({ data });
  } catch (err) {
    return handleSyncError(res, err, next);
  }
});

module.exports = router;
