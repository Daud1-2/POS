const express = require('express');
const {
  SettingsValidationError,
  getBusinessSettings,
  updateBusinessSettings,
  getBranchSettingsById,
  listBranchesByScope,
  createBranch,
  deleteBranch,
  updateBranchSettings,
} = require('../services/settingsService');

const router = express.Router();

const ensureRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient role permissions' });
  }
  return next();
};

const handleError = (res, err, next) => {
  if (err instanceof SettingsValidationError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'unique constraint violation' });
  }
  return next(err);
};

router.get('/business', async (req, res, next) => {
  try {
    const data = await getBusinessSettings();
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.put('/business', ensureRole(['admin']), async (req, res, next) => {
  try {
    const data = await updateBusinessSettings(req.body || {});
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.get('/branch', async (req, res, next) => {
  try {
    const data = await getBranchSettingsById(req.effectiveBranchId);
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.get('/branches', async (req, res, next) => {
  try {
    const data = await listBranchesByScope({
      user: req.user,
      fallbackBranchId: req.effectiveBranchId,
    });
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.post('/branches', ensureRole(['admin']), async (req, res, next) => {
  try {
    const data = await createBranch({
      payload: req.body || {},
      user: req.user,
    });
    return res.status(201).json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.delete('/branches/:branch_id', ensureRole(['admin']), async (req, res, next) => {
  try {
    const data = await deleteBranch({
      branchId: req.params.branch_id,
      user: req.user,
    });
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.put('/branch', ensureRole(['manager', 'admin']), async (req, res, next) => {
  try {
    const data = await updateBranchSettings(req.effectiveBranchId, req.body || {});
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

module.exports = router;

