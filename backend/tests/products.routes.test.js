process.env.ALLOW_DEV_AUTH_BYPASS = 'true';

const request = require('supertest');

jest.mock('../src/services/db', () => ({
  query: jest.fn(),
}));

jest.mock('../src/services/catalogService', () => {
  class CatalogValidationError extends Error {
    constructor(message, statusCode = 400) {
      super(message);
      this.statusCode = statusCode;
    }
  }

  return {
    CatalogValidationError,
    parsePagination: jest.fn(() => ({ page: 1, page_size: 25, offset: 0 })),
    toBool: jest.fn(() => false),
    toPositiveInt: jest.fn((value) => Number(value)),
    getCompatProducts: jest.fn(),
    listSections: jest.fn(),
    createSection: jest.fn(),
    updateSection: jest.fn(),
    reorderSections: jest.fn(),
    softDeleteSection: jest.fn(),
    listItems: jest.fn(),
    getProductByUid: jest.fn(),
    createItem: jest.fn(),
    updateItem: jest.fn(),
    setItemActive: jest.fn(),
    softDeleteItem: jest.fn(),
    listImages: jest.fn(),
    addImage: jest.fn(),
    updateImage: jest.fn(),
    softDeleteImage: jest.fn(),
    listOutletSettings: jest.fn(),
    upsertOutletSetting: jest.fn(),
    getDefaultSectionId: jest.fn(),
  };
});

const db = require('../src/services/db');
const catalogService = require('../src/services/catalogService');
const app = require('../src/app');

describe('products routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns compatibility products list with outlet scoping', async () => {
    catalogService.getCompatProducts.mockResolvedValue([
      { id: 1, name: 'Cola', sku: 'COLA-1', price: 100, stock: 10, is_active: true },
    ]);

    const res = await request(app).get('/api/products').query({ outlet_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(catalogService.getCompatProducts).toHaveBeenCalledWith({ outletId: 1 });
  });

  test('rejects section creation for manager role', async () => {
    const res = await request(app)
      .post('/api/products/sections')
      .set('x-dev-role', 'manager')
      .set('x-dev-outlet-id', '1')
      .send({ name: 'Grill' })
      .query({ outlet_id: 1 });

    expect(res.status).toBe(403);
  });

  test('creates item for manager role', async () => {
    catalogService.createItem.mockResolvedValue({
      id: 1,
      product_uid: 'd0f1c59a-15de-4a2c-ae8f-44d439ab8e6d',
      name: 'Burger',
      section_id: '1060ab07-e08f-4cbf-bf6a-4d0d1ac7348f',
    });

    const res = await request(app)
      .post('/api/products/items')
      .set('x-dev-role', 'manager')
      .set('x-dev-outlet-id', '1')
      .query({ outlet_id: 1 })
      .send({
        name: 'Burger',
        sku: 'BURG-1',
        base_price: 500,
        section_id: '1060ab07-e08f-4cbf-bf6a-4d0d1ac7348f',
      });

    expect(res.status).toBe(201);
    expect(catalogService.createItem).toHaveBeenCalled();
  });

  test('returns paginated items response shape', async () => {
    catalogService.listItems.mockResolvedValue({
      data: [{ product_uid: 'uid-1', name: 'Burger' }],
      meta: { page: 1, page_size: 25, total: 1, total_pages: 1 },
    });

    const res = await request(app).get('/api/products/items').query({ outlet_id: 1, page: 1, page_size: 25 });

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, page_size: 25, total: 1, total_pages: 1 });
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('legacy product by id returns 404 when missing', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/products/9999').query({ outlet_id: 1 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
