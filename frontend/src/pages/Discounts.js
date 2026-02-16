import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  createBulkDiscount,
  createPromoCode,
  deleteBulkDiscount,
  deletePromoCode,
  getBranchId,
  listBulkDiscounts,
  listPromoCodes,
  toggleBulkDiscount,
  togglePromoCode,
  updateBulkDiscount,
  updatePromoCode,
} from '../services/discounts';
import { getBranchDisplayLabel } from '../services/settings';

const TABS = [
  { key: 'promo', label: 'Promo Codes' },
  { key: 'bulk', label: 'Bulk Section Discounts' },
];

const DEFAULT_PROMO_FORM = {
  code: '',
  name: '',
  applicable_on: 'both',
  discount_type: 'percentage',
  discount_value: '',
  min_order_amount: '',
  max_discount_amount: '',
  usage_limit: '',
  per_user_limit: '',
  start_time: '',
  end_time: '',
  status: 'active',
};

const DEFAULT_BULK_FORM = {
  name: '',
  description: '',
  applies_to: 'section',
  discount_type: 'percentage',
  discount_value: '',
  section_id: '',
  product_id: '',
  category_id: '',
  branch_id: '',
  min_quantity: '',
  priority: 1,
  start_time: '',
  end_time: '',
  status: 'active',
};

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString();
};

const formatAmount = (value) => Number(value || 0).toFixed(2);

