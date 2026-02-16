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
    toBool: jest.fn((value) => value === 'true' || value === true),
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
    listBranchSettings: jest.fn(),
    upsertBranchSetting: jest.fn(),
    getDefaultSectionId: jest.fn(),
  };
});

const catalogService = require('../src/services/catalogService');
const app = require('../src/app');

describe('products image routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns image list', async () => {
    catalogService.listImages.mockResolvedValue([
      { id: 'd8dfe169-9af1-4c3e-a2f1-84023f44fdaf', image_url: 'http://example.com/a.jpg', is_primary: true },
    ]);

    const res = await request(app)
      .get('/api/products/items/0f9408fa-4068-45c5-b31d-c2cae08cd1cb/images')
      .query({ branch_id: 1 });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  test('upload endpoint rejects missing file', async () => {
    const res = await request(app)
      .post('/api/products/items/0f9408fa-4068-45c5-b31d-c2cae08cd1cb/images/upload')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  test('can set image as primary', async () => {
    catalogService.updateImage.mockResolvedValue({
      id: 'd8dfe169-9af1-4c3e-a2f1-84023f44fdaf',
      is_primary: true,
    });

    const res = await request(app)
      .patch('/api/products/items/0f9408fa-4068-45c5-b31d-c2cae08cd1cb/images/d8dfe169-9af1-4c3e-a2f1-84023f44fdaf')
      .set('x-dev-role', 'manager')
      .set('x-dev-branch-id', '1')
      .query({ branch_id: 1 })
      .send({ is_primary: true });

    expect(res.status).toBe(200);
    expect(catalogService.updateImage).toHaveBeenCalled();
  });
});
