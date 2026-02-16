import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getOrdersList, getReviewsSummary } from '../services/dashboard';

const TABS = [
  { key: 'pos_live', label: 'POS Live' },
  { key: 'online_live', label: 'Online Live' },
  { key: 'completed', label: 'Completed' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'reviews', label: 'Order Reviews' },
];

const formatCurrency = (value) => `PKR ${Number(value || 0).toLocaleString()}`;

const getTabQueryFilters = (tab) => {
  if (tab === 'pos_live') {
    return {
      channel: 'pos',
      status: 'pending',
    };
  }
  if (tab === 'online_live') {
    return {
      channel: 'online,whatsapp,delivery_platform',
      status: 'new,accepted,preparing,ready',
    };
  }
  if (tab === 'completed') {
    return {
      status: 'completed',
    };
  }
  if (tab === 'exceptions') {
    return {
      status: 'cancelled,rejected,refunded',
    };
  }
  return {};
};

function Orders() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const initialTab = TABS.some((tab) => tab.key === urlTab) ? urlTab : 'pos_live';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ page: 1, page_size: 10, total: 0, total_pages: 0 });
  const [reviewSummary, setReviewSummary] = useState({ average_rating: 0, total_reviews: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async (tabKey, page = 1, searchTerm = '') => {
    setLoading(true);
    try {
      if (tabKey === 'reviews') {
        const res = await getReviewsSummary(page, 10);
        setRows(res.data || []);
        setMeta(res.meta || { page: 1, page_size: 10, total: 0, total_pages: 0 });
        setReviewSummary(res.summary || { average_rating: 0, total_reviews: 0 });
      } else {
        const queryFilters = getTabQueryFilters(tabKey);
        const res = await getOrdersList({
          page,
          pageSize: 10,
          search: searchTerm,
          ...queryFilters,
        });
        setRows(res.data || []);
        setMeta(res.meta || { page: 1, page_size: 10, total: 0, total_pages: 0 });
      }
      setError('');
    } catch (err) {
      setError('Failed to load orders module data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(activeTab, 1, search);
    const timer = setInterval(() => loadData(activeTab, 1, search), 15000);
    return () => clearInterval(timer);
  }, [activeTab, loadData, search]);

  const hasPrev = meta.page > 1;
  const hasNext = meta.total_pages > meta.page;
  const heading = useMemo(() => TABS.find((tab) => tab.key === activeTab)?.label || 'Orders', [activeTab]);

  useEffect(() => {
    const tabFromUrl = searchParams.get('tab');
    if (tabFromUrl && TABS.some((tab) => tab.key === tabFromUrl) && tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
  }, [activeTab, searchParams]);

  const switchTab = (tabKey) => {
    setActiveTab(tabKey);
    setMeta({ page: 1, page_size: 10, total: 0, total_pages: 0 });
    setSearchParams({ tab: tabKey });
  };

  return (
    <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-6 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <h1 className="text-xl font-semibold">Orders</h1>
        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => switchTab(tab.key)}
              className={`px-3 py-1.5 rounded-lg text-xs border ${
                activeTab === tab.key
                  ? 'bg-brandYellow/20 border-brandYellow text-slate-900'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search order number or customer"
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />

      {error && <div className="bg-yellow-100 text-ink text-sm rounded-xl px-4 py-3">{error}</div>}

      <div className="text-sm text-slate-700 font-semibold">{heading}</div>

      {activeTab === 'reviews' && (
        <div className="text-xs text-slate-600">
          Average Rating: <span className="font-semibold">{Number(reviewSummary.average_rating || 0).toFixed(2)}</span>
          <span className="mx-1">|</span>
          Total Reviews: <span className="font-semibold">{Number(reviewSummary.total_reviews || 0)}</span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-100 text-slate-700">
            {activeTab === 'reviews' ? (
              <tr>
                <th className="text-left py-2 px-2">ORDER</th>
                <th className="text-left py-2 px-2">RATING</th>
                <th className="text-left py-2 px-2">COMMENT</th>
                <th className="text-right py-2 px-2">TOTAL</th>
              </tr>
            ) : (
              <tr>
                <th className="text-left py-2 px-2">ORDER</th>
                <th className="text-left py-2 px-2">CHANNEL</th>
                <th className="text-left py-2 px-2">SOURCE</th>
                <th className="text-left py-2 px-2">STATUS</th>
                <th className="text-left py-2 px-2">TYPE</th>
                <th className="text-right py-2 px-2">TOTAL</th>
              </tr>
            )}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={activeTab === 'reviews' ? 4 : 6} className="py-6 text-center text-muted">
                  {loading ? 'Loading...' : 'No data yet'}
                </td>
              </tr>
            ) : activeTab === 'reviews' ? (
              rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="py-2 px-2">{row.order_number || '-'}</td>
                  <td className="py-2 px-2">{row.rating}</td>
                  <td className="py-2 px-2">{row.comment || 'No comment'}</td>
                  <td className="py-2 px-2 text-right">{formatCurrency(row.total)}</td>
                </tr>
              ))
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b last:border-0">
                  <td className="py-2 px-2">{row.order_number || '-'}</td>
                  <td className="py-2 px-2 uppercase">{row.order_channel || '-'}</td>
                  <td className="py-2 px-2">{row.source || '-'}</td>
                  <td className="py-2 px-2 capitalize">{row.status || '-'}</td>
                  <td className="py-2 px-2">{row.order_type || '-'}</td>
                  <td className="py-2 px-2 text-right">{formatCurrency(row.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          disabled={!hasPrev || loading}
          onClick={() => loadData(activeTab, meta.page - 1, search)}
          className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 disabled:opacity-50"
        >
          Previous
        </button>
        <div className="text-xs text-slate-600">
          Page {meta.page} of {Math.max(meta.total_pages || 0, 1)}
        </div>
        <button
          type="button"
          disabled={!hasNext || loading}
          onClick={() => loadData(activeTab, meta.page + 1, search)}
          className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default Orders;
