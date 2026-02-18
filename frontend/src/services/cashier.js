import api from './api';
import {
  commitSaleLocalFirst,
  isOfflineV2Enabled,
  triggerOfflineSyncNow,
} from './offlineSync';

const LEGACY_ALLOWED_STATUSES = new Set([
  'open',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'cancelled',
  'refunded',
]);

const CANONICAL_TO_LEGACY_STATUS = {
  draft: 'open',
  pending: 'open',
  new: 'open',
  accepted: 'preparing',
  preparing: 'preparing',
  ready: 'ready',
  completed: 'completed',
  cancelled: 'cancelled',
  rejected: 'cancelled',
  refunded: 'refunded',
};

const SOURCE_TO_CHANNEL = {
  pos: 'pos',
  kiosk: 'pos',
  phone: 'pos',
  website: 'online',
};

const parsePositiveIntList = (value) =>
  String(value || '')
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((id, index, list) => Number.isInteger(id) && id > 0 && list.indexOf(id) === index);

const getFallbackBranchIds = () => {
  const fromStorage = parsePositiveIntList(localStorage.getItem('adminBranchIds'));
  if (fromStorage.length) return fromStorage;

  try {
    const nameMap = JSON.parse(localStorage.getItem('branchNameMap') || '{}');
    return Object.keys(nameMap)
      .map((key) => Number(key))
      .filter((id, index, list) => Number.isInteger(id) && id > 0 && list.indexOf(id) === index)
      .sort((a, b) => a - b);
  } catch (_) {
    return [];
  }
};

const resolveCashierBranchId = () => {
  const rawScope = localStorage.getItem('branchId');
  const fallbackIds = getFallbackBranchIds();

  if (rawScope && rawScope !== 'all') {
    const parsed = Number(rawScope);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const fallback = fallbackIds[0] || 1;
  localStorage.setItem('branchId', String(fallback));
  return fallback;
};

const resolveBranchIdInput = (value) => {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return resolveCashierBranchId();
};

const withBranch = (params = {}, branchId = resolveCashierBranchId()) => ({
  ...params,
  branch_id: branchId,
});

const extractApiError = (error, fallback = 'Something went wrong') =>
  error?.response?.data?.error || error?.message || fallback;

const isNotFoundError = (error) => Number(error?.response?.status || 0) === 404;

const isLegacyStatusValidationError = (error) => {
  const message = String(error?.response?.data?.error || '').toLowerCase();
  return message.includes('status must be open') || message.includes('out_for_delivery');
};

const isOrderChannelValidationError = (error) => {
  const message = String(error?.response?.data?.error || '').toLowerCase();
  return message.includes('order_channel');
};

const normalizeOrderChannel = (value, fallback = 'pos') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['pos', 'online', 'whatsapp', 'delivery_platform'].includes(normalized)) return normalized;
  return fallback;
};

const mapCanonicalStatusToLegacy = (status) => {
  const normalized = String(status || '').trim().toLowerCase();
  return CANONICAL_TO_LEGACY_STATUS[normalized] || normalized || 'open';
};

const mapLegacyStatusToCanonical = (status, channel = 'pos') => {
  const normalized = String(status || '').trim().toLowerCase();
  if (!normalized) return channel === 'pos' ? 'pending' : 'new';

  if (channel === 'pos') {
    if (['open', 'preparing', 'ready', 'out_for_delivery'].includes(normalized)) return 'pending';
    return normalized;
  }

  if (normalized === 'open') return 'new';
  if (normalized === 'cancelled') return 'rejected';
  if (normalized === 'out_for_delivery') return 'ready';
  return normalized;
};

const toCanonicalOrderRow = (row = {}, fallbackChannel = 'pos') => {
  const source = String(row.source || '').trim().toLowerCase();
  const channel = normalizeOrderChannel(row.order_channel || SOURCE_TO_CHANNEL[source] || fallbackChannel, fallbackChannel);
  const status = mapLegacyStatusToCanonical(row.status, channel);

  return {
    ...row,
    order_channel: channel,
    status,
    branch_id: Number(row.branch_id || row.outlet_id || resolveCashierBranchId()),
  };
};

