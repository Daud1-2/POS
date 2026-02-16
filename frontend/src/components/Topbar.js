import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Logo from './Logo';
import { getBranchId, getBranches, getBusinessSettings } from '../services/settings';

const DEFAULT_TIMEZONE = 'Asia/Karachi';
const DEFAULT_ADMIN_SWITCH_PIN = '0000';

const parseBranchIds = (value) =>
  String(value || '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((id) => Number.isInteger(id) && id > 0);

const getStoredBranchScope = () => {
  const raw = localStorage.getItem('branchId');
  if (raw === 'all') return 'all';
  const parsed = Number(raw || getBranchId());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
};

const getStoredRole = () => {
  const raw = String(localStorage.getItem('userRole') || 'admin').toLowerCase();
  return raw === 'cashier' ? 'cashier' : 'admin';
};

const sanitizePin = (value) => String(value || '').replace(/\D/g, '').slice(0, 4);

function Topbar() {
  const [currentRole, setCurrentRole] = useState(getStoredRole());
  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState(getStoredBranchScope());
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState('');
  const [adminSwitchPin, setAdminSwitchPin] = useState(
    sanitizePin(localStorage.getItem('adminSwitchPin') || DEFAULT_ADMIN_SWITCH_PIN)
      || DEFAULT_ADMIN_SWITCH_PIN
  );

  const refreshBranches = useCallback(async () => {
    try {
      const rows = await getBranches();
      const safeRows = Array.isArray(rows) ? rows : [];
      setBranches(safeRows);
      if (!safeRows.length) return;

      const sortedRows = [...safeRows].sort(
        (a, b) => Number(a.branch_id || a.id || 0) - Number(b.branch_id || b.id || 0)
      );
      if (currentRole === 'admin') {
        const scopedIds = sortedRows
          .map((branch) => Number(branch.branch_id || branch.id || 0))
          .filter((id) => Number.isInteger(id) && id > 0);
        if (scopedIds.length) {
          localStorage.setItem('adminBranchIds', scopedIds.join(','));
        }
      }
      const displayMap = {};
      const nameMap = {};
      sortedRows.forEach((branch, index) => {
        const id = Number(branch.branch_id || branch.id || 0);
        if (!Number.isInteger(id) || id <= 0) return;
        displayMap[String(id)] = index + 1;
        nameMap[String(id)] = branch.name || `Branch ${index + 1}`;
      });
      localStorage.setItem('branchDisplayMap', JSON.stringify(displayMap));
      localStorage.setItem('branchNameMap', JSON.stringify(nameMap));

      const rawScope = localStorage.getItem('branchId');
      const scopeInitialized = localStorage.getItem('branchScopeInitialized') === 'true';
      if (currentRole === 'admin' && sortedRows.length > 1 && !scopeInitialized) {
        localStorage.setItem('branchScopeInitialized', 'true');
        localStorage.setItem('branchId', 'all');
        setSelectedBranchId('all');
        return;
      }
      if (!scopeInitialized) {
        localStorage.setItem('branchScopeInitialized', 'true');
      }

      if (currentRole === 'admin' && rawScope === 'all') {
        setSelectedBranchId('all');
        return;
      }

      const current = Number(rawScope || selectedBranchId);
      const exists = safeRows.some((row) => Number(row.branch_id || row.id) === current);
      if (!exists) {
        const firstId = Number(sortedRows[0]?.branch_id || sortedRows[0]?.id || 1);
        setSelectedBranchId(firstId);
        localStorage.setItem('branchId', String(firstId));
      } else if (current !== Number(selectedBranchId)) {
        setSelectedBranchId(current);
      }
    } catch (_) {
      // Keep existing state on refresh failures.
    }
  }, [currentRole, selectedBranchId]);

  const loadAdminSwitchPin = useCallback(async () => {
    try {
      const data = await getBusinessSettings();
      const nextPin = sanitizePin(data?.admin_switch_pin || DEFAULT_ADMIN_SWITCH_PIN);
      const effectivePin = nextPin.length === 4 ? nextPin : DEFAULT_ADMIN_SWITCH_PIN;
      setAdminSwitchPin(effectivePin);
      localStorage.setItem('adminSwitchPin', effectivePin);
    } catch (_) {
      const fallbackPin = sanitizePin(localStorage.getItem('adminSwitchPin') || DEFAULT_ADMIN_SWITCH_PIN);
      setAdminSwitchPin(fallbackPin.length === 4 ? fallbackPin : DEFAULT_ADMIN_SWITCH_PIN);
    }
  }, []);

  useEffect(() => {
    refreshBranches();
  }, [refreshBranches]);

  useEffect(() => {
    loadAdminSwitchPin();
  }, [loadAdminSwitchPin]);

  useEffect(() => {
    const handleBranchesUpdated = () => {
      refreshBranches();
      loadAdminSwitchPin();
    };
    const handleStorage = (event) => {
      if (!event.key || event.key === 'branchId' || event.key === 'adminBranchIds') {
        const next = getStoredBranchScope();
        setSelectedBranchId((prev) => (prev === next ? prev : next));
        refreshBranches();
      }
      if (!event.key || event.key === 'userRole') {
        setCurrentRole(getStoredRole());
      }
      if (!event.key || event.key === 'adminSwitchPin') {
        const nextPin = sanitizePin(localStorage.getItem('adminSwitchPin') || DEFAULT_ADMIN_SWITCH_PIN);
        if (nextPin.length === 4) {
          setAdminSwitchPin(nextPin);
        }
      }
    };

    window.addEventListener('branches-updated', handleBranchesUpdated);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('branches-updated', handleBranchesUpdated);
      window.removeEventListener('storage', handleStorage);
    };
  }, [refreshBranches, loadAdminSwitchPin]);

  const selectedBranch = useMemo(() => {
    if (selectedBranchId === 'all') return null;
    return branches.find((row) => Number(row.branch_id || row.id) === Number(selectedBranchId)) || null;
  }, [branches, selectedBranchId]);

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
      if (id > 0) map[id] = index + 1;
    });
    return map;
  }, [sortedBranches]);

  useEffect(() => {
    const nextTimezone =
      selectedBranch?.timezone ||
      sortedBranches[0]?.timezone ||
      localStorage.getItem('userTimezone') ||
      DEFAULT_TIMEZONE;
    localStorage.setItem('userTimezone', nextTimezone);
  }, [selectedBranch, sortedBranches]);

  const onBranchChange = (event) => {
    const raw = String(event.target.value || '').trim();
    if (currentRole === 'admin' && raw === 'all') {
      setSelectedBranchId('all');
      localStorage.setItem('branchId', 'all');
      window.location.reload();
      return;
    }

    const nextBranchId = Number(raw);
    if (!Number.isInteger(nextBranchId) || nextBranchId <= 0) return;

    setSelectedBranchId(nextBranchId);
    localStorage.setItem('branchId', String(nextBranchId));

    if (currentRole === 'admin') {
      const currentIds = parseBranchIds(localStorage.getItem('adminBranchIds'));
      if (!currentIds.includes(nextBranchId)) {
        currentIds.push(nextBranchId);
        localStorage.setItem('adminBranchIds', currentIds.join(','));
      }
    }

    window.location.reload();
  };

  const closePinModal = () => {
    setShowPinModal(false);
    setPinValue('');
    setPinError('');
  };

  const switchToCashier = () => {
    if (localStorage.getItem('branchId') === 'all') {
      const fallbackBranchId = Number(sortedBranches[0]?.branch_id || sortedBranches[0]?.id || 1);
      setSelectedBranchId(fallbackBranchId);
      localStorage.setItem('branchId', String(fallbackBranchId));
    }
    localStorage.setItem('userRole', 'cashier');
    setCurrentRole('cashier');
    window.location.href = '/cashier';
  };

  const switchToAdmin = () => {
    if (sortedBranches.length > 1) {
      localStorage.setItem('branchId', 'all');
    }
    localStorage.setItem('userRole', 'admin');
    setCurrentRole('admin');
    closePinModal();
    window.location.href = '/home';
  };

  const onRoleSwitchClick = () => {
    if (currentRole === 'cashier') {
      setPinValue('');
      setPinError('');
      setShowPinModal(true);
      return;
    }
    switchToCashier();
  };

  const appendPinDigit = (digit) => {
    setPinValue((prev) => {
      if (prev.length >= 4) return prev;
      return `${prev}${digit}`;
    });
    setPinError('');
  };

  const removePinDigit = () => {
    setPinValue((prev) => prev.slice(0, -1));
    setPinError('');
  };

  const onPinSubmit = () => {
    if (pinValue.length !== 4) {
      setPinError('Enter 4-digit PIN');
      return;
    }
    if (pinValue !== adminSwitchPin) {
      setPinError('Incorrect PIN');
      return;
    }
    switchToAdmin();
  };

  const switchLabel = currentRole === 'cashier' ? 'Switch to Admin' : 'Switch to Cashier';

  return (
    <>
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200">
        <div className="flex items-center gap-4 px-6 py-4">
          <div className="flex items-center gap-2 text-xs text-slate-600 bg-slate-100 px-3 py-1.5 rounded-full">
            Timezone | {selectedBranch?.timezone || localStorage.getItem('userTimezone') || DEFAULT_TIMEZONE}
          </div>

          <div className="flex-1 flex items-center justify-center">
            <div className="w-full max-w-md">
              <select
                value={String(selectedBranchId)}
                onChange={onBranchChange}
                className="w-full border border-slate-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brandYellow bg-white"
              >
                {currentRole === 'admin' && sortedBranches.length > 1 && (
                  <option value="all">All Branches (Total Restaurant)</option>
                )}
                {sortedBranches.length === 0 ? (
                  <option value={String(selectedBranchId)}>Branch 1</option>
                ) : (
                  sortedBranches.map((branch) => {
                    const id = Number(branch.branch_id || branch.id || 0);
                    return (
                      <option key={id} value={String(id)}>
                        {branch.name} (Branch {branchDisplayOrder[id] || 1})
                      </option>
                    );
                  })
                )}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onRoleSwitchClick}
              className="rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-sm font-medium text-slate-700 hover:border-brandYellow hover:bg-brandYellow/10"
            >
              {switchLabel}
            </button>
            <Logo size={28} showText={false} />
          </div>
        </div>
      </header>

      {showPinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 px-4">
          <div className="w-full max-w-xs rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-slate-900">Switch to Admin</h3>
              <p className="mt-1 text-xs text-slate-500">Enter your 4-digit PIN</p>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  className="h-9 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-lg"
                >
                  {pinValue[idx] ? '•' : ''}
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((key) => (
                <button
                  key={key || 'blank'}
                  type="button"
                  onClick={() => {
                    if (!key) return;
                    if (key === '⌫') {
                      removePinDigit();
                      return;
                    }
                    appendPinDigit(key);
                  }}
                  disabled={!key}
                  className={`h-10 rounded-lg border text-sm font-medium ${
                    key
                      ? 'border-slate-200 bg-white hover:border-brandYellow hover:bg-brandYellow/10'
                      : 'border-transparent bg-transparent'
                  }`}
                >
                  {key}
                </button>
              ))}
            </div>

            {pinError && <div className="mt-2 text-center text-xs text-rose-600">{pinError}</div>}

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={closePinModal}
                className="h-10 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onPinSubmit}
                className="h-10 rounded-lg bg-brandYellow text-sm font-semibold text-slate-900 hover:bg-brandYellowDark"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Topbar;
