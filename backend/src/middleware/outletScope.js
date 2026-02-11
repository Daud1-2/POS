const toPositiveInt = (value) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
};

module.exports = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Missing authenticated user context' });
  }

  const requestedOutletId = toPositiveInt(req.query.outlet_id);
  const { role } = req.user;

  if (role === 'admin') {
    if (!requestedOutletId) {
      return res.status(400).json({ error: 'outlet_id is required for admin requests' });
    }
    const allowedOutletIds = Array.isArray(req.user.outlet_ids) ? req.user.outlet_ids : [];
    if (!allowedOutletIds.includes(requestedOutletId)) {
      return res.status(403).json({ error: 'Outlet is not in admin scope' });
    }
    req.effectiveOutletId = requestedOutletId;
  } else {
    const ownOutletId = toPositiveInt(req.user.outlet_id);
    if (!ownOutletId) {
      return res.status(403).json({ error: 'Authenticated user has no outlet scope' });
    }
    if (requestedOutletId && requestedOutletId !== ownOutletId) {
      return res.status(403).json({ error: 'Cross-outlet access denied' });
    }
    req.effectiveOutletId = ownOutletId;
  }

  req.effectiveTimezone = req.user.timezone || 'UTC';
  return next();
};