const toCanonicalRows = (rows = [], fallbackChannel = 'pos') =>
  Array.isArray(rows) ? rows.map((row) => toCanonicalOrderRow(row, fallbackChannel)) : [];

const mapStatusFilterToLegacyCsv = (statusValue = '') => {
  const unique = new Set();
  String(statusValue || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .forEach((status) => {
      unique.add(mapCanonicalStatusToLegacy(status));
    });
  return Array.from(unique).join(',');
};

const getCashierSections = async () => {
  const branchId = resolveCashierBranchId();
  const response = await api.get('/products/sections', { params: withBranch({}, branchId) });
  return {
    branchId,
    sections: response?.data?.data || [],
  };
};

const getCashierItems = async ({ page = 1, pageSize = 24, search = '', sectionId = '' } = {}) => {
  const branchId = resolveCashierBranchId();
  const response = await api.get('/products/items', {
    params: withBranch(
      {
        page,
        page_size: pageSize,
        search: search || undefined,
        section_id: sectionId || undefined,
      },
      branchId
    ),
  });

  return {
    branchId,
    data: response?.data?.data || [],
    meta: response?.data?.meta || { page: 1, page_size: pageSize, total: 0, total_pages: 0 },
  };
};

const getCashierQuote = async ({
  items = [],
  promoCode = '',
  source = 'pos',
  tax = 0,
  branchId: branchIdInput = null,
} = {}) => {
  const branchId = resolveBranchIdInput(branchIdInput);
  const response = await api.post(
    '/discounts/quote',
    {
      source,
      promo_code: promoCode || undefined,
      items,
      tax,
    },
    { params: withBranch({}, branchId) }
  );

  return {
    branchId,
    data: response?.data?.data || null,
  };
};

const createOrderViaSalesCompatibility = async ({ payload, branchId }) => {
  const source = String(payload?.source || 'pos').toLowerCase();
  const paymentMethodRaw = String(payload?.payment_method || payload?.paymentMethod || 'cash').toLowerCase();
  const paymentMethod = paymentMethodRaw === 'card' ? 'credit' : paymentMethodRaw;
  const status = mapCanonicalStatusToLegacy(payload?.status);
  const cashierId = Number(localStorage.getItem('userId') || localStorage.getItem('cashierId') || 1);

  const response = await api.post(
    '/sales',
    {
      cashierId: Number.isInteger(cashierId) && cashierId > 0 ? cashierId : 1,
      branch_id: branchId,
      source,
      status,
      orderType: payload?.order_type || payload?.orderType || 'takeaway',
      paymentMethod,
      paymentStatus: payload?.payment_status || payload?.paymentStatus || 'unpaid',
      items: Array.isArray(payload?.items) ? payload.items : [],
      tax: payload?.tax ?? 0,
      promoCode: payload?.promo_code || payload?.promoCode || undefined,
      customerId: payload?.customer_id || payload?.customerId || undefined,
    },
    { params: withBranch({}, branchId) }
  );

  const data = response?.data?.data || {};
  const channel = normalizeOrderChannel(data.order_channel || SOURCE_TO_CHANNEL[source] || 'pos', 'pos');
  const normalizedOrder = toCanonicalOrderRow(
    {
      id: data.order_id || data.id || null,
      order_number: data.order_number || data.legacy_order_id || '',
      status: data.status || status,
      source,
      order_channel: channel,
      total: data.total_amount ?? data.total ?? 0,
      order_type: payload?.order_type || payload?.orderType || 'takeaway',
      payment_method: paymentMethodRaw === 'credit' ? 'card' : paymentMethodRaw,
      items: payload?.items || [],
      created_at: new Date().toISOString(),
    },
    channel
  );

  return {
    branchId,
    data: normalizedOrder,
  };
};

const createCashierOrder = async (payload) => {
  const branchId = resolveBranchIdInput(payload?.branch_id ?? payload?.branchId);
  const orderChannel = normalizeOrderChannel(payload?.order_channel || SOURCE_TO_CHANNEL[payload?.source] || 'pos');
  const body = {
    ...(payload || {}),
    branch_id: branchId,
    order_channel: orderChannel,
  };

  if (isOfflineV2Enabled()) {
    try {
      const local = await commitSaleLocalFirst({
        branchId,
        payload: body,
      });
      triggerOfflineSyncNow(branchId);
      return {
        branchId,
        data: toCanonicalOrderRow(local?.data || {}, orderChannel),
      };
    } catch (offlineErr) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offline) {
        throw offlineErr;
      }
    }
  }

  try {
    const response = await api.post('/orders', body, { params: withBranch({}, branchId) });
    return {
      branchId,
      data: toCanonicalOrderRow(response?.data?.data || {}, orderChannel),
    };
  } catch (error) {
    const legacyRetryBody = {
      ...body,
      status: mapCanonicalStatusToLegacy(body.status),
    };
    delete legacyRetryBody.order_channel;
    delete legacyRetryBody.orderChannel;

    if (isLegacyStatusValidationError(error) || isOrderChannelValidationError(error)) {
      try {
        const response = await api.post('/orders', legacyRetryBody, { params: withBranch({}, branchId) });
        return {
          branchId,
          data: toCanonicalOrderRow(response?.data?.data || {}, orderChannel),
        };
      } catch (retryError) {
        if (isNotFoundError(retryError)) {
          return createOrderViaSalesCompatibility({ payload: body, branchId });
        }
        throw retryError;
      }
    }

    if (isNotFoundError(error)) {
      return createOrderViaSalesCompatibility({ payload: body, branchId });
    }
    throw error;
  }
};

