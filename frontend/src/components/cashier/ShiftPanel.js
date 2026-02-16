import React from 'react';

const formatMoney = (value) => `PKR ${Number(value || 0).toLocaleString()}`;

function ShiftPanel({
  activeShift,
  shiftLoading,
  shiftLockedForDay,
  shiftApiUnavailable,
  openingCashInput,
  closingCashInput,
  onOpeningCashChange,
  onClosingCashChange,
  onStartShift,
  onEndShift,
  shiftReport,
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
      <h3 className="text-base font-semibold text-slate-900">Shift Control</h3>
      {shiftApiUnavailable && (
        <p className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs text-amber-800">
          Shift API unavailable (404). Running local fallback mode.
        </p>
      )}

      {!activeShift ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">
            {shiftLockedForDay
              ? 'Opening cash is already recorded for today and cannot be changed.'
              : 'Start shift with opening cash amount.'}
          </p>
          <input
            type="number"
            min="0"
            step="0.01"
            value={openingCashInput}
            onChange={(event) => onOpeningCashChange(event.target.value)}
            placeholder="Opening cash"
            disabled={shiftLockedForDay || shiftLoading}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={onStartShift}
            disabled={shiftLockedForDay || shiftLoading}
            className="w-full rounded-lg bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {shiftLoading ? 'Saving...' : 'Start Shift'}
          </button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="rounded-lg bg-slate-50 p-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">Opening Cash</span>
              <span className="font-medium">{formatMoney(activeShift.opening_cash)}</span>
            </div>
          </div>
          <input
            type="number"
            min="0"
            step="0.01"
            value={closingCashInput}
            onChange={(event) => onClosingCashChange(event.target.value)}
            placeholder="Closing cash"
            disabled={shiftLoading}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={onEndShift}
            disabled={shiftLoading}
            className="w-full rounded-lg border border-rose-200 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {shiftLoading ? 'Saving...' : 'End Shift'}
          </button>
        </div>
      )}

      {shiftReport && (
        <div className="mt-3 rounded-lg border border-slate-200 p-3 text-xs text-slate-700">
          <p className="font-semibold text-slate-800">Last Shift Report</p>
          <p>Status: {shiftReport.status}</p>
          <p>Closing Cash: {formatMoney(shiftReport.closing_cash)}</p>
          <p>Difference: {formatMoney(shiftReport.difference)}</p>
          <p>Result: {shiftReport.reconciliation_status}</p>
          <p className="text-slate-500">{new Date(shiftReport.end_time).toLocaleString()}</p>
        </div>
      )}
    </section>
  );
}

export default ShiftPanel;
