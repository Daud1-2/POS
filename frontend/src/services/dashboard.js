import api from './api';

const getOutletId = () => {
  const value = Number(localStorage.getItem('outletId') || 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
};

const withOutlet = (params = {}) => ({
  ...params,
  outlet_id: getOutletId(),
});

const getSummary = (range = 'day') =>
  api.get('/dashboard/summary', { params: withOutlet({ range }) }).then((res) => res.data.data);

const getSalesTrend = (range = 'month') =>
  api.get('/dashboard/sales-trend', { params: withOutlet({ range }) }).then((res) => res.data.data);

const getRejectedTrend = (range = 'month') =>
  api.get('/dashboard/rejected-trend', { params: withOutlet({ range }) }).then((res) => res.data.data);

const getHeatmap = (range = 'month') =>
  api.get('/dashboard/heatmap', { params: withOutlet({ range }) }).then((res) => res.data.data);

const getTopProducts = (range = 'month', limit = 10) =>
  api
    .get('/dashboard/top-products', { params: withOutlet({ range, limit }) })
    .then((res) => res.data.data);

const getChannelContribution = (range = 'month') =>
  api
    .get('/dashboard/channel-contribution', { params: withOutlet({ range }) })
    .then((res) => res.data.data);

const getPaymentType = (range = 'month') =>
  api
    .get('/dashboard/payment-type', { params: withOutlet({ range }) })
    .then((res) => res.data.data);

const getLiveOrders = (page = 1, pageSize = 25) =>
  api
    .get('/orders/live', { params: withOutlet({ page, page_size: pageSize }) })
    .then((res) => res.data);

const getPreOrders = (page = 1, pageSize = 25) =>
  api
    .get('/orders/pre', { params: withOutlet({ page, page_size: pageSize }) })
    .then((res) => res.data);

const getPhoneOrders = (page = 1, pageSize = 25) =>
  api
    .get('/orders/phone', { params: withOutlet({ page, page_size: pageSize }) })
    .then((res) => res.data);

const getReviewsSummary = (page = 1, pageSize = 25) =>
  api
    .get('/orders/reviews/summary', { params: withOutlet({ page, page_size: pageSize }) })
    .then((res) => res.data);

export {
  getSummary,
  getSalesTrend,
  getRejectedTrend,
  getHeatmap,
  getTopProducts,
  getChannelContribution,
  getPaymentType,
  getLiveOrders,
  getPreOrders,
  getPhoneOrders,
  getReviewsSummary,
};
