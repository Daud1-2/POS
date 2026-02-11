import api from './api';

const getOutletId = () => {
  const value = Number(localStorage.getItem('outletId') || 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
};

const withOutlet = (params = {}) => ({
  ...params,
  outlet_id: getOutletId(),
});

const getSections = () =>
  api.get('/products/sections', { params: withOutlet() }).then((res) => res.data.data || []);

const createSection = (payload) =>
  api.post('/products/sections', payload, { params: withOutlet() }).then((res) => res.data.data);

const updateSection = (sectionId, payload) =>
  api.patch(`/products/sections/${sectionId}`, payload, { params: withOutlet() }).then((res) => res.data.data);

const reorderSections = (items) =>
  api.patch('/products/sections/reorder', { items }, { params: withOutlet() }).then((res) => res.data.data);

const deleteSection = (sectionId) =>
  api.delete(`/products/sections/${sectionId}`, { params: withOutlet() }).then((res) => res.data.data);

const getItems = ({
  page = 1,
  pageSize = 25,
  search = '',
  sectionId = '',
  includeInactive = false,
  includeUnavailable = false,
} = {}) =>
  api
    .get('/products/items', {
      params: withOutlet({
        page,
        page_size: pageSize,
        search: search || undefined,
        section_id: sectionId || undefined,
        include_inactive: includeInactive || undefined,
        include_unavailable: includeUnavailable || undefined,
      }),
    })
    .then((res) => res.data);

const createItem = (payload) =>
  api.post('/products/items', payload, { params: withOutlet() }).then((res) => res.data.data);

const updateItem = (productUid, payload) =>
  api.patch(`/products/items/${productUid}`, payload, { params: withOutlet() }).then((res) => res.data.data);

const toggleItemActive = (productUid, isActive) =>
  api
    .patch(`/products/items/${productUid}/active`, { is_active: isActive }, { params: withOutlet() })
    .then((res) => res.data.data);

const deleteItem = (productUid) =>
  api.delete(`/products/items/${productUid}`, { params: withOutlet() }).then((res) => res.data.data);

const getProductImages = (productUid) =>
  api.get(`/products/items/${productUid}/images`, { params: withOutlet() }).then((res) => res.data.data || []);

const addProductImageUrl = (productUid, payload) =>
  api.post(`/products/items/${productUid}/images`, payload, { params: withOutlet() }).then((res) => res.data.data);

const uploadProductImage = (productUid, file, { isPrimary = false, displayOrder = 0 } = {}) => {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('is_primary', String(Boolean(isPrimary)));
  formData.append('display_order', String(Number(displayOrder) || 0));

  return api
    .post(`/products/items/${productUid}/images/upload`, formData, {
      params: withOutlet(),
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    .then((res) => res.data.data);
};

const updateProductImage = (productUid, imageId, payload) =>
  api
    .patch(`/products/items/${productUid}/images/${imageId}`, payload, { params: withOutlet() })
    .then((res) => res.data.data);

const deleteProductImage = (productUid, imageId) =>
  api
    .delete(`/products/items/${productUid}/images/${imageId}`, { params: withOutlet() })
    .then((res) => res.data.data);

const getProductOutletSetting = (productUid, outletId = getOutletId()) =>
  api
    .get(`/products/items/${productUid}/outlets`, { params: withOutlet({ outlet_id: outletId }) })
    .then((res) => res.data.data);

const upsertProductOutletSetting = (productUid, outletId, payload) =>
  api
    .put(`/products/items/${productUid}/outlets/${outletId}`, payload, { params: withOutlet() })
    .then((res) => res.data.data);

export {
  getOutletId,
  getSections,
  createSection,
  updateSection,
  reorderSections,
  deleteSection,
  getItems,
  createItem,
  updateItem,
  toggleItemActive,
  deleteItem,
  getProductImages,
  addProductImageUrl,
  uploadProductImage,
  updateProductImage,
  deleteProductImage,
  getProductOutletSetting,
  upsertProductOutletSetting,
};
