const db = require('../services/db');

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

module.exports = async (req, res, next) => {
  if (!WRITE_METHODS.has(req.method)) {
    return next();
  }

  const effectiveBranchId = req.effectiveBranchId;
  if (!req.user || !effectiveBranchId) {
    return next();
  }

  if (req.user.role === 'admin') {
    return next();
  }

  try {
    const lookup = await db.query(
      `
      SELECT bs.maintenance_mode
      FROM branch_settings bs
      JOIN branches b ON bs.branch_id = b.id
      WHERE b.id = $1
        AND b.deleted_at IS NULL
      LIMIT 1
      `,
      [effectiveBranchId]
    );
    const directMaintenance = Boolean(lookup?.rows?.[0]?.maintenance_mode);
    if (directMaintenance) {
      return res.status(503).json({ error: 'Branch is in maintenance mode' });
    }
    return next();
  } catch (err) {
    return next();
  }
};
