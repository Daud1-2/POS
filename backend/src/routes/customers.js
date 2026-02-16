const express = require('express');
const {
  CustomerSegmentationError,
  getSegments,
  getInsights,
} = require('../services/customerSegmentationService');
const {
  CustomerCampaignError,
  createAudienceTemplate,
  listAudienceTemplates,
  exportAudienceTemplate,
} = require('../services/customerCampaignService');

const router = express.Router();

const ensureRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient role permissions' });
  }
  return next();
};

const handleError = (res, err, next) => {
  if (err instanceof CustomerSegmentationError || err instanceof CustomerCampaignError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'unique constraint violation' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'invalid reference id' });
  }
  return next(err);
};

router.get('/segments', async (req, res, next) => {
  try {
    const response = await getSegments({
      outletId: req.effectiveBranchId,
      query: req.query || {},
    });
    return res.json(response);
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.get('/insights', async (req, res, next) => {
  try {
    const response = await getInsights({
      outletId: req.effectiveBranchId,
      query: req.query || {},
    });
    return res.json({ data: response });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.post('/audiences/templates', ensureRole(['manager', 'admin']), async (req, res, next) => {
  try {
    const created = await createAudienceTemplate({
      outletId: req.effectiveBranchId,
      actorId: req.user?.sub || null,
      payload: req.body || {},
    });
    return res.status(201).json({ data: created });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.get('/audiences/templates', ensureRole(['manager', 'admin']), async (req, res, next) => {
  try {
    const response = await listAudienceTemplates({
      outletId: req.effectiveBranchId,
      query: req.query || {},
    });
    return res.json(response);
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.get('/audiences/templates/:uuid/export', ensureRole(['manager', 'admin']), async (req, res, next) => {
  try {
    const exported = await exportAudienceTemplate({
      outletId: req.effectiveBranchId,
      templateUuid: req.params.uuid,
      platform: req.query.platform,
    });

    if (String(req.query.download || '').toLowerCase() === 'true') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${exported.file_name}"`);
      return res.status(200).send(exported.csv);
    }

    return res.json({ data: exported });
  } catch (err) {
    return handleError(res, err, next);
  }
});

module.exports = router;

