import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getCustomerInsights, getCustomerSegments } from '../services/customers';

const SEGMENT_OPTIONS = [
  { value: '', label: 'All Segments' },
  { value: 'loyal', label: 'Loyal' },
  { value: 'risk', label: 'Risk' },
];

const TABLE_COLUMNS = [
  { key: 'customer_name', label: 'Customer Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'total_orders', label: 'Total Orders' },
  { key: 'total_revenue', label: 'Total Revenue' },
  { key: 'first_ordered_at', label: 'First Ordered At' },
  { key: 'last_ordered_at', label: 'Last Ordered At' },
];

const DEFAULT_FILTERS = {
  search: '',
  segment: '',
  last_order_from: '',
  last_order_to: '',
  total_orders_min: '',
  total_orders_max: '',
  total_revenue_min: '',
  total_revenue_max: '',
  include_guests: true,
};

const toApiParams = ({ filters, sort, page }) => ({
  page,
  page_size: 25,
  search: filters.search || undefined,
  segment: filters.segment || undefined,
  last_order_from: filters.last_order_from || undefined,
  last_order_to: filters.last_order_to || undefined,
  total_orders_min: filters.total_orders_min === '' ? undefined : Number(filters.total_orders_min),
  total_orders_max: filters.total_orders_max === '' ? undefined : Number(filters.total_orders_max),
  total_revenue_min: filters.total_revenue_min === '' ? undefined : Number(filters.total_revenue_min),
  total_revenue_max: filters.total_revenue_max === '' ? undefined : Number(filters.total_revenue_max),
  include_guests: filters.include_guests,
  sort_by: sort.by,
  sort_order: sort.order,
});

const formatDate = (value) => {
  const date = new Date(value || '');
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
};

const formatMoney = (value) => `PKR ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const toWhatsAppLink = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  return `https://wa.me/${digits}`;
};

const toSegmentGroup = (segment, segmentGroup) => {
  if (segmentGroup === 'loyal' || segmentGroup === 'risk') return segmentGroup;
  if (segment === 'champions' || segment === 'loyal_customers') return 'loyal';
  return 'risk';
};

const segmentBadgeClass = (segmentGroup) =>
  segmentGroup === 'loyal' ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800';

