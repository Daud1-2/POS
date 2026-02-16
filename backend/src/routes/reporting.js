const express = require('express');
const {
  ReportingValidationError,
  getRevenueOverview,
  getRevenueTrend,
  getPaymentOverview,
  getPaymentTrend,
  getDiscountOverview,
  getDiscountDeals,
  getProductsIntelligence,
  getTimeAnalysis,
  getBranchComparison,
} = require('../services/reportingService');

const router = express.Router();

const handleError = (res, err, next) => {
  if (err instanceof ReportingValidationError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  return next(err);
};

router.get('/revenue/overview', async (req, res, next) => {
  try {
    const data = await getRevenueOverview({
      branchIds: req.reportingBranchIds,
      query: req.query || {},
      timezone: req.reportingTimezone,
    });
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.get('/revenue/trend', async (req, res, next) => {
  try {
    const data = await getRevenueTrend({
      branchIds: req.reportingBranchIds,
      query: req.query || {},
      timezone: req.reportingTimezone,
    });
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.get('/payments/overview', async (req, res, next) => {
  try {
    const data = await getPaymentOverview({
      branchIds: req.reportingBranchIds,
      query: req.query || {},
      timezone: req.reportingTimezone,
    });
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.get('/payments/trend', async (req, res, next) => {
  try {
    const data = await getPaymentTrend({
      branchIds: req.reportingBranchIds,
      query: req.query || {},
      timezone: req.reportingTimezone,
    });
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.get('/discounts/overview', async (req, res, next) => {
  try {
    const data = await getDiscountOverview({
      branchIds: req.reportingBranchIds,
      query: req.query || {},
      timezone: req.reportingTimezone,
    });
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.get('/discounts/deals', async (req, res, next) => {
  try {
    const data = await getDiscountDeals({
      branchIds: req.reportingBranchIds,
      query: req.query || {},
      timezone: req.reportingTimezone,
    });
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.get('/products/intelligence', async (req, res, next) => {
  try {
    const data = await getProductsIntelligence({
      branchIds: req.reportingBranchIds,
      query: req.query || {},
      timezone: req.reportingTimezone,
    });
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.get('/time/analysis', async (req, res, next) => {
  try {
    const data = await getTimeAnalysis({
      branchIds: req.reportingBranchIds,
      query: req.query || {},
      timezone: req.reportingTimezone,
    });
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

router.get('/branches/compare', async (req, res, next) => {
  try {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'Branch comparison is restricted to admin users' });
    }

    const data = await getBranchComparison({
      branchIds: req.reportingBranchIds,
      query: req.query || {},
      timezone: req.reportingTimezone,
    });
    return res.json({ data });
  } catch (err) {
    return handleError(res, err, next);
  }
});

module.exports = router;


