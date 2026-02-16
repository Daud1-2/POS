import React from 'react';

const formatMoney = (value) => `PKR ${Number(value || 0).toLocaleString()}`;

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const ONLINE_SEQUENCE = {
  new: ['accepted', 'rejected'],
  accepted: ['completed', 'rejected'],
  preparing: ['completed', 'rejected'],
  ready: ['completed', 'rejected'],
};

const toActionLabel = (status) => {
  if (status === 'completed') return 'Mark as Completed';
  if (status === 'accepted') return 'Confirm';
  if (status === 'cancelled') return 'Cancel';
  if (status === 'rejected') return 'Reject';
  return status.charAt(0).toUpperCase() + status.slice(1);
};

function OrderManagementPanel({
  panelMode,
  readOnly = false,
  fullPage = false,
  searchValue,
  onSearchChange,
  orders,
  loading,
  error,
  onRefresh,
  onReprint,
  onUpdateStatus,
  canManageStatus,
  statusActionBusyId,
}) {
  const queueHeightClass = fullPage ? 'max-h-[68vh]' : 'max-h-72';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-slate-900">
          {panelMode === 'online' ? 'Online Queue' : panelMode === 'completed' ? 'Mark as Completed' : 'POS Orders'}
        </h3>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-brandYellow"
        >
          Refresh
        </button>
      </div>

      <input
        value={searchValue}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search order number"
        className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
      />

      {error && <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-xs text-rose-700">{error}</p>}

      <div className={`mt-3 ${queueHeightClass} space-y-2 overflow-y-auto pr-1`}>
        {loading && orders.length === 0 ? (
          <p className="text-sm text-slate-500">Loading orders...</p>
        ) : orders.length === 0 ? (
          <div className="min-h-[180px]" />
        ) : (
          orders.map((order) => {
            const onlineActions = ONLINE_SEQUENCE[order.status] || [];
            const posActions = order.status === 'pending' ? ['completed', 'cancelled'] : [];
            const completionActions = order.status === 'pending' ? ['completed'] : [];
            const showCompletionCancelIcon = !readOnly && panelMode === 'completed' && order.status === 'pending';
            const actions = readOnly
              ? []
              : panelMode === 'online'
                ? onlineActions
                : panelMode === 'completed'
                  ? completionActions
                  : posActions;

            return (
              <div key={order.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{order.order_number || '-'}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium capitalize text-slate-600">{order.status || '-'}</span>
                    {showCompletionCancelIcon && (
                      <button
                        type="button"
                        onClick={() => onUpdateStatus(order, 'cancelled')}
                        disabled={statusActionBusyId === order.id}
                        title="Cancel order"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-rose-300 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <span aria-hidden="true">X</span>
                        <span className="sr-only">Cancel order</span>
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  {formatDateTime(order.created_at)} | {order.payment_method || '-'} | {formatMoney(order.total)}
                </p>
                <p className="text-[11px] uppercase tracking-wide text-slate-500 mt-1">{order.order_channel || '-'}</p>
                {!readOnly && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => onReprint(order)}
                      className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-brandYellow"
                    >
                      Reprint
                    </button>
                    {actions.map((nextStatus) => (
                      <button
                        key={`${order.id}-${nextStatus}`}
                        type="button"
                        onClick={() => onUpdateStatus(order, nextStatus)}
                        disabled={statusActionBusyId === order.id}
                        className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-brandYellow disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {toActionLabel(nextStatus)}
                      </button>
                    ))}
                    {canManageStatus && order.status === 'completed' && (
                      <button
                        type="button"
                        onClick={() => onUpdateStatus(order, 'refunded')}
                        disabled={statusActionBusyId === order.id}
                        className="rounded-md border border-rose-300 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Refund
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export default OrderManagementPanel;