function Discounts() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab');
  const activeTab = TABS.some((entry) => entry.key === tab) ? tab : 'promo';
  const branchId = getBranchId();
  const branchLabel = getBranchDisplayLabel(branchId);

  const [flash, setFlash] = useState('');
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    status: '',
    search: '',
    activeNow: false,
    expired: false,
    upcoming: false,
    page: 1,
  });

  const [promoRows, setPromoRows] = useState([]);
  const [promoMeta, setPromoMeta] = useState({ page: 1, page_size: 10, total: 0, total_pages: 0 });
  const [promoForm, setPromoForm] = useState(DEFAULT_PROMO_FORM);
  const [editingPromoUuid, setEditingPromoUuid] = useState('');

  const [bulkRows, setBulkRows] = useState([]);
  const [bulkMeta, setBulkMeta] = useState({ page: 1, page_size: 10, total: 0, total_pages: 0 });
  const [bulkForm, setBulkForm] = useState(DEFAULT_BULK_FORM);
  const [editingBulkUuid, setEditingBulkUuid] = useState('');

  useEffect(() => {
    if (!tab || !TABS.some((entry) => entry.key === tab)) {
      setSearchParams({ tab: 'promo' }, { replace: true });
    }
  }, [tab, setSearchParams]);

  const loadPromo = useCallback(
    async (page = 1) => {
      const response = await listPromoCodes({
        page,
        pageSize: 10,
        status: filters.status,
        search: filters.search,
        activeNow: filters.activeNow,
        expired: filters.expired,
        upcoming: filters.upcoming,
      });
      setPromoRows(response.data || []);
      setPromoMeta(response.meta || { page: 1, page_size: 10, total: 0, total_pages: 0 });
    },
    [filters]
  );

  const loadBulk = useCallback(
    async (page = 1) => {
      const response = await listBulkDiscounts({
        page,
        pageSize: 10,
        status: filters.status,
        search: filters.search,
        activeNow: filters.activeNow,
        expired: filters.expired,
        upcoming: filters.upcoming,
      });
      setBulkRows(response.data || []);
      setBulkMeta(response.meta || { page: 1, page_size: 10, total: 0, total_pages: 0 });
    },
    [filters]
  );

  const loadCurrent = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        if (activeTab === 'promo') {
          await loadPromo(page);
        } else {
          await loadBulk(page);
        }
      } catch (err) {
        setFlash(err?.response?.data?.error || 'Failed to fetch discounts data');
      } finally {
        setLoading(false);
      }
    },
    [activeTab, loadBulk, loadPromo]
  );

  useEffect(() => {
    loadCurrent(filters.page);
  }, [activeTab, filters.page, loadCurrent]);

  const resetPromoForm = () => {
    setPromoForm(DEFAULT_PROMO_FORM);
    setEditingPromoUuid('');
  };

  const resetBulkForm = () => {
    setBulkForm(DEFAULT_BULK_FORM);
    setEditingBulkUuid('');
  };

  const submitPromo = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const payload = {
        ...promoForm,
        discount_value: Number(promoForm.discount_value),
        min_order_amount: promoForm.min_order_amount === '' ? null : Number(promoForm.min_order_amount),
        max_discount_amount: promoForm.max_discount_amount === '' ? null : Number(promoForm.max_discount_amount),
        usage_limit: promoForm.usage_limit === '' ? null : Number(promoForm.usage_limit),
        per_user_limit: promoForm.per_user_limit === '' ? null : Number(promoForm.per_user_limit),
      };
      if (editingPromoUuid) {
        await updatePromoCode(editingPromoUuid, payload);
      } else {
        await createPromoCode(payload);
      }
      resetPromoForm();
      await loadPromo(1);
      setFlash('Promo code saved');
    } catch (err) {
      setFlash(err?.response?.data?.error || 'Failed to save promo code');
    } finally {
      setLoading(false);
    }
  };

  const submitBulk = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const payload = {
        ...bulkForm,
        discount_value: Number(bulkForm.discount_value),
        min_quantity: bulkForm.min_quantity === '' ? null : Number(bulkForm.min_quantity),
        priority: Number(bulkForm.priority || 1),
        category_id: bulkForm.category_id === '' ? null : Number(bulkForm.category_id),
        product_id: bulkForm.product_id === '' ? null : Number(bulkForm.product_id),
        section_id: bulkForm.section_id === '' ? null : bulkForm.section_id,
        branch_id: bulkForm.branch_id === '' ? null : Number(bulkForm.branch_id),
      };
      if (editingBulkUuid) {
        await updateBulkDiscount(editingBulkUuid, payload);
      } else {
        await createBulkDiscount(payload);
      }
      resetBulkForm();
      await loadBulk(1);
      setFlash('Bulk discount saved');
    } catch (err) {
      setFlash(err?.response?.data?.error || 'Failed to save bulk discount');
    } finally {
      setLoading(false);
    }
  };

  const promoTargetHint = useMemo(() => {
    if (bulkForm.applies_to === 'section') return 'Enter section UUID';
    if (bulkForm.applies_to === 'product') return 'Enter product ID';
    if (bulkForm.applies_to === 'category') return 'Enter category ID';
    return 'Optional branch ID';
  }, [bulkForm.applies_to]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Discounts</h1>
            <p className="text-sm text-slate-500">{branchLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => {
                  setSearchParams({ tab: entry.key });
                  setFilters((prev) => ({ ...prev, page: 1 }));
                }}
                className={`px-3 py-2 rounded-lg text-xs border ${
                  activeTab === entry.key
                    ? 'bg-brandYellow border-brandYellow text-ink'
                    : 'border-slate-200 text-slate-600 hover:border-brandYellow/60'
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-[140px_1fr_auto_auto_auto]">
          <select
            value={filters.status}
            onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value, page: 1 }))}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="expired">Expired</option>
          </select>
          <input
            value={filters.search}
            onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value, page: 1 }))}
            placeholder={activeTab === 'promo' ? 'Search code or name' : 'Search discount name'}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <label className="text-xs flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <input
              type="checkbox"
              checked={filters.activeNow}
              onChange={(e) => setFilters((prev) => ({ ...prev, activeNow: e.target.checked, page: 1 }))}
            />
            Active now
          </label>
          <label className="text-xs flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <input
              type="checkbox"
              checked={filters.expired}
              onChange={(e) => setFilters((prev) => ({ ...prev, expired: e.target.checked, page: 1 }))}
            />
            Expired
          </label>
          <label className="text-xs flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
            <input
              type="checkbox"
              checked={filters.upcoming}
              onChange={(e) => setFilters((prev) => ({ ...prev, upcoming: e.target.checked, page: 1 }))}
            />
            Upcoming
          </label>
        </div>

        {flash && <div className="mt-3 rounded-lg bg-slate-100 text-slate-700 text-sm px-3 py-2">{flash}</div>}
      </div>

      {activeTab === 'promo' && (
        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <form onSubmit={submitPromo} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft space-y-2">
            <h2 className="font-semibold">{editingPromoUuid ? 'Edit Promo Code' : 'Create Promo Code'}</h2>
            <div className="grid grid-cols-2 gap-2">
              <input value={promoForm.code} onChange={(e) => setPromoForm((p) => ({ ...p, code: e.target.value }))} placeholder="Code" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input value={promoForm.name} onChange={(e) => setPromoForm((p) => ({ ...p, name: e.target.value }))} placeholder="Name" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <select value={promoForm.applicable_on} onChange={(e) => setPromoForm((p) => ({ ...p, applicable_on: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="both">Both</option>
                <option value="app">App</option>
                <option value="web">Web</option>
              </select>
              <select value={promoForm.discount_type} onChange={(e) => setPromoForm((p) => ({ ...p, discount_type: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed</option>
              </select>
              <input type="number" step="0.01" min="0" value={promoForm.discount_value} onChange={(e) => setPromoForm((p) => ({ ...p, discount_value: e.target.value }))} placeholder="Value" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" step="0.01" min="0" value={promoForm.min_order_amount} onChange={(e) => setPromoForm((p) => ({ ...p, min_order_amount: e.target.value }))} placeholder="Min order" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input type="number" step="0.01" min="0" value={promoForm.max_discount_amount} onChange={(e) => setPromoForm((p) => ({ ...p, max_discount_amount: e.target.value }))} placeholder="Max discount" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" min="1" value={promoForm.usage_limit} onChange={(e) => setPromoForm((p) => ({ ...p, usage_limit: e.target.value }))} placeholder="Usage limit" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input type="number" min="1" value={promoForm.per_user_limit} onChange={(e) => setPromoForm((p) => ({ ...p, per_user_limit: e.target.value }))} placeholder="Per-user limit" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="datetime-local" value={promoForm.start_time} onChange={(e) => setPromoForm((p) => ({ ...p, start_time: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input type="datetime-local" value={promoForm.end_time} onChange={(e) => setPromoForm((p) => ({ ...p, end_time: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <select value={promoForm.status} onChange={(e) => setPromoForm((p) => ({ ...p, status: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <button type="submit" disabled={loading} className="w-full rounded-lg bg-brandYellow py-2 text-sm font-medium">Save Promo</button>
            {editingPromoUuid && <button type="button" onClick={resetPromoForm} className="w-full rounded-lg border border-slate-200 py-2 text-sm">Cancel Edit</button>}
          </form>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="text-left p-2">Name / Code</th>
                  <th className="text-left p-2">App/Web</th>
                  <th className="text-left p-2">Used / Max</th>
                  <th className="text-left p-2">Start</th>
                  <th className="text-left p-2">End</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-right p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {promoRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-6 text-center text-slate-500">{loading ? 'Loading...' : 'No promo codes found'}</td>
                  </tr>
                ) : (
                  promoRows.map((promo) => (
                    <tr key={promo.uuid} className="border-b border-slate-100">
                      <td className="p-2">
                        <div className="font-medium">{promo.name}</div>
                        <div className="text-xs text-slate-500">{promo.code}</div>
                      </td>
                      <td className="p-2 uppercase">{promo.applicable_on}</td>
                      <td className="p-2">{Number(promo.used_count || 0)} / {promo.usage_limit ?? '-'}</td>
                      <td className="p-2 text-xs">{formatDate(promo.start_time)}</td>
                      <td className="p-2 text-xs">{formatDate(promo.end_time)}</td>
                      <td className="p-2 capitalize">{promo.effective_status || promo.status}</td>
                      <td className="p-2">
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => { setEditingPromoUuid(promo.uuid); setPromoForm({ ...DEFAULT_PROMO_FORM, ...promo, discount_value: promo.discount_value, min_order_amount: promo.min_order_amount ?? '', max_discount_amount: promo.max_discount_amount ?? '', usage_limit: promo.usage_limit ?? '', per_user_limit: promo.per_user_limit ?? '', start_time: promo.start_time ? new Date(promo.start_time).toISOString().slice(0, 16) : '', end_time: promo.end_time ? new Date(promo.end_time).toISOString().slice(0, 16) : '' }); }} className="px-2 py-1 border rounded text-xs">Edit</button>
                          <button type="button" onClick={() => togglePromoCode(promo.uuid).then(() => loadPromo(promoMeta.page || 1))} className="px-2 py-1 border rounded text-xs">Toggle</button>
                          <button type="button" onClick={() => deletePromoCode(promo.uuid).then(() => loadPromo(1))} className="px-2 py-1 border border-rose-200 text-rose-600 rounded text-xs">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="flex items-center justify-between pt-3 text-xs">
              <button type="button" disabled={promoMeta.page <= 1 || loading} onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page || 1) - 1 }))} className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-50">Previous</button>
              <div>Page {promoMeta.page} of {Math.max(promoMeta.total_pages || 0, 1)}</div>
              <button type="button" disabled={promoMeta.page >= promoMeta.total_pages || loading || promoMeta.total_pages === 0} onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page || 1) + 1 }))} className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-50">Next</button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'bulk' && (
        <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
          <form onSubmit={submitBulk} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft space-y-2">
            <h2 className="font-semibold">{editingBulkUuid ? 'Edit Bulk Discount' : 'Create Bulk Discount'}</h2>
            <input value={bulkForm.name} onChange={(e) => setBulkForm((p) => ({ ...p, name: e.target.value }))} placeholder="Name" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <textarea value={bulkForm.description} onChange={(e) => setBulkForm((p) => ({ ...p, description: e.target.value }))} placeholder="Description" className="w-full min-h-[74px] rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            <div className="grid grid-cols-3 gap-2">
              <select value={bulkForm.applies_to} onChange={(e) => setBulkForm((p) => ({ ...p, applies_to: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="section">Section</option>
                <option value="product">Product</option>
                <option value="category">Category</option>
                <option value="branch">Branch</option>
              </select>
              <select value={bulkForm.discount_type} onChange={(e) => setBulkForm((p) => ({ ...p, discount_type: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed</option>
              </select>
              <input type="number" step="0.01" min="0" value={bulkForm.discount_value} onChange={(e) => setBulkForm((p) => ({ ...p, discount_value: e.target.value }))} placeholder="Value" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {bulkForm.applies_to === 'section' && <input value={bulkForm.section_id} onChange={(e) => setBulkForm((p) => ({ ...p, section_id: e.target.value }))} placeholder={promoTargetHint} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />}
              {bulkForm.applies_to === 'product' && <input type="number" min="1" value={bulkForm.product_id} onChange={(e) => setBulkForm((p) => ({ ...p, product_id: e.target.value }))} placeholder={promoTargetHint} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />}
              {bulkForm.applies_to === 'category' && <input type="number" min="1" value={bulkForm.category_id} onChange={(e) => setBulkForm((p) => ({ ...p, category_id: e.target.value }))} placeholder={promoTargetHint} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />}
              {bulkForm.applies_to === 'branch' && <input type="number" min="1" value={bulkForm.branch_id} onChange={(e) => setBulkForm((p) => ({ ...p, branch_id: e.target.value }))} placeholder={promoTargetHint} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />}
              <input type="number" min="1" value={bulkForm.min_quantity} onChange={(e) => setBulkForm((p) => ({ ...p, min_quantity: e.target.value }))} placeholder="Min qty" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <input type="number" value={bulkForm.priority} onChange={(e) => setBulkForm((p) => ({ ...p, priority: e.target.value }))} placeholder="Priority" className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input type="datetime-local" value={bulkForm.start_time} onChange={(e) => setBulkForm((p) => ({ ...p, start_time: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input type="datetime-local" value={bulkForm.end_time} onChange={(e) => setBulkForm((p) => ({ ...p, end_time: e.target.value }))} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
            </div>
            <select value={bulkForm.status} onChange={(e) => setBulkForm((p) => ({ ...p, status: e.target.value }))} className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <button type="submit" disabled={loading} className="w-full rounded-lg bg-brandYellow py-2 text-sm font-medium">Save Bulk Discount</button>
            {editingBulkUuid && <button type="button" onClick={resetBulkForm} className="w-full rounded-lg border border-slate-200 py-2 text-sm">Cancel Edit</button>}
          </form>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">Applies To</th>
                  <th className="text-left p-2">Type</th>
                  <th className="text-left p-2">Value</th>
                  <th className="text-left p-2">Start</th>
                  <th className="text-left p-2">End</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-right p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bulkRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-slate-500">{loading ? 'Loading...' : 'No bulk discounts found'}</td>
                  </tr>
                ) : (
                  bulkRows.map((bulk) => (
                    <tr key={bulk.uuid} className="border-b border-slate-100">
                      <td className="p-2">
                        <div className="font-medium">{bulk.name}</div>
                        <div className="text-xs text-slate-500">Priority {bulk.priority}</div>
                      </td>
                      <td className="p-2 capitalize">{bulk.applies_to}</td>
                      <td className="p-2 capitalize">{bulk.discount_type}</td>
                      <td className="p-2">{formatAmount(bulk.discount_value)}</td>
                      <td className="p-2 text-xs">{formatDate(bulk.start_time)}</td>
                      <td className="p-2 text-xs">{formatDate(bulk.end_time)}</td>
                      <td className="p-2 capitalize">{bulk.effective_status || bulk.status}</td>
                      <td className="p-2">
                        <div className="flex justify-end gap-1">
                          <button type="button" onClick={() => { setEditingBulkUuid(bulk.uuid); setBulkForm({ ...DEFAULT_BULK_FORM, ...bulk, discount_value: bulk.discount_value, min_quantity: bulk.min_quantity ?? '', priority: bulk.priority ?? 1, category_id: bulk.category_id ?? '', product_id: bulk.product_id ?? '', section_id: bulk.section_id ?? '', branch_id: bulk.branch_id ?? '', start_time: bulk.start_time ? new Date(bulk.start_time).toISOString().slice(0, 16) : '', end_time: bulk.end_time ? new Date(bulk.end_time).toISOString().slice(0, 16) : '' }); }} className="px-2 py-1 border rounded text-xs">Edit</button>
                          <button type="button" onClick={() => toggleBulkDiscount(bulk.uuid).then(() => loadBulk(bulkMeta.page || 1))} className="px-2 py-1 border rounded text-xs">Toggle</button>
                          <button type="button" onClick={() => deleteBulkDiscount(bulk.uuid).then(() => loadBulk(1))} className="px-2 py-1 border border-rose-200 text-rose-600 rounded text-xs">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="flex items-center justify-between pt-3 text-xs">
              <button type="button" disabled={bulkMeta.page <= 1 || loading} onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page || 1) - 1 }))} className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-50">Previous</button>
              <div>Page {bulkMeta.page} of {Math.max(bulkMeta.total_pages || 0, 1)}</div>
              <button type="button" disabled={bulkMeta.page >= bulkMeta.total_pages || loading || bulkMeta.total_pages === 0} onClick={() => setFilters((prev) => ({ ...prev, page: (prev.page || 1) + 1 }))} className="px-3 py-1.5 rounded-lg border border-slate-200 disabled:opacity-50">Next</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Discounts;
