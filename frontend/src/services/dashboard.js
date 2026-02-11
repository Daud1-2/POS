import api from './api';

const getSummary = (range = 'today') =>
  api.get('/dashboard/summary', { params: { range } }).then((res) => res.data.data);

const getSalesTrend = (range = 'today') =>
  api.get('/dashboard/sales-trend', { params: { range } }).then((res) => res.data.data);

const getRejectedTrend = (range = '30d') =>
  api.get('/dashboard/rejected-trend', { params: { range } }).then((res) => res.data.data);

const getHeatmap = (range = '30d') =>
  api.get('/dashboard/heatmap', { params: { range } }).then((res) => res.data.data);

const getTopProducts = (range = '30d', limit = 10) =>
  api
    .get('/dashboard/top-products', { params: { range, limit } })
    .then((res) => res.data.data);

const getChannelContribution = (range = '30d') =>
  api
    .get('/dashboard/channel-contribution', { params: { range } })
    .then((res) => res.data.data);

const getPaymentType = (range = '30d') =>
  api
    .get('/dashboard/payment-type', { params: { range } })
    .then((res) => res.data.data);

export {
  getSummary,
  getSalesTrend,
  getRejectedTrend,
  getHeatmap,
  getTopProducts,
  getChannelContribution,
  getPaymentType,
};
