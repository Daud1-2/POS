const toPositiveInt = (value) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
};
const DEFAULT_TIMEZONE = 'Asia/Karachi';

const parseBranchIds = (value) => {
  if (Array.isArray(value)) {
    const parsed = value.map(toPositiveInt).filter(Boolean);
    return Array.from(new Set(parsed));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = value
      .split(',')
      .map((part) => toPositiveInt(part.trim()))
      .filter(Boolean);
    return Array.from(new Set(parsed));
  }

  const single = toPositiveInt(value);
  return single ? [single] : [];
};

const normalizeTimezone = (timezone) => {
  if (typeof timezone !== 'string' || !timezone.trim()) return DEFAULT_TIMEZONE;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone.trim() });
    return timezone.trim();
  } catch (err) {
    return DEFAULT_TIMEZONE;
  }
};

module.exports = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Missing authenticated user context' });
  }

  const role = req.user.role;
  const isBranchComparison = req.path === '/branches/compare';
  const queryBranchId = toPositiveInt(req.query.branch_id);
  const queryBranchIds = parseBranchIds(req.query.branch_ids);

  req.reportingTimezone = normalizeTimezone(req.query.timezone || req.user.timezone || DEFAULT_TIMEZONE);

  if (role === 'admin') {
    const allowedBranchIds = Array.isArray(req.user.branch_ids) ? req.user.branch_ids : [];
    if (!allowedBranchIds.length) {
      return res.status(403).json({ error: 'Authenticated admin has no branch scope' });
    }

    if (isBranchComparison) {
      if (!queryBranchIds.length) {
        return res.status(400).json({ error: 'branch_ids is required for branch comparison' });
      }
      const requested = queryBranchIds.filter((id) => allowedBranchIds.includes(id));
      if (!requested.length) {
        return res.status(403).json({ error: 'No requested branches are in admin scope' });
      }
      req.reportingMode = 'multi';
      req.reportingBranchIds = requested;
      req.effectiveBranchId = requested[0];
      return next();
    }

    if (!queryBranchId) {
      return res.status(400).json({ error: 'branch_id is required for admin requests' });
    }

    req.reportingMode = 'single';
    if (!allowedBranchIds.includes(queryBranchId)) {
      req.reportingBranchIds = [allowedBranchIds[0]];
      req.effectiveBranchId = allowedBranchIds[0];
    } else {
      req.reportingBranchIds = [queryBranchId];
      req.effectiveBranchId = queryBranchId;
    }
    return next();
  }

  const ownBranchId = toPositiveInt(req.user.branch_id);
  if (!ownBranchId) {
    return res.status(403).json({ error: 'Authenticated user has no branch scope' });
  }

  if (isBranchComparison) {
    return res.status(403).json({ error: 'Branch comparison is restricted to admin users' });
  }

  if (queryBranchId && queryBranchId !== ownBranchId) {
    return res.status(403).json({ error: 'Cross-branch access denied' });
  }

  req.reportingMode = 'single';
  req.reportingBranchIds = [ownBranchId];
  req.effectiveBranchId = ownBranchId;
  return next();
};