function Customers() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState({ by: 'last_ordered_at', order: 'desc' });
  const [page, setPage] = useState(1);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, total_pages: 0, total: 0 });
  const [insights, setInsights] = useState({
    total_customers: 0,
    segment_counts: {},
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const params = useMemo(
    () => toApiParams({ filters: appliedFilters, sort, page }),
    [appliedFilters, sort, page]
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [segmentsResponse, insightsResponse] = await Promise.all([
        getCustomerSegments(params),
        getCustomerInsights(params),
      ]);

      setRows(segmentsResponse.data || []);
      setMeta(segmentsResponse.meta || { page: 1, total_pages: 0, total: 0 });
      setInsights(insightsResponse || { total_customers: 0, segment_counts: {} });
      setError('');
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to fetch customer data');
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (drawerOpen) return undefined;
    const timer = setInterval(loadData, 15000);
    return () => clearInterval(timer);
  }, [drawerOpen, loadData]);

  const loyalCount =
    insights.loyal_count !== undefined
      ? Number(insights.loyal_count || 0)
      : Number(insights.segment_counts?.champions || 0) +
        Number(insights.segment_counts?.loyal_customers || 0);
  const riskCount =
    insights.risk_count !== undefined
      ? Number(insights.risk_count || 0)
      : Number(insights.segment_counts?.need_attention || 0) +
        Number(insights.segment_counts?.at_risk || 0) +
        Number(insights.segment_counts?.hibernating || 0);

  const applyFilters = () => {
    setAppliedFilters(filters);
    setPage(1);
    setDrawerOpen(false);
  };

  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setSort({ by: 'last_ordered_at', order: 'desc' });
    setPage(1);
  };

  const toggleSort = (key) => {
    setSort((prev) =>
      prev.by === key
        ? { by: key, order: prev.order === 'asc' ? 'desc' : 'asc' }
        : { by: key, order: 'desc' }
    );
    setPage(1);
  };

  const runSearch = () => {
    setAppliedFilters((prev) => ({ ...prev, search: filters.search }));
    setPage(1);
  };

  const exportRows = () => {
    const lines = [
      'Customer Name,Phone,Total Orders,Total Revenue,First Ordered At,Last Ordered At,Segment',
      ...rows.map((row) =>
        [
          row.customer_name,
          row.phone || '',
          row.total_orders,
          row.total_revenue,
          row.first_ordered_at,
          row.last_ordered_at,
          toSegmentGroup(row.segment, row.segment_group),
        ]
          .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
          .join(',')
      ),
    ];
    const blob = new Blob([`${lines.join('\n')}\n`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'customers.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Marketing and Customer Engagement</h1>
            <p className="text-sm text-slate-500">Customer segmentation dashboard</p>
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-medium text-white hover:bg-cyan-600"
          >
            More Filters
          </button>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[1fr_auto_auto]">
          <input
            value={filters.search}
            onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
            placeholder="Enter customer name"
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={runSearch}
            className="rounded-lg bg-violet-700 px-4 py-2 text-xs font-medium text-white hover:bg-violet-800"
          >
            Search
          </button>
          <button
            type="button"
            onClick={exportRows}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-600"
          >
            Export to Excel
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft">
          <div className="text-xs text-slate-500">Total Customers</div>
          <div className="mt-2 text-2xl font-semibold">{Number(insights.total_customers || 0)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft">
          <div className="text-xs text-slate-500">Loyal</div>
          <div className="mt-2 text-2xl font-semibold">{loyalCount}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-soft">
          <div className="text-xs text-slate-500">Risk</div>
          <div className="mt-2 text-2xl font-semibold">{riskCount}</div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                {TABLE_COLUMNS.map((column) => (
                  <th key={column.key} className="px-2 py-2 text-left">
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className="inline-flex items-center gap-1 hover:text-slate-900"
                    >
                      {column.label}
                    </button>
                  </th>
                ))}
                <th className="px-2 py-2 text-left">Segment</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-2 py-8 text-center text-slate-500">
                    {loading ? 'Loading...' : 'No customers found'}
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => {
                  const segmentGroup = toSegmentGroup(row.segment, row.segment_group);
                  const whatsappLink = toWhatsAppLink(row.phone);
                  return (
                    <tr key={`${row.customer_id || 'guest'}-${index}`} className="border-b border-slate-100">
                      <td className="px-2 py-2 font-medium">{row.customer_name || 'Unknown'}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <span>{row.phone || '-'}</span>
                          {whatsappLink && (
                            <a
                              href={whatsappLink}
                              target="_blank"
                              rel="noreferrer"
                              title="Open in WhatsApp"
                              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-emerald-600 hover:text-emerald-700"
                            >
                              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                                <path d="M20.52 3.48A11.83 11.83 0 0 0 12.1 0C5.58 0 .3 5.29.3 11.82c0 2.08.54 4.11 1.58 5.91L0 24l6.43-1.68a11.8 11.8 0 0 0 5.66 1.45h.01c6.52 0 11.81-5.3 11.81-11.82 0-3.15-1.22-6.1-3.39-8.47Zm-8.42 18.3h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.82 1 1.02-3.72-.23-.39a9.86 9.86 0 0 1-1.5-5.24C2.18 6.39 6.63 1.94 12.1 1.94c2.64 0 5.12 1.03 6.98 2.88a9.8 9.8 0 0 1 2.9 6.99c0 5.47-4.45 9.92-9.88 9.92Zm5.42-7.39c-.3-.15-1.79-.88-2.06-.98-.28-.1-.48-.15-.68.15-.2.3-.78.98-.96 1.18-.18.2-.35.23-.65.08-.3-.15-1.28-.47-2.44-1.5-.91-.81-1.52-1.82-1.7-2.12-.18-.3-.02-.46.14-.61.13-.13.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.68-1.64-.94-2.24-.25-.6-.5-.52-.68-.53-.17-.01-.38-.01-.58-.01-.2 0-.53.08-.8.38-.28.3-1.05 1.03-1.05 2.5 0 1.48 1.08 2.9 1.23 3.1.15.2 2.12 3.24 5.13 4.55.72.31 1.28.5 1.72.64.72.23 1.37.2 1.88.12.57-.08 1.79-.73 2.04-1.43.25-.71.25-1.31.18-1.43-.07-.12-.27-.2-.57-.35Z" />
                              </svg>
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-2">{Number(row.total_orders || 0)}</td>
                      <td className="px-2 py-2">{formatMoney(row.total_revenue)}</td>
                      <td className="px-2 py-2">{formatDate(row.first_ordered_at)}</td>
                      <td className="px-2 py-2">{formatDate(row.last_ordered_at)}</td>
                      <td className="px-2 py-2">
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${segmentBadgeClass(
                            segmentGroup
                          )}`}
                        >
                          {segmentGroup}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
            disabled={meta.page <= 1 || loading}
            className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-50"
          >
            Previous
          </button>
          <div>
            Page {meta.page || page} of {Math.max(meta.total_pages || 0, 1)}
          </div>
          <button
            type="button"
            onClick={() => setPage((prev) => prev + 1)}
            disabled={meta.total_pages === 0 || meta.page >= meta.total_pages || loading}
            className="rounded-lg border border-slate-200 px-3 py-1.5 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
          <div className="h-full w-full max-w-sm overflow-y-auto bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">More Filters</h2>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="text-slate-500 hover:text-slate-700"
              >
                x
              </button>
            </div>

            <div className="mt-4 space-y-3 text-sm">
              <label className="block">
                <span className="text-xs text-slate-500">Last Order Date From</span>
                <input
                  type="datetime-local"
                  value={filters.last_order_from}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, last_order_from: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-xs text-slate-500">Last Order Date To</span>
                <input
                  type="datetime-local"
                  value={filters.last_order_to}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, last_order_to: event.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs text-slate-500">Orders Min</span>
                  <input
                    type="number"
                    min="0"
                    value={filters.total_orders_min}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, total_orders_min: event.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Orders Max</span>
                  <input
                    type="number"
                    min="0"
                    value={filters.total_orders_max}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, total_orders_max: event.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs text-slate-500">Revenue Min</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={filters.total_revenue_min}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, total_revenue_min: event.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-slate-500">Revenue Max</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={filters.total_revenue_max}
                    onChange={(event) =>
                      setFilters((prev) => ({ ...prev, total_revenue_max: event.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs text-slate-500">Segment</span>
                <select
                  value={filters.segment}
                  onChange={(event) => setFilters((prev) => ({ ...prev, segment: event.target.value }))}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
                >
                  {SEGMENT_OPTIONS.map((option) => (
                    <option key={option.value || 'all'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <input
                  type="checkbox"
                  checked={filters.include_guests}
                  onChange={(event) =>
                    setFilters((prev) => ({ ...prev, include_guests: event.target.checked }))
                  }
                />
                Include guests / unidentified
              </label>
            </div>

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={clearFilters}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={applyFilters}
                className="flex-1 rounded-lg bg-brandYellow px-3 py-2 text-sm font-medium"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Customers;
