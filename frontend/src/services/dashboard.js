import api from './api';

const SHIFT_FALLBACK_ACTIVE_KEY = 'cashierFallbackShiftActive';
const SHIFT_FALLBACK_REPORT_KEY = 'cashierFallbackShiftReport';

const getBranchId = () => {
  const value = Number(localStorage.getItem('branchId') || 1);
  return Number.isInteger(value) && value > 0 ? value : 1;
};

const getBranchScope = () => {
  const raw = localStorage.getItem('branchId');
  if (raw === 'all') return 'all';
  return getBranchId();
};

const withBranch = (params = {}) => ({
  ...params,
  branch_id: getBranchScope(),
});

const getTodayDateKey = (value = new Date()) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseStoredJson = (key, fallback = null) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
};

const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

const buildLocalShiftSummaryFallback = () => {
  const today = getTodayDateKey();
  const active = parseStoredJson(SHIFT_FALLBACK_ACTIVE_KEY, null);
  const report = parseStoredJson(SHIFT_FALLBACK_REPORT_KEY, null);
  const records = [];

  if (active && active.shift_date === today) {
    records.push({
      ...active,
      branch_name: `Branch ${active.outlet_id || getBranchId()}`,
    });
  }

  if (report && report.shift_date === today) {
    records.push({
      ...report,
      branch_name: `Branch ${report.outlet_id || getBranchId()}`,
    });
  }

  const deduped = Array.from(
    new Map(records.map((row) => [String(row.id || `${row.shift_date}-${row.status}`), row])).values()
  );

  return deduped.reduce(
    (acc, row) => {
      const opening = roundMoney(row.opening_cash);
      const cashSales = roundMoney(row.cash_sales);
      const expenses = roundMoney(row.expenses);
      const expected = roundMoney(
        row.expected_cash === undefined || row.expected_cash === null
          ? opening + cashSales - expenses
          : row.expected_cash
      );
      const closing = row.closing_cash === undefined || row.closing_cash === null ? 0 : roundMoney(row.closing_cash);
      const diff = row.difference === undefined || row.difference === null ? 0 : roundMoney(row.difference);
      const result = row.reconciliation_status || (Math.abs(diff) < 0.01 ? 'Perfect' : diff > 0 ? 'Over' : 'Short');

      acc.total_shifts += 1;
      if (row.status === 'OPEN') acc.open_shifts += 1;
      if (row.status === 'CLOSED') acc.closed_shifts += 1;
      if (result === 'Perfect') acc.perfect_count += 1;
      if (result === 'Over') acc.over_count += 1;
      if (result === 'Short') acc.short_count += 1;
      acc.total_opening_cash = roundMoney(acc.total_opening_cash + opening);
      acc.total_cash_sales = roundMoney(acc.total_cash_sales + cashSales);
      acc.total_expenses = roundMoney(acc.total_expenses + expenses);
      acc.total_expected_cash = roundMoney(acc.total_expected_cash + expected);
      acc.total_closing_cash = roundMoney(acc.total_closing_cash + closing);
      acc.total_difference = roundMoney(acc.total_difference + diff);
      acc.records.push({
        ...row,
        opening_cash: opening,
        cash_sales: cashSales,
        expenses,
        expected_cash: expected,
        closing_cash: closing,
        difference: diff,
        reconciliation_status: result,
      });
      return acc;
    },
    {
      date: today,
      total_shifts: 0,
      open_shifts: 0,
      closed_shifts: 0,
      perfect_count: 0,
      over_count: 0,
      short_count: 0,
      total_opening_cash: 0,
      total_cash_sales: 0,
      total_expenses: 0,
      total_expected_cash: 0,
      total_closing_cash: 0,
      total_difference: 0,
      records: [],
    }
  );
};

const getSummary = (range = 'day') =>
  api.get('/dashboard/summary', { params: withBranch({ range }) }).then((res) => res.data.data);

const getSalesTrend = (range = 'month') =>
  api.get('/dashboard/sales-trend', { params: withBranch({ range }) }).then((res) => res.data.data);

const getRejectedTrend = (range = 'month') =>
  api.get('/dashboard/rejected-trend', { params: withBranch({ range }) }).then((res) => res.data.data);

const getTopProducts = (range = 'month', limit = 10) =>
  api
    .get('/dashboard/top-products', { params: withBranch({ range, limit }) })
    .then((res) => res.data.data);

const getChannelContribution = (range = 'month') =>
  api
    .get('/dashboard/channel-contribution', { params: withBranch({ range }) })
    .then((res) => res.data.data);

const getPaymentType = (range = 'month') =>
  api
    .get('/dashboard/payment-type', { params: withBranch({ range }) })
    .then((res) => res.data.data);

const getShiftSummary = () =>
  api
    .get('/dashboard/shift-summary', { params: withBranch({}) })
    .then((res) => res.data.data)
    .catch((error) => {
      // Backward-compatible fallback when backend route is not deployed yet.
      if (error?.response?.status === 404) return buildLocalShiftSummaryFallback();
      throw error;
    });

const getOrdersList = ({
  page = 1,
  pageSize = 25,
  channel = '',
  status = '',
  search = '',
  dateFrom = '',
  dateTo = '',
} = {}) =>
  api
    .get('/orders', {
      params: withBranch({
        page,
        page_size: pageSize,
        channel: channel || undefined,
        status: status || undefined,
        search: search || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }),
    })
    .then((res) => res.data);

const getReviewsSummary = (page = 1, pageSize = 25) =>
  api
    .get('/orders/reviews/summary', { params: withBranch({ page, page_size: pageSize }) })
    .then((res) => res.data);

export {
  getSummary,
  getSalesTrend,
  getRejectedTrend,
  getTopProducts,
  getChannelContribution,
  getPaymentType,
  getShiftSummary,
  getOrdersList,
  getReviewsSummary,
};
