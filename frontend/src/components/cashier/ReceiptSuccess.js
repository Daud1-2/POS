import React from 'react';

const formatMoney = (value) => `PKR ${Number(value || 0).toLocaleString()}`;

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const paymentLabel = (method) => {
  if (method === 'cash') return 'Cash';
  if (method === 'card') return 'Card';
  if (method === 'online') return 'Online';
  return method || '-';
};

const orderTypeLabel = (orderType) => {
  if (orderType === 'dine_in') return 'Dine In';
  if (orderType === 'takeaway') return 'Takeaway';
  if (orderType === 'delivery') return 'Delivery';
  return orderType || '-';
};

function ReceiptSuccess({ receipt, branchLabel, onPrint, onNewOrder }) {
  const items = Array.isArray(receipt?.items) ? receipt.items : [];
  const status = String(receipt?.status || '').toLowerCase();
  const isPending = status === 'pending';
  const title = isPending ? 'Order Confirmed' : 'Order Successful';
  const subtitle = isPending
    ? `Order ${receipt?.order_number || '-'} has been sent to pending.`
    : `Order ${receipt?.order_number || '-'} has been completed.`;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="text-sm">{subtitle}</p>
      </div>

      <section id="cashier-receipt-print" className="cashier-print-root rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Invoice</h2>
            <p className="text-sm text-slate-500">{branchLabel}</p>
          </div>
          <div className="text-right text-sm text-slate-600">
            <p className="font-medium text-slate-800">{receipt?.order_number || '-'}</p>
            <p>{formatDateTime(receipt?.created_at)}</p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 text-sm text-slate-700 md:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Order Type</p>
            <p className="font-medium">{orderTypeLabel(receipt?.order_type)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Payment</p>
            <p className="font-medium">{paymentLabel(receipt?.payment_method)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
            <p className="font-medium capitalize">{receipt?.status || '-'}</p>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 text-slate-700">
              <tr>
                <th className="px-2 py-2 text-left">Item</th>
                <th className="px-2 py-2 text-right">Qty</th>
                <th className="px-2 py-2 text-right">Unit</th>
                <th className="px-2 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-4 text-center text-slate-500">
                    No item lines available
                  </td>
                </tr>
              ) : (
                items.map((item, index) => (
                  <tr key={`${item.product_id}-${index}`} className="border-b border-slate-100">
                    <td className="px-2 py-2">{item.product_name || `Item ${index + 1}`}</td>
                    <td className="px-2 py-2 text-right">{Number(item.quantity || 0)}</td>
                    <td className="px-2 py-2 text-right">{formatMoney(item.unit_price)}</td>
                    <td className="px-2 py-2 text-right">{formatMoney(item.total_price)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 ml-auto max-w-xs space-y-1 border-t border-slate-200 pt-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-600">Subtotal</span>
            <span className="font-medium">{formatMoney(receipt?.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Discount</span>
            <span className="font-medium">-{formatMoney(receipt?.discount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Tax</span>
            <span className="font-medium">{formatMoney(receipt?.tax)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2">
            <span className="font-semibold text-slate-800">Total</span>
            <span className="text-lg font-semibold text-slate-900">{formatMoney(receipt?.total)}</span>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onPrint}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Print
        </button>
        <button
          type="button"
          onClick={onNewOrder}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-brandYellow"
        >
          New Order
        </button>
      </div>
    </div>
  );
}

export default ReceiptSuccess;
