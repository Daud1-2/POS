const toPositiveInt = (value) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
};
const DEFAULT_TIMEZONE = 'Asia/Karachi';

const parseBranchScope = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (String(value).trim().toLowerCase() === 'all') return 'all';
  return toPositiveInt(value);
};

module.exports = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Missing authenticated user context' });
  }

  const requestedBranch = parseBranchScope(req.query.branch_id);
  const { role } = req.user;

  if (role === 'admin') {
    const allowedBranchIds = Array.isArray(req.user.branch_ids) ? req.user.branch_ids : [];
    if (!allowedBranchIds.length) {
      return res.status(403).json({ error: 'Authenticated admin has no branch scope' });
    }

    if (requestedBranch === 'all' || requestedBranch === null) {
      req.effectiveBranchIds = [...allowedBranchIds];
      req.effectiveBranchId = allowedBranchIds[0];
      req.branchScope = 'all';
    } else if (!allowedBranchIds.includes(requestedBranch)) {
      // Stale client scope fallback: keep admin inside allowed scope without hard failure.
      req.effectiveBranchIds = [allowedBranchIds[0]];
      req.effectiveBranchId = allowedBranchIds[0];
      req.branchScope = 'single';
    } else {
      req.effectiveBranchIds = [requestedBranch];
      req.effectiveBranchId = requestedBranch;
      req.branchScope = 'single';
    }
  } else {
    const ownBranchId = toPositiveInt(req.user.branch_id);
    if (!ownBranchId) {
      return res.status(403).json({ error: 'Authenticated user has no branch scope' });
    }
    if (requestedBranch === 'all') {
      return res.status(403).json({ error: 'Cross-branch access denied' });
    }
    if (requestedBranch && requestedBranch !== ownBranchId) {
      return res.status(403).json({ error: 'Cross-branch access denied' });
    }
    req.effectiveBranchIds = [ownBranchId];
    req.effectiveBranchId = ownBranchId;
    req.branchScope = 'single';
  }

  if (!Array.isArray(req.effectiveBranchIds) || req.effectiveBranchIds.length === 0) {
    req.effectiveBranchIds = [req.effectiveBranchId];
  }
  req.effectiveTimezone = req.user.timezone || DEFAULT_TIMEZONE;
  return next();
};
