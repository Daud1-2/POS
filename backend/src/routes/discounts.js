const express = require('express');
const {
  DiscountValidationError,
  parsePagination,
  toPositiveInt,
  listPromoCodes,
  createPromoCode,
  updatePromoCode,
  togglePromoCode,
  softDeletePromoCode,
  listBulkDiscounts,
  createBulkDiscount,
  updateBulkDiscount,
  toggleBulkDiscount,
  softDeleteBulkDiscount,
  computeDiscountQuote,
  validatePromoCode,
} = require('../services/discountsService');
const { getBusinessSettings } = require('../services/settingsService');

const router = express.Router();

const ensureRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient role permissions' });
  }
  return next();
};

const handleError = (res, err, next) => {
  if (err instanceof DiscountValidationError) {
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

router.get('/promo-codes', async (req, res, next) => {
  try {
    const pagination = parsePagination(req.query);
    const response = await listPromoCodes({
      outletId: req.effectiveBranchId,
      query: req.query,
      pagination,
    });
    return res.json(response);
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.post('/promo-codes', ensureRole(['manager', 'admin']), async (req, res, next) => {
  try {
    const created = await createPromoCode({
      outletId: req.effectiveBranchId,
      payload: req.body || {},
    });
    return res.status(201).json({ data: created });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.patch('/promo-codes/:uuid', ensureRole(['manager', 'admin']), async (req, res, next) => {
  try {
    const updated = await updatePromoCode({
      outletId: req.effectiveBranchId,
      promoUuid: req.params.uuid,
      payload: req.body || {},
    });
    return res.json({ data: updated });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.patch('/promo-codes/:uuid/toggle', ensureRole(['manager', 'admin']), async (req, res, next) => {
  try {
    const updated = await togglePromoCode({
      outletId: req.effectiveBranchId,
      promoUuid: req.params.uuid,
    });
    return res.json({ data: updated });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.delete('/promo-codes/:uuid', ensureRole(['manager', 'admin']), async (req, res, next) => {
  try {
    await softDeletePromoCode({
      outletId: req.effectiveBranchId,
      promoUuid: req.params.uuid,
    });
    return res.json({ data: { uuid: req.params.uuid, deleted: true } });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.post('/promo-codes/validate', async (req, res, next) => {
  try {
    const customerId = req.body?.customer_id ?? req.body?.customerId;
    const source = req.body?.source || 'pos';
    const promoCode = req.body?.promo_code ?? req.body?.promoCode ?? req.body?.code;
    const amountBeforePromo = req.body?.amount_before_promo ?? req.body?.subtotal;

    const result = await validatePromoCode({
      outletId: req.effectiveBranchId,
      promoCode,
      source,
      customerId: customerId == null ? null : toPositiveInt(customerId, 'customer_id'),
      amountBeforePromo,
    });

    return res.json({ data: result });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.get('/bulk-discounts', async (req, res, next) => {
  try {
    const pagination = parsePagination(req.query);
    const response = await listBulkDiscounts({
      outletId: req.effectiveBranchId,
      query: req.query,
      pagination,
    });
    return res.json(response);
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.post('/bulk-discounts', ensureRole(['manager', 'admin']), async (req, res, next) => {
  try {
    const created = await createBulkDiscount({
      outletId: req.effectiveBranchId,
      payload: req.body || {},
    });
    return res.status(201).json({ data: created });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.patch('/bulk-discounts/:uuid', ensureRole(['manager', 'admin']), async (req, res, next) => {
  try {
    const updated = await updateBulkDiscount({
      outletId: req.effectiveBranchId,
      bulkUuid: req.params.uuid,
      payload: req.body || {},
    });
    return res.json({ data: updated });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.patch('/bulk-discounts/:uuid/toggle', ensureRole(['manager', 'admin']), async (req, res, next) => {
  try {
    const updated = await toggleBulkDiscount({
      outletId: req.effectiveBranchId,
      bulkUuid: req.params.uuid,
    });
    return res.json({ data: updated });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.delete('/bulk-discounts/:uuid', ensureRole(['manager', 'admin']), async (req, res, next) => {
  try {
    await softDeleteBulkDiscount({
      outletId: req.effectiveBranchId,
      bulkUuid: req.params.uuid,
    });
    return res.json({ data: { uuid: req.params.uuid, deleted: true } });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.post('/quote', async (req, res, next) => {
  try {
    const source = req.body?.source || 'pos';
    const customerId = req.body?.customer_id ?? req.body?.customerId;
    const businessSettings = await getBusinessSettings();
    const result = await computeDiscountQuote({
      outletId: req.effectiveBranchId,
      source,
      customerId: customerId == null || customerId === '' ? null : toPositiveInt(customerId, 'customer_id'),
      promoCode: req.body?.promo_code ?? req.body?.promoCode ?? null,
      items: req.body?.items || [],
      tax: req.body?.tax ?? 0,
      discountStackingEnabled: businessSettings.discount_stacking_enabled,
      roundingRule: businessSettings.rounding_rule,
    });
    return res.json({ data: result });
  } catch (err) {
    return handleError(res, err, next);
  }
});

module.exports = router;

