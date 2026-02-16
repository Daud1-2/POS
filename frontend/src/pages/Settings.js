import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getBusinessSettings,
  getBranchSettings,
  getBranches,
  createBranch,
  deleteBranch,
  getBranchId,
  updateBranchSettings,
  updateBusinessSettings,
} from '../services/settings';

const WEEK_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const DEFAULT_WORKING_HOURS = {
  monday: { open: '09:00', close: '22:00' },
  tuesday: { open: '09:00', close: '22:00' },
  wednesday: { open: '09:00', close: '22:00' },
  thursday: { open: '09:00', close: '22:00' },
  friday: { open: '09:00', close: '22:00' },
  saturday: { open: '09:00', close: '22:00' },
  sunday: { open: '09:00', close: '22:00' },
};
const DEFAULT_TIMEZONE = 'Asia/Karachi';

const DEFAULT_BUSINESS_FORM = {
  default_currency: 'PKR',
  tax_enabled: false,
  default_tax_percent: 0,
  rounding_rule: 'none',
  discount_stacking_enabled: true,
  admin_switch_pin: '0000',
};

const DEFAULT_BRANCH_FORM = {
  is_open: true,
  accepting_orders: true,
  maintenance_mode: false,
  temporary_closed: false,
  enforce_working_hours: true,
  working_hours: DEFAULT_WORKING_HOURS,
};

const DEFAULT_NEW_BRANCH_FORM = {
  name: '',
  timezone: DEFAULT_TIMEZONE,
  is_active: true,
};

