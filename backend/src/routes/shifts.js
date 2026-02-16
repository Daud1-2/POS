const express = require('express');
const {
  ShiftValidationError,
  addShiftExpense,
  endShift,
  getTodayShift,
  startShift,
} = require('../services/shiftService');

const router = express.Router();

const ensureCashierScope = (req, res) => {
  if (req.branchScope === 'all') {
    res.status(400).json({ error: 'branch_id must be a single branch for shift operations' });
    return false;
  }
  return true;
};

router.get('/today', async (req, res, next) => {
  try {
    if (!ensureCashierScope(req, res)) return;
    const result = await getTodayShift({
      outletId: req.effectiveBranchId,
      timezone: req.effectiveTimezone,
    });
    return res.json({ data: result });
  } catch (err) {
    if (err instanceof ShiftValidationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

router.post('/start', async (req, res, next) => {
  try {
    if (!ensureCashierScope(req, res)) return;
    const shift = await startShift({
      outletId: req.effectiveBranchId,
      openingCash: req.body?.opening_cash,
      cashierId: req.user?.sub || null,
      timezone: req.effectiveTimezone,
    });
    return res.status(201).json({ data: shift });
  } catch (err) {
    if (err instanceof ShiftValidationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

router.post('/:shift_id/expenses', async (req, res, next) => {
  try {
    if (!ensureCashierScope(req, res)) return;
    const shift = await addShiftExpense({
      shiftId: req.params.shift_id,
      outletId: req.effectiveBranchId,
      amount: req.body?.amount,
    });
    return res.json({ data: shift });
  } catch (err) {
    if (err instanceof ShiftValidationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

router.post('/:shift_id/end', async (req, res, next) => {
  try {
    if (!ensureCashierScope(req, res)) return;
    const shift = await endShift({
      shiftId: req.params.shift_id,
      outletId: req.effectiveBranchId,
      closingCash: req.body?.closing_cash,
    });
    return res.json({ data: shift });
  } catch (err) {
    if (err instanceof ShiftValidationError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    return next(err);
  }
});

module.exports = router;