const listCashierOrdersFromSales = async ({
  channel = '',
  status = '',
  search = '',
  page = 1,
  pageSize = 100,
  dateFrom = '',
  dateTo = '',
  branchId,
}) => {
  const response = await api.get('/sales', {
    params: withBranch({}, branchId),
  });

  let rows = toCanonicalRows(response?.data?.data || []);

  const channelSet = new Set(
    String(channel || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
  if (channelSet.size > 0) {
    rows = rows.filter((row) => channelSet.has(String(row.order_channel || '').toLowerCase()));
  }

  const statusSet = new Set(
    String(status || '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
  if (statusSet.size > 0) {
    rows = rows.filter((row) => statusSet.has(String(row.status || '').toLowerCase()));
  }

  const searchValue = String(search || '').trim().toLowerCase();
  if (searchValue) {
    rows = rows.filter((row) => {
      const orderNo = String(row.order_number || '').toLowerCase();
      const customerName = String(row.customer_name_snapshot || '').toLowerCase();
      return orderNo.includes(searchValue) || customerName.includes(searchValue);
    });
  }

  if (dateFrom) {
    const from = new Date(dateFrom);
    if (!Number.isNaN(from.getTime())) {
      rows = rows.filter((row) => {
        const created = new Date(row.created_at || row.updated_at || 0);
        return !Number.isNaN(created.getTime()) && created >= from;
      });
    }
  }
  if (dateTo) {
    const to = new Date(dateTo);
    if (!Number.isNaN(to.getTime())) {
      rows = rows.filter((row) => {
        const created = new Date(row.created_at || row.updated_at || 0);
        return !Number.isNaN(created.getTime()) && created < to;
      });
    }
  }

  const total = rows.length;
  const safePage = Number.isInteger(Number(page)) && Number(page) > 0 ? Number(page) : 1;
  const safePageSize = Number.isInteger(Number(pageSize)) && Number(pageSize) > 0 ? Number(pageSize) : 100;
  const offset = (safePage - 1) * safePageSize;
  const pagedRows = rows.slice(offset, offset + safePageSize);

  return {
    branchId,
    data: pagedRows,
    meta: {
      page: safePage,
      page_size: safePageSize,
      total,
      total_pages: total === 0 ? 0 : Math.ceil(total / safePageSize),
    },
  };
};

const listCashierOrders = async ({
  channel = '',
  status = '',
  search = '',
  dateFrom = '',
  dateTo = '',
  page = 1,
  pageSize = 100,
} = {}) => {
  const branchId = resolveCashierBranchId();
  const params = withBranch(
    {
      page,
      page_size: pageSize,
      channel: channel || undefined,
      status: status || undefined,
      search: search || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    },
    branchId
  );

  try {
    const response = await api.get('/orders', { params });
    return {
      branchId,
      data: toCanonicalRows(response?.data?.data || []),
      meta: response?.data?.meta || { page: 1, page_size: pageSize, total: 0, total_pages: 0 },
    };
  } catch (error) {
    if ((isLegacyStatusValidationError(error) || isOrderChannelValidationError(error)) && status) {
      const legacyParams = {
        ...params,
        status: mapStatusFilterToLegacyCsv(status),
      };
      delete legacyParams.channel;
      try {
        const retryResponse = await api.get('/orders', { params: legacyParams });
        return {
          branchId,
          data: toCanonicalRows(retryResponse?.data?.data || []),
          meta: retryResponse?.data?.meta || { page: 1, page_size: pageSize, total: 0, total_pages: 0 },
        };
      } catch (retryError) {
        if (isNotFoundError(retryError)) {
          return listCashierOrdersFromSales({
            channel,
            status,
            search,
            dateFrom,
            dateTo,
            page,
            pageSize,
            branchId,
          });
        }
        throw retryError;
      }
    }

    if (isNotFoundError(error)) {
      return listCashierOrdersFromSales({
        channel,
        status,
        search,
        dateFrom,
        dateTo,
        page,
        pageSize,
        branchId,
      });
    }

    throw error;
  }
};

const listRecentCashierOrders = async ({
  channel = '',
  status = '',
  search = '',
  dateFrom = '',
  dateTo = '',
} = {}) =>
  listCashierOrders({
    page: 1,
    pageSize: 100,
    channel,
    status,
    search,
    dateFrom,
    dateTo,
  });

const updateCashierOrderStatus = async (orderId, payload = {}) => {
  const branchId = resolveCashierBranchId();

  try {
    const response = await api.patch(`/orders/${orderId}/status`, payload, {
      params: withBranch({}, branchId),
    });
    return {
      branchId,
      data: toCanonicalOrderRow(response?.data?.data || {}),
    };
  } catch (error) {
    if (isLegacyStatusValidationError(error) || isOrderChannelValidationError(error)) {
      const retryPayload = {
        ...payload,
        status: mapCanonicalStatusToLegacy(payload.status),
      };
      delete retryPayload.order_channel;
      delete retryPayload.orderChannel;

      const response = await api.patch(`/orders/${orderId}/status`, retryPayload, {
        params: withBranch({}, branchId),
      });
      return {
        branchId,
        data: toCanonicalOrderRow(response?.data?.data || {}),
      };
    }
    throw error;
  }
};

const getTodayCashierShift = async () => {
  const branchId = resolveCashierBranchId();
  const response = await api.get('/shifts/today', {
    params: withBranch({}, branchId),
  });
  return {
    branchId,
    data: response?.data?.data || null,
  };
};

const startCashierShift = async ({ openingCash }) => {
  const branchId = resolveCashierBranchId();
  const response = await api.post(
    '/shifts/start',
    { opening_cash: openingCash },
    { params: withBranch({}, branchId) }
  );
  return {
    branchId,
    data: response?.data?.data || null,
  };
};

const addCashierShiftExpense = async ({ shiftId, amount }) => {
  const branchId = resolveCashierBranchId();
  const response = await api.post(
    `/shifts/${shiftId}/expenses`,
    { amount },
    { params: withBranch({}, branchId) }
  );
  return {
    branchId,
    data: response?.data?.data || null,
  };
};

const endCashierShift = async ({ shiftId, closingCash }) => {
  const branchId = resolveCashierBranchId();
  const response = await api.post(
    `/shifts/${shiftId}/end`,
    { closing_cash: closingCash },
    { params: withBranch({}, branchId) }
  );
  return {
    branchId,
    data: response?.data?.data || null,
  };
};

export {
  LEGACY_ALLOWED_STATUSES,
  resolveCashierBranchId,
  extractApiError,
  getCashierSections,
  getCashierItems,
  getCashierQuote,
  createCashierOrder,
  listCashierOrders,
  listRecentCashierOrders,
  updateCashierOrderStatus,
  getTodayCashierShift,
  startCashierShift,
  addCashierShiftExpense,
  endCashierShift,
};