const toTitle = (value) => value.charAt(0).toUpperCase() + value.slice(1);
const parseBranchIds = (value) =>
  String(value || '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);

const ToggleCard = ({ label, checked, disabled, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    disabled={disabled}
    className={`w-full rounded-xl border px-4 py-3 text-left transition ${
      disabled ? 'opacity-60 cursor-not-allowed' : 'hover:border-brandYellow/80'
    } ${checked ? 'border-purple-300 bg-purple-50/60' : 'border-slate-200 bg-white'}`}
  >
    <span className="flex items-center justify-between gap-3">
      <span className="text-base font-medium text-slate-800">{label}</span>
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-md border text-sm font-bold ${
          checked
            ? 'border-purple-500 bg-purple-500 text-white'
            : 'border-slate-400 bg-white text-transparent'
        }`}
      >
        ✓
      </span>
    </span>
  </button>
);

function Settings() {
  const branchId = getBranchId();
  const currentRole = (localStorage.getItem('userRole') || 'admin').toLowerCase();
  const canEditBusiness = currentRole === 'admin';
  const canEditBranch = currentRole === 'admin' || currentRole === 'manager';

  const [loading, setLoading] = useState(true);
  const [savingBusiness, setSavingBusiness] = useState(false);
  const [savingBranch, setSavingBranch] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [deletingBranchId, setDeletingBranchId] = useState(null);
  const [flash, setFlash] = useState('');

  const [businessForm, setBusinessForm] = useState(DEFAULT_BUSINESS_FORM);
  const [branchForm, setBranchForm] = useState(DEFAULT_BRANCH_FORM);
  const [branches, setBranches] = useState([]);
  const [newBranchForm, setNewBranchForm] = useState(DEFAULT_NEW_BRANCH_FORM);
  const [branchMeta, setBranchMeta] = useState({
    id: branchId,
    branch_id: branchId,
    name: `Branch ${branchId}`,
    timezone: DEFAULT_TIMEZONE,
  });

  const roleLabel = useMemo(() => toTitle(currentRole), [currentRole]);
  const sortedBranches = useMemo(
    () =>
      [...branches].sort(
        (a, b) => Number(a.branch_id || a.id || 0) - Number(b.branch_id || b.id || 0)
      ),
    [branches]
  );
  const branchDisplayOrder = useMemo(() => {
    const map = {};
    sortedBranches.forEach((branch, index) => {
      const id = Number(branch.branch_id || branch.id || 0);
      if (id > 0) {
        map[id] = index + 1;
      }
    });
    return map;
  }, [sortedBranches]);
  const selectedBranchDisplayNo = branchDisplayOrder[Number(branchMeta.branch_id || branchMeta.id || 0)] || 1;

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const [businessResult, branchResult, branchListResult] = await Promise.allSettled([
        getBusinessSettings(),
        getBranchSettings(),
        getBranches(),
      ]);
      const business = businessResult.status === 'fulfilled' ? businessResult.value : null;
      const branchResponse = branchResult.status === 'fulfilled' ? branchResult.value : null;
      const branchList = branchListResult.status === 'fulfilled' ? branchListResult.value : [];
      if (business) {
        const adminSwitchPin = String(business.admin_switch_pin || '0000').trim();
        setBusinessForm({
          default_currency: business.default_currency || 'PKR',
          tax_enabled: Boolean(business.tax_enabled),
          default_tax_percent: Number(business.default_tax_percent || 0),
          rounding_rule: business.rounding_rule || 'none',
          discount_stacking_enabled: business.discount_stacking_enabled !== false,
          admin_switch_pin: /^\d{4}$/.test(adminSwitchPin) ? adminSwitchPin : '0000',
        });
        localStorage.setItem(
          'adminSwitchPin',
          /^\d{4}$/.test(adminSwitchPin) ? adminSwitchPin : '0000'
        );
      }

      if (branchResponse) {
        setBranchMeta({
          id: branchResponse.branch?.id ?? branchId,
          branch_id: branchResponse.branch?.branch_id ?? branchResponse.branch?.id ?? branchId,
          name: branchResponse.branch?.name || `Branch ${branchId}`,
          timezone: branchResponse.branch?.timezone || DEFAULT_TIMEZONE,
        });
        setBranchForm({
          is_open: branchResponse.settings?.is_open !== false,
          accepting_orders: branchResponse.settings?.accepting_orders !== false,
          maintenance_mode: Boolean(branchResponse.settings?.maintenance_mode),
          temporary_closed: Boolean(branchResponse.settings?.temporary_closed),
          enforce_working_hours: branchResponse.settings?.enforce_working_hours !== false,
          working_hours: branchResponse.settings?.working_hours || DEFAULT_WORKING_HOURS,
        });
      }
      setBranches(Array.isArray(branchList) ? branchList : []);
      setFlash('');
    } catch (err) {
      setFlash(err?.response?.data?.error || 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const onBusinessSubmit = async (event) => {
    event.preventDefault();
    if (!canEditBusiness) return;
    setSavingBusiness(true);
    try {
      await updateBusinessSettings({
        default_currency: businessForm.default_currency,
        tax_enabled: businessForm.tax_enabled,
        default_tax_percent: Number(businessForm.default_tax_percent || 0),
        rounding_rule: businessForm.rounding_rule,
        discount_stacking_enabled: businessForm.discount_stacking_enabled,
        admin_switch_pin: businessForm.admin_switch_pin,
      });
      await loadSettings();
      setFlash('Business settings saved');
    } catch (err) {
      setFlash(err?.response?.data?.error || 'Failed to save business settings');
    } finally {
      setSavingBusiness(false);
    }
  };

  const onBranchSubmit = async (event) => {
    event.preventDefault();
    if (!canEditBranch) return;
    setSavingBranch(true);
    try {
      await updateBranchSettings({
        is_open: branchForm.is_open,
        accepting_orders: branchForm.accepting_orders,
        maintenance_mode: branchForm.maintenance_mode,
        temporary_closed: branchForm.temporary_closed,
        enforce_working_hours: branchForm.enforce_working_hours,
        working_hours: branchForm.working_hours,
      });
      await loadSettings();
      setFlash('Branch settings saved');
    } catch (err) {
      setFlash(err?.response?.data?.error || 'Failed to save branch settings');
    } finally {
      setSavingBranch(false);
    }
  };

  const onCreateBranch = async (event) => {
    event.preventDefault();
    if (!canEditBusiness) return;
    setCreatingBranch(true);
    try {
      const created = await createBranch({
        name: newBranchForm.name,
        timezone: newBranchForm.timezone || DEFAULT_TIMEZONE,
        is_active: newBranchForm.is_active,
      });

      const newBranchId = Number(created?.branch?.branch_id || created?.branch?.id || 0);
      if (newBranchId > 0) {
        const current = parseBranchIds(localStorage.getItem('adminBranchIds'));
        if (!current.includes(newBranchId)) {
          current.push(newBranchId);
          localStorage.setItem('adminBranchIds', current.join(','));
        }
        window.dispatchEvent(new CustomEvent('branches-updated', { detail: { action: 'create', branch_id: newBranchId } }));
      }

      setNewBranchForm(DEFAULT_NEW_BRANCH_FORM);
      await loadSettings();
      setFlash('Branch created successfully');
    } catch (err) {
      setFlash(err?.response?.data?.error || 'Failed to create branch');
    } finally {
      setCreatingBranch(false);
    }
  };

  const onDeleteBranch = async (targetBranch) => {
    if (!canEditBusiness) return;
    const targetId = Number(targetBranch?.branch_id || targetBranch?.id || 0);
    if (!targetId) return;

    const confirmed = window.confirm(
      `Delete branch "${targetBranch.name || `Branch ${targetId}`}"? This is a soft delete.`
    );
    if (!confirmed) return;

    setDeletingBranchId(targetId);
    try {
      await deleteBranch(targetId);

      const current = parseBranchIds(localStorage.getItem('adminBranchIds')).filter((id) => id !== targetId);
      if (current.length) {
        localStorage.setItem('adminBranchIds', current.join(','));
      } else {
        localStorage.removeItem('adminBranchIds');
      }

      if (Number(localStorage.getItem('branchId')) === targetId) {
        const fallbackBranch = branches.find((branch) => Number(branch.branch_id || branch.id) !== targetId);
        const fallback = Number(fallbackBranch?.branch_id || fallbackBranch?.id || 1);
        localStorage.setItem('branchId', String(fallback));
      }
      window.dispatchEvent(new CustomEvent('branches-updated', { detail: { action: 'delete', branch_id: targetId } }));

      await loadSettings();
      setFlash('Branch deleted successfully');
    } catch (err) {
      setFlash(err?.response?.data?.error || 'Failed to delete branch');
    } finally {
      setDeletingBranchId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Settings</h1>
            <p className="text-sm text-slate-500">
              Branch {selectedBranchDisplayNo} | Role: {roleLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={loadSettings}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs hover:border-brandYellow/80"
          >
            Refresh
          </button>
        </div>
        {flash && <div className="mt-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{flash}</div>}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <form onSubmit={onBusinessSubmit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
          <h2 className="text-lg font-semibold">Business Settings (Global)</h2>
          <p className="text-xs text-slate-500">
            Controls tax, rounding, default currency, and discount stacking for all branches.
          </p>

          <div className="mt-4 space-y-3">
            <label className="block text-sm">
              <span className="text-xs text-slate-500">Default Currency</span>
              <input
                value={businessForm.default_currency}
                onChange={(event) =>
                  setBusinessForm((prev) => ({ ...prev, default_currency: event.target.value.toUpperCase() }))
                }
                disabled={!canEditBusiness || loading || savingBusiness}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </label>

            <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <span className="text-sm">Tax Enabled</span>
              <input
                type="checkbox"
                checked={businessForm.tax_enabled}
                onChange={(event) =>
                  setBusinessForm((prev) => ({ ...prev, tax_enabled: event.target.checked }))
                }
                disabled={!canEditBusiness || loading || savingBusiness}
                className="h-4 w-4 rounded border-slate-300 text-brandYellow focus:ring-brandYellow"
              />
            </label>

            <label className="block text-sm">
              <span className="text-xs text-slate-500">Default Tax Percent</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={businessForm.default_tax_percent}
                onChange={(event) =>
                  setBusinessForm((prev) => ({ ...prev, default_tax_percent: event.target.value }))
                }
                disabled={!canEditBusiness || loading || savingBusiness || !businessForm.tax_enabled}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              />
            </label>

            <label className="block text-sm">
              <span className="text-xs text-slate-500">Rounding Rule</span>
              <select
                value={businessForm.rounding_rule}
                onChange={(event) =>
                  setBusinessForm((prev) => ({ ...prev, rounding_rule: event.target.value }))
                }
                disabled={!canEditBusiness || loading || savingBusiness}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              >
                <option value="none">None</option>
                <option value="round_up">Round Up</option>
                <option value="round_down">Round Down</option>
                <option value="bankers_rounding">Bankers Rounding</option>
              </select>
            </label>

            <label className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
              <span className="text-sm">Discount Stacking Enabled</span>
              <input
                type="checkbox"
                checked={businessForm.discount_stacking_enabled}
                onChange={(event) =>
                  setBusinessForm((prev) => ({ ...prev, discount_stacking_enabled: event.target.checked }))
                }
                disabled={!canEditBusiness || loading || savingBusiness}
                className="h-4 w-4 rounded border-slate-300 text-brandYellow focus:ring-brandYellow"
              />
            </label>

            <label className="block text-sm">
              <span className="text-xs text-slate-500">Admin Switch PIN (4 digits)</span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={4}
                value={businessForm.admin_switch_pin}
                onChange={(event) =>
                  setBusinessForm((prev) => ({
                    ...prev,
                    admin_switch_pin: event.target.value.replace(/\D/g, '').slice(0, 4),
                  }))
                }
                disabled={!canEditBusiness || loading || savingBusiness}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2"
              />
              <span className="mt-1 block text-[11px] text-slate-500">
                Used for "Switch to Admin" in top bar. Default PIN is 0000.
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={!canEditBusiness || loading || savingBusiness}
            className="mt-4 rounded-lg bg-brandYellow px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {savingBusiness ? 'Saving...' : 'Save Business Settings'}
          </button>
        </form>

        <form onSubmit={onBranchSubmit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
          <h2 className="text-lg font-semibold">Branch Schedule Settings</h2>
          <p className="text-xs text-slate-500">
            {branchMeta.name} ({branchMeta.timezone})
          </p>

          <div className="mt-4 space-y-2">
            <h3 className="text-sm font-medium">Working Hours</h3>
            {WEEK_DAYS.map((day) => (
              <div key={day} className="grid grid-cols-[110px_1fr_1fr] items-center gap-2">
                <div className="text-xs text-slate-500">{toTitle(day)}</div>
                <input
                  type="time"
                  value={branchForm.working_hours?.[day]?.open || '09:00'}
                  onChange={(event) =>
                    setBranchForm((prev) => ({
                      ...prev,
                      working_hours: {
                        ...prev.working_hours,
                        [day]: {
                          ...(prev.working_hours?.[day] || {}),
                          open: event.target.value,
                        },
                      },
                    }))
                  }
                  disabled={!canEditBranch || loading || savingBranch}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
                <input
                  type="time"
                  value={branchForm.working_hours?.[day]?.close || '22:00'}
                  onChange={(event) =>
                    setBranchForm((prev) => ({
                      ...prev,
                      working_hours: {
                        ...prev.working_hours,
                        [day]: {
                          ...(prev.working_hours?.[day] || {}),
                          close: event.target.value,
                        },
                      },
                    }))
                  }
                  disabled={!canEditBranch || loading || savingBranch}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={!canEditBranch || loading || savingBranch}
            className="mt-4 rounded-lg bg-brandYellow px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {savingBranch ? 'Saving...' : 'Save Working Hours'}
          </button>
        </form>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
        <h2 className="text-lg font-semibold">Branch Management (Settings Subsection)</h2>
        <p className="text-xs text-slate-500">
          Add branch names here. These branches appear in the top selector and are used to assign website/app orders.
        </p>

        {canEditBusiness && (
          <form onSubmit={onCreateBranch} className="mt-4 grid gap-2 md:grid-cols-[1fr_220px_auto_auto]">
            <input
              value={newBranchForm.name}
              onChange={(event) =>
                setNewBranchForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="Branch name"
              disabled={creatingBranch || loading}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <input
              value={newBranchForm.timezone}
              onChange={(event) =>
                setNewBranchForm((prev) => ({ ...prev, timezone: event.target.value }))
              }
              placeholder="Timezone (e.g. Asia/Karachi)"
              disabled={creatingBranch || loading}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={newBranchForm.is_active}
                onChange={(event) =>
                  setNewBranchForm((prev) => ({ ...prev, is_active: event.target.checked }))
                }
                disabled={creatingBranch || loading}
                className="h-4 w-4 rounded border-slate-300 text-brandYellow focus:ring-brandYellow"
              />
              Active
            </label>
            <button
              type="submit"
              disabled={creatingBranch || loading}
              className="rounded-lg bg-brandYellow px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {creatingBranch ? 'Adding...' : 'Add Branch'}
            </button>
          </form>
        )}

        <div className="mt-4 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="text-left px-3 py-2">Branch</th>
                <th className="text-left px-3 py-2">Branch ID</th>
                <th className="text-left px-3 py-2">Timezone</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {sortedBranches.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    {loading ? 'Loading branches...' : 'No branches found'}
                  </td>
                </tr>
              ) : (
                sortedBranches.map((branch) => (
                  <tr key={branch.branch_id || branch.id} className="border-b border-slate-100">
                    <td className="px-3 py-2 font-medium">{branch.name}</td>
                    <td className="px-3 py-2">
                      #{branchDisplayOrder[Number(branch.branch_id || branch.id || 0)] || '-'}
                    </td>
                    <td className="px-3 py-2">{branch.timezone || DEFAULT_TIMEZONE}</td>
                    <td className="px-3 py-2">{branch.is_active ? 'Active' : 'Inactive'}</td>
                    <td className="px-3 py-2">
                      {canEditBusiness ? (
                        <button
                          type="button"
                          onClick={() => onDeleteBranch(branch)}
                          disabled={deletingBranchId === Number(branch.branch_id || branch.id)}
                          className="rounded-lg border border-rose-200 px-3 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                        >
                          {deletingBranchId === Number(branch.branch_id || branch.id)
                            ? 'Deleting...'
                            : 'Delete'}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">Read-only</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <form onSubmit={onBranchSubmit} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
        <h2 className="text-lg font-semibold">Branch Status Toggles</h2>
        <p className="text-xs text-slate-500">
          {branchMeta.name} ({branchMeta.timezone}) operational controls
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ToggleCard
            label="Is Open"
            checked={branchForm.is_open}
            disabled={!canEditBranch || loading || savingBranch}
            onToggle={() => setBranchForm((prev) => ({ ...prev, is_open: !prev.is_open }))}
          />
          <ToggleCard
            label="Accepting Orders"
            checked={branchForm.accepting_orders}
            disabled={!canEditBranch || loading || savingBranch}
            onToggle={() =>
              setBranchForm((prev) => ({ ...prev, accepting_orders: !prev.accepting_orders }))
            }
          />
          <ToggleCard
            label="Maintenance Mode"
            checked={branchForm.maintenance_mode}
            disabled={!canEditBranch || loading || savingBranch}
            onToggle={() =>
              setBranchForm((prev) => ({ ...prev, maintenance_mode: !prev.maintenance_mode }))
            }
          />
          <ToggleCard
            label="Temporary Closed"
            checked={branchForm.temporary_closed}
            disabled={!canEditBranch || loading || savingBranch}
            onToggle={() =>
              setBranchForm((prev) => ({ ...prev, temporary_closed: !prev.temporary_closed }))
            }
          />
          <div className="sm:col-span-2">
            <ToggleCard
              label="Enforce Working Hours"
              checked={branchForm.enforce_working_hours}
              disabled={!canEditBranch || loading || savingBranch}
              onToggle={() =>
                setBranchForm((prev) => ({ ...prev, enforce_working_hours: !prev.enforce_working_hours }))
              }
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={!canEditBranch || loading || savingBranch}
          className="mt-4 rounded-lg bg-brandYellow px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {savingBranch ? 'Saving...' : 'Save Status Toggles'}
        </button>
      </form>
    </div>
  );
}

export default Settings;
