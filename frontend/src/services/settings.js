import api from './api';

const getBranchId = () => {
  const value = Number(localStorage.getItem('branchId') || 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
};

const getBranchScope = () => {
  const raw = localStorage.getItem('branchId');
  if (raw === 'all') return 'all';
  return getBranchId();
};

const getBranchDisplayNo = (branchId = null) => {
  const targetId = Number(branchId === null || branchId === undefined ? getBranchId() : branchId);
  if (!Number.isInteger(targetId) || targetId <= 0) return 1;

  try {
    const raw = localStorage.getItem('branchDisplayMap');
    const map = raw ? JSON.parse(raw) : {};
    const displayNo = Number(map?.[String(targetId)] || 0);
    return Number.isInteger(displayNo) && displayNo > 0 ? displayNo : 1;
  } catch (_) {
    return 1;
  }
};

const getBranchDisplayLabel = (branchId = null) => `Branch ${getBranchDisplayNo(branchId)}`;

const withBranch = (params = {}) => ({
  ...params,
  branch_id: getBranchId(),
});

const getBusinessSettings = () =>
  api.get('/settings/business', { params: withBranch() }).then((res) => res.data.data);

const updateBusinessSettings = (payload) =>
  api
    .put('/settings/business', payload, { params: withBranch() })
    .then((res) => res.data.data);

const getBranchSettings = () =>
  api.get('/settings/branch', { params: withBranch() }).then((res) => res.data.data);

const updateBranchSettings = (payload) =>
  api
    .put('/settings/branch', payload, { params: withBranch() })
    .then((res) => res.data.data);

const getBranches = () =>
  api
    .get('/settings/branches', {
      params: (() => {
        const scope = getBranchScope();
        if (scope === 'all') return { branch_id: 'all' };
        return withBranch();
      })(),
    })
    .then((res) => res.data.data || []);

const createBranch = (payload) =>
  api.post('/settings/branches', payload, { params: withBranch() }).then((res) => res.data.data);

const deleteBranch = (branchId) =>
  api.delete(`/settings/branches/${branchId}`, { params: withBranch() }).then((res) => res.data.data);

export {
  getBranchId,
  getBranchDisplayLabel,
  getBusinessSettings,
  updateBusinessSettings,
  getBranchSettings,
  updateBranchSettings,
  getBranches,
  createBranch,
  deleteBranch,
};
