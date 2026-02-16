import api from './api';

const DEFAULT_TIMEZONE = 'Asia/Karachi';

const getDefaultBranchId = () => {
  const value = Number(localStorage.getItem('branchId') || 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
};

const getUserRole = () => localStorage.getItem('userRole') || 'admin';

const getUserTimezone = () => {
  const storedTimezone = localStorage.getItem('userTimezone');

  if (storedTimezone) return storedTimezone;
  return DEFAULT_TIMEZONE;
};

const getAdminBranchIds = () => {
  const stored = localStorage.getItem('adminBranchIds') || String(getDefaultBranchId());
  return stored
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value, index, array) => Number.isInteger(value) && value > 0 && array.indexOf(value) === index);
};

const withBaseParams = (params = {}) => ({
  ...params,
  timezone: params.timezone || getUserTimezone(),
});

const withBranch = (params = {}) => ({
  ...withBaseParams(params),
  branch_id: Number(params.branch_id) || getDefaultBranchId(),
});

const withBranches = (params = {}) => {
  const branchIds = Array.isArray(params.branch_ids) && params.branch_ids.length
    ? params.branch_ids
    : getAdminBranchIds();

  return {
    ...withBaseParams(params),
    branch_ids: branchIds.join(','),
  };
};

const getBranchOptions = () => {
  const displayMap = (() => {
    try {
      return JSON.parse(localStorage.getItem('branchDisplayMap') || '{}');
    } catch (_) {
      return {};
    }
  })();
  const nameMap = (() => {
    try {
      return JSON.parse(localStorage.getItem('branchNameMap') || '{}');
    } catch (_) {
      return {};
    }
  })();
  const formatName = (id) => {
    const displayNo = Number(displayMap[String(id)] || id);
    const branchName = nameMap[String(id)] || `Branch ${displayNo}`;
    return `${branchName} (Branch ${displayNo})`;
  };

  const role = getUserRole();
  if (role !== 'admin') {
    const id = getDefaultBranchId();
    return [{ id, name: formatName(id) }];
  }
  return getAdminBranchIds().map((id) => ({ id, name: formatName(id) }));
};

const getRevenueOverview = (params = {}) =>
  api.get('/reporting/revenue/overview', { params: withBranch(params) }).then((res) => res.data.data);

const getRevenueTrend = (params = {}) =>
  api.get('/reporting/revenue/trend', { params: withBranch(params) }).then((res) => res.data.data);

const getPaymentOverview = (params = {}) =>
  api.get('/reporting/payments/overview', { params: withBranch(params) }).then((res) => res.data.data);

const getPaymentTrend = (params = {}) =>
  api.get('/reporting/payments/trend', { params: withBranch(params) }).then((res) => res.data.data);

const getProductsIntelligence = (params = {}) =>
  api.get('/reporting/products/intelligence', { params: withBranch(params) }).then((res) => res.data.data);

const getTimeAnalysis = (params = {}) =>
  api.get('/reporting/time/analysis', { params: withBranch(params) }).then((res) => res.data.data);

const getBranchComparison = (params = {}) =>
  api.get('/reporting/branches/compare', { params: withBranches(params) }).then((res) => res.data.data);

export {
  getUserRole,
  getBranchOptions,
  getRevenueOverview,
  getRevenueTrend,
  getPaymentOverview,
  getPaymentTrend,
  getProductsIntelligence,
  getTimeAnalysis,
  getBranchComparison,
};
