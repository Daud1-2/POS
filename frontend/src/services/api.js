import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';
const DEFAULT_TIMEZONE = 'Asia/Karachi';

const api = axios.create({
  baseURL: API_BASE_URL,
});

const parsePositiveIntList = (value) =>
  String(value || '')
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((id, index, list) => Number.isInteger(id) && id > 0 && list.indexOf(id) === index);

const getFallbackAdminBranchIds = () => {
  const fromStorage = parsePositiveIntList(localStorage.getItem('adminBranchIds'));
  if (fromStorage.length) return fromStorage;
  try {
    const nameMap = JSON.parse(localStorage.getItem('branchNameMap') || '{}');
    const fromNames = Object.keys(nameMap)
      .map((key) => Number(key))
      .filter((id) => Number.isInteger(id) && id > 0)
      .sort((a, b) => a - b);
    return fromNames;
  } catch (_) {
    return [];
  }
};

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    const role = (localStorage.getItem('userRole') || 'admin').toLowerCase();
    const rawScope = localStorage.getItem('branchId') || '1';
    const adminBranchIds = getFallbackAdminBranchIds();

    const resolvedBranchId =
      rawScope === 'all'
        ? adminBranchIds[0] || 1
        : (() => {
            const parsed = Number(rawScope);
            if (Number.isInteger(parsed) && parsed > 0) return parsed;
            return adminBranchIds[0] || 1;
          })();

    const resolvedBranchIds =
      role === 'admin'
        ? (adminBranchIds.length ? adminBranchIds : [resolvedBranchId])
        : [resolvedBranchId];

    config.headers['x-dev-role'] = role;
    config.headers['x-dev-branch-id'] = String(resolvedBranchId);
    config.headers['x-dev-branch-ids'] = resolvedBranchIds.join(',');
    config.headers['x-dev-timezone'] =
      localStorage.getItem('userTimezone') ||
      DEFAULT_TIMEZONE;
    config.headers['x-dev-sub'] = localStorage.getItem('userId') || 'dev-user';
  }
  return config;
});

export default api;
