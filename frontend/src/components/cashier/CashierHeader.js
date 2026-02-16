import React from 'react';

const formatDate = (value) =>
  new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(value);

const formatTime = (value) =>
  new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value);

function CashierHeader({
  now,
  branchName,
  branchLabel,
  orderMode,
  onOrderModeChange,
  orderType,
  onOrderTypeChange,
  onSwitchToAdmin,
  showOrderTypeControls = true,
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Purchase Items</h1>
          <p className="text-sm text-slate-500">{branchName || branchLabel}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-medium text-slate-700">{formatDate(now)}</p>
          <p className="text-xs text-slate-500">{formatTime(now)}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Panel</span>
        <button
          type="button"
          onClick={() => onOrderModeChange('pos')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            orderMode === 'pos'
              ? 'bg-brandYellow text-ink'
              : 'border border-slate-200 bg-white text-slate-700 hover:border-brandYellow'
          }`}
        >
          POS Orders
        </button>
        <button
          type="button"
          onClick={() => onOrderModeChange('online')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            orderMode === 'online'
              ? 'bg-brandYellow text-ink'
              : 'border border-slate-200 bg-white text-slate-700 hover:border-brandYellow'
          }`}
        >
          Online Orders
        </button>
        <button
          type="button"
          onClick={() => onOrderModeChange('completed')}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            orderMode === 'completed'
              ? 'bg-brandYellow text-ink'
              : 'border border-slate-200 bg-white text-slate-700 hover:border-brandYellow'
          }`}
        >
          Mark as Completed
        </button>

        {showOrderTypeControls && (
          <>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Order Type</span>
            <button
              type="button"
              onClick={() => onOrderTypeChange('dine_in')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                orderType === 'dine_in'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:border-brandYellow'
              }`}
            >
              Dine In
            </button>
            <button
              type="button"
              onClick={() => onOrderTypeChange('takeaway')}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                orderType === 'takeaway'
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-200 bg-white text-slate-700 hover:border-brandYellow'
              }`}
            >
              Takeaway
            </button>
          </>
        )}
        <div className="ml-auto">
          <button
            type="button"
            onClick={onSwitchToAdmin}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-brandYellow hover:bg-brandYellow/10"
          >
            Switch to Admin
          </button>
        </div>
      </div>
    </div>
  );
}

export default CashierHeader;
