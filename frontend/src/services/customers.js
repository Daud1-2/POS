import api from './api';

const getBranchId = () => {
  const value = Number(localStorage.getItem('branchId') || 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
};

const withBranch = (params = {}) => ({
  ...params,
  branch_id: getBranchId(),
});

const getCustomerSegments = (params = {}) =>
  api.get('/customers/segments', { params: withBranch(params) }).then((res) => res.data);

const getCustomerInsights = (params = {}) =>
  api.get('/customers/insights', { params: withBranch(params) }).then((res) => res.data.data);

export {
  getCustomerSegments,
  getCustomerInsights,
};
