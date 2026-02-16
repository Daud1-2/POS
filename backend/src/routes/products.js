const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../services/db');
const {
  CatalogValidationError,
  parsePagination,
  toBool,
  toPositiveInt,
  getCompatProducts,
  listSections,
  createSection,
  updateSection,
  reorderSections,
  softDeleteSection,
  listItems,
  getProductByUid,
  createItem,
  updateItem,
  setItemActive,
  softDeleteItem,
  listImages,
  addImage,
  updateImage,
  softDeleteImage,
  listBranchSettings,
  upsertBranchSetting,
  getDefaultSectionId,
} = require('../services/catalogService');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '../../uploads/products');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
    const suffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    cb(null, `${suffix}${ext}`);
  },
});

const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 500 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith('image/')) {
      return cb(new CatalogValidationError('only image uploads are allowed'));
    }
    return cb(null, true);
  },
});

const asyncHandler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    next(err);
  }
};

const ensureRole = (roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient role permissions' });
  }
  return next();
};

const resolveScopedBranch = (req, value) => {
  const requested = toPositiveInt(value);

  if (!req.user) {
    throw new CatalogValidationError('Missing authenticated user context', 401);
  }

  if (req.user.role === 'admin') {
    const allowed = Array.isArray(req.user.branch_ids) ? req.user.branch_ids : [];
    if (!allowed.length) {
      throw new CatalogValidationError('Authenticated admin has no branch scope', 403);
    }
    if (!requested) {
      return req.effectiveBranchId || allowed[0];
    }
    if (!allowed.includes(requested)) {
      return req.effectiveBranchId || allowed[0];
    }
    return requested;
  }

  if (!requested) {
    throw new CatalogValidationError('branch_id must be a positive integer');
  }

  if (requested !== req.effectiveBranchId) {
    throw new CatalogValidationError('Cross-branch access denied', 403);
  }
  return requested;
};

const mapLegacyResponse = (product) => ({
  id: product.id,
  name: product.name,
  sku: product.sku,
  price: Number(product.base_price),
  stock: Number(product.stock_quantity),
  is_active: product.is_active,
  created_at: product.created_at,
  updated_at: product.updated_at,
});

const handleCatalogError = (res, err) => {
  if (err instanceof CatalogValidationError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'unique constraint violation' });
  }
  throw err;
};

// GET /api/products
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const data = await getCompatProducts({ outletId: req.effectiveBranchId });
    return res.json({ data });
  })
);

// GET /api/products/items
router.get(
  '/items',
  asyncHandler(async (req, res) => {
    const pagination = parsePagination(req.query);
    const includeInactive = toBool(req.query.include_inactive, false) && req.user.role !== 'cashier';
    const includeUnavailable = toBool(req.query.include_unavailable, false) && req.user.role !== 'cashier';
    const response = await listItems({
      outletId: req.effectiveBranchId,
      sectionId: req.query.section_id || null,
      search: req.query.search || null,
      pagination,
      includeInactive,
      includeUnavailable,
    });
    return res.json(response);
  })
);

