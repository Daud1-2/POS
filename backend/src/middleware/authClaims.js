const jwt = require('jsonwebtoken');

const ROLES = new Set(['cashier', 'manager', 'admin']);
const DEFAULT_TIMEZONE = 'Asia/Karachi';

const toPositiveInt = (value) => {
  const num = Number(value);
  if (!Number.isInteger(num) || num <= 0) return null;
  return num;
};

const parsePositiveIntArray = (value) => {
  if (Array.isArray(value)) {
    const parsed = value.map(toPositiveInt).filter(Boolean);
    return parsed.length ? Array.from(new Set(parsed)) : null;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = value
      .split(',')
      .map((part) => toPositiveInt(part.trim()))
      .filter(Boolean);
    return parsed.length ? Array.from(new Set(parsed)) : null;
  }

  const single = toPositiveInt(value);
  return single ? [single] : null;
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

const validateClaims = (claims) => {
  const role = claims?.role;
  if (!ROLES.has(role)) {
    return { error: 'Invalid role claim' };
  }

  const user = {
    sub: String(claims?.sub || ''),
    role,
    timezone: normalizeTimezone(claims?.timezone),
  };

  if (role === 'admin') {
    const branchIds = parsePositiveIntArray(claims?.branch_ids ?? claims?.outlet_ids);
    if (!branchIds) {
      return { error: 'Admin token must include branch_ids' };
    }
    user.branch_ids = branchIds;
    return { user };
  }

  const branchId = toPositiveInt(claims?.branch_id ?? claims?.outlet_id);
  if (!branchId) {
    return { error: 'Cashier/manager token must include branch_id' };
  }
  user.branch_id = branchId;
  return { user };
};

const allowDevBypass = () => {
  if (process.env.ALLOW_DEV_AUTH_BYPASS === 'true') return true;
  if (process.env.ALLOW_DEV_AUTH_BYPASS === 'false') return false;
  return process.env.NODE_ENV !== 'production';
};

const buildDevClaims = (req) => {
  const role = req.header('x-dev-role') || 'admin';
  const branchIdFromHeader = req.header('x-dev-branch-id');
  const branchIdFromQuery = req.query.branch_id;
  const fallbackBranch = branchIdFromHeader || branchIdFromQuery || '1';
  const branchIdsRaw =
    req.header('x-dev-branch-ids') || fallbackBranch;

  return {
    sub: req.header('x-dev-sub') || 'dev-user',
    role,
    branch_id: fallbackBranch,
    branch_ids: branchIdsRaw,
    timezone: req.header('x-dev-timezone') || DEFAULT_TIMEZONE,
  };
};

module.exports = (req, res, next) => {
  const authHeader = req.header('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    if (!allowDevBypass()) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const { user, error } = validateClaims(buildDevClaims(req));
    if (error) {
      return res.status(401).json({ error });
    }
    req.user = user;
    return next();
  }

  try {
    const secret = process.env.JWT_SECRET || 'dev-secret';
    const claims = jwt.verify(token, secret);
    const { user, error } = validateClaims(claims);
    if (error) {
      return res.status(401).json({ error });
    }
    req.user = user;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};
