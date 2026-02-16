import api from './api';

const getBranchId = () => {
  const value = Number(localStorage.getItem('branchId') || 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
};

const withBranch = (params = {}) => ({
  ...params,
  branch_id: getBranchId(),
});

const listPromoCodes = ({
  page = 1,
  pageSize = 25,
  status = '',
  search = '',
  activeNow = false,
  expired = false,
  upcoming = false,
} = {}) =>
  api
    .get('/discounts/promo-codes', {
      params: withBranch({
        page,
        page_size: pageSize,
        status: status || undefined,
        search: search || undefined,
        active_now: activeNow || undefined,
        expired: expired || undefined,
        upcoming: upcoming || undefined,
      }),
    })
    .then((res) => res.data);

const createPromoCode = (payload) =>
  api.post('/discounts/promo-codes', payload, { params: withBranch() }).then((res) => res.data.data);

const updatePromoCode = (uuid, payload) =>
  api.patch(`/discounts/promo-codes/${uuid}`, payload, { params: withBranch() }).then((res) => res.data.data);

const togglePromoCode = (uuid) =>
  api.patch(`/discounts/promo-codes/${uuid}/toggle`, {}, { params: withBranch() }).then((res) => res.data.data);

const deletePromoCode = (uuid) =>
  api.delete(`/discounts/promo-codes/${uuid}`, { params: withBranch() }).then((res) => res.data.data);

const listBulkDiscounts = ({
  page = 1,
  pageSize = 25,
  status = '',
  search = '',
  activeNow = false,
  expired = false,
  upcoming = false,
} = {}) =>
  api
    .get('/discounts/bulk-discounts', {
      params: withBranch({
        page,
        page_size: pageSize,
        status: status || undefined,
        search: search || undefined,
        active_now: activeNow || undefined,
        expired: expired || undefined,
        upcoming: upcoming || undefined,
      }),
    })
    .then((res) => res.data);

const createBulkDiscount = (payload) =>
  api.post('/discounts/bulk-discounts', payload, { params: withBranch() }).then((res) => res.data.data);

const updateBulkDiscount = (uuid, payload) =>
  api.patch(`/discounts/bulk-discounts/${uuid}`, payload, { params: withBranch() }).then((res) => res.data.data);

const toggleBulkDiscount = (uuid) =>
  api.patch(`/discounts/bulk-discounts/${uuid}/toggle`, {}, { params: withBranch() }).then((res) => res.data.data);

const deleteBulkDiscount = (uuid) =>
  api.delete(`/discounts/bulk-discounts/${uuid}`, { params: withBranch() }).then((res) => res.data.data);

export {
  getBranchId,
  listPromoCodes,
  createPromoCode,
  updatePromoCode,
  togglePromoCode,
  deletePromoCode,
  listBulkDiscounts,
  createBulkDiscount,
  updateBulkDiscount,
  toggleBulkDiscount,
  deleteBulkDiscount,
};