// POST /api/products/items
router.post(
  '/items',
  ensureRole(['manager', 'admin']),
  asyncHandler(async (req, res, next) => {
    try {
      const created = await createItem({
        outletId: req.effectiveBranchId,
        payload: req.body || {},
      });
      return res.status(201).json({ data: created });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

router.patch(
  '/items/:product_uid',
  ensureRole(['manager', 'admin']),
  asyncHandler(async (req, res, next) => {
    try {
      const updated = await updateItem({
        productUid: req.params.product_uid,
        payload: req.body || {},
        outletId: req.effectiveBranchId,
      });
      return res.json({ data: updated });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

router.patch(
  '/items/:product_uid/active',
  ensureRole(['manager', 'admin']),
  asyncHandler(async (req, res, next) => {
    try {
      const isActive = toBool(req.body?.is_active, true);
      await setItemActive({ productUid: req.params.product_uid, isActive });
      return res.json({ data: { product_uid: req.params.product_uid, is_active: isActive } });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

router.delete(
  '/items/:product_uid',
  ensureRole(['manager', 'admin']),
  asyncHandler(async (req, res, next) => {
    try {
      await softDeleteItem({ productUid: req.params.product_uid });
      return res.json({ data: { product_uid: req.params.product_uid, deleted: true } });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

// Sections
router.get(
  '/sections',
  asyncHandler(async (req, res) => {
    const data = await listSections({ outletId: req.effectiveBranchId });
    return res.json({ data });
  })
);

router.post(
  '/sections',
  ensureRole(['admin']),
  asyncHandler(async (req, res, next) => {
    try {
      const created = await createSection({
        outletId: req.effectiveBranchId,
        payload: req.body || {},
      });
      return res.status(201).json({ data: created });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

router.patch(
  '/sections/reorder',
  ensureRole(['admin']),
  asyncHandler(async (req, res, next) => {
    try {
      await reorderSections({
        items: req.body?.items || [],
        outletId: req.effectiveBranchId,
      });
      return res.json({ data: { reordered: true } });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

router.patch(
  '/sections/:section_id',
  ensureRole(['admin']),
  asyncHandler(async (req, res, next) => {
    try {
      const updated = await updateSection({
        sectionId: req.params.section_id,
        payload: req.body || {},
        outletId: req.effectiveBranchId,
      });
      return res.json({ data: updated });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

router.delete(
  '/sections/:section_id',
  ensureRole(['admin']),
  asyncHandler(async (req, res, next) => {
    try {
      await softDeleteSection({
        sectionId: req.params.section_id,
        outletId: req.effectiveBranchId,
      });
      return res.json({ data: { section_id: req.params.section_id, deleted: true } });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

// Images
router.get(
  '/items/:product_uid/images',
  asyncHandler(async (req, res, next) => {
    try {
      const data = await listImages({ productUid: req.params.product_uid });
      return res.json({ data });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

router.post(
  '/items/:product_uid/images',
  ensureRole(['manager', 'admin']),
  asyncHandler(async (req, res, next) => {
    try {
      const created = await addImage({
        productUid: req.params.product_uid,
        payload: req.body || {},
      });
      return res.status(201).json({ data: created });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

router.post(
  '/items/:product_uid/images/upload',
  ensureRole(['manager', 'admin']),
  uploadImage.single('image'),
  asyncHandler(async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'image file is required' });
      }
      const imageUrl = `${req.protocol}://${req.get('host')}/uploads/products/${req.file.filename}`;
      const created = await addImage({
        productUid: req.params.product_uid,
        payload: {
          image_url: imageUrl,
          display_order: req.body?.display_order ? Number(req.body.display_order) : 0,
          is_primary: toBool(req.body?.is_primary, false),
        },
      });
      return res.status(201).json({ data: created });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

router.patch(
  '/items/:product_uid/images/:image_id',
  ensureRole(['manager', 'admin']),
  asyncHandler(async (req, res, next) => {
    try {
      const updated = await updateImage({
        productUid: req.params.product_uid,
        imageId: req.params.image_id,
        payload: req.body || {},
      });
      return res.json({ data: updated });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

router.delete(
  '/items/:product_uid/images/:image_id',
  ensureRole(['manager', 'admin']),
  asyncHandler(async (req, res, next) => {
    try {
      await softDeleteImage({
        productUid: req.params.product_uid,
        imageId: req.params.image_id,
      });
      return res.json({ data: { image_id: req.params.image_id, deleted: true } });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

// Branch settings
router.get(
  '/items/:product_uid/branches',
  ensureRole(['manager', 'admin']),
  asyncHandler(async (req, res, next) => {
    try {
      const branchId = resolveScopedBranch(req, req.query.branch_id || req.effectiveBranchId);
      const data = await listBranchSettings({
        productUid: req.params.product_uid,
        branchId,
      });
      return res.json({ data });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

router.put(
  '/items/:product_uid/branches/:branch_id',
  ensureRole(['manager', 'admin']),
  asyncHandler(async (req, res, next) => {
    try {
      const branchId = resolveScopedBranch(req, req.params.branch_id);
      const data = await upsertBranchSetting({
        productUid: req.params.product_uid,
        branchId,
        payload: req.body || {},
      });
      return res.json({ data });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

// GET /api/products/:id (legacy compatibility)
router.get(
  '/:id(\\d+)',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await db.query(
      `
      SELECT
        p.id,
        p.name,
        p.sku,
        COALESCE(pos.price_override, p.base_price)::numeric(12,2) AS price,
        COALESCE(pos.stock_override, p.stock_quantity) AS stock,
        p.is_active,
        p.created_at,
        p.updated_at
      FROM products p
      LEFT JOIN product_outlet_settings pos
        ON pos.product_id = p.id
        AND pos.outlet_id = $2
        AND pos.deleted_at IS NULL
      WHERE p.id = $1
        AND p.deleted_at IS NULL
      `,
      [id, req.effectiveBranchId]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: 'Product not found' });
    }
    return res.json({ data: result.rows[0] });
  })
);

// POST /api/products (legacy compatibility)
router.post(
  '/',
  ensureRole(['manager', 'admin']),
  asyncHandler(async (req, res, next) => {
    try {
      const defaultSectionId = await getDefaultSectionId(req.effectiveBranchId);
      const product = await createItem({
        outletId: req.effectiveBranchId,
        payload: {
          name: req.body?.name,
          sku: req.body?.sku,
          base_price: req.body?.price,
          stock_quantity: req.body?.stock,
          is_active: req.body?.isActive ?? req.body?.is_active,
          section_id: req.body?.section_id || defaultSectionId,
        },
      });
      return res.status(201).json({ data: mapLegacyResponse(product) });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

// PUT /api/products/:id (legacy compatibility)
router.put(
  '/:id(\\d+)',
  ensureRole(['manager', 'admin']),
  asyncHandler(async (req, res, next) => {
    const id = Number(req.params.id);
    const current = await db.query(
      `
      SELECT product_uid
      FROM products
      WHERE id = $1
        AND deleted_at IS NULL
      `,
      [id]
    );
    if (!current.rows[0]) {
      return res.status(404).json({ error: 'Product not found' });
    }

    try {
      const updated = await updateItem({
        productUid: current.rows[0].product_uid,
        payload: {
          name: req.body?.name,
          sku: req.body?.sku,
          base_price: req.body?.price,
          stock_quantity: req.body?.stock,
          is_active: req.body?.isActive ?? req.body?.is_active,
        },
        outletId: req.effectiveBranchId,
      });
      return res.json({ data: mapLegacyResponse(updated) });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

// DELETE /api/products/:id (legacy compatibility soft-delete)
router.delete(
  '/:id(\\d+)',
  ensureRole(['manager', 'admin']),
  asyncHandler(async (req, res, next) => {
    const id = Number(req.params.id);
    const current = await db.query(
      `
      SELECT product_uid
      FROM products
      WHERE id = $1
        AND deleted_at IS NULL
      `,
      [id]
    );
    if (!current.rows[0]) {
      return res.status(404).json({ error: 'Product not found' });
    }

    try {
      await softDeleteItem({ productUid: current.rows[0].product_uid });
      return res.json({ data: { id, deleted: true } });
    } catch (err) {
      try {
        handleCatalogError(res, err);
      } catch (forward) {
        return next(forward);
      }
      return null;
    }
  })
);

module.exports = router;

