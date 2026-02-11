import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('authToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    const outletId = localStorage.getItem('outletId') || '1';
    config.headers['x-dev-role'] = localStorage.getItem('userRole') || 'admin';
    config.headers['x-dev-outlet-id'] = outletId;
    config.headers['x-dev-outlet-ids'] = localStorage.getItem('adminOutletIds') || outletId;
    config.headers['x-dev-timezone'] =
      localStorage.getItem('userTimezone') ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      'UTC';
    config.headers['x-dev-sub'] = localStorage.getItem('userId') || 'dev-user';
  }
  return config;
});

export default api;
