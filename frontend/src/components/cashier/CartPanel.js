import React from 'react';
import PromoRow from './PromoRow';

const formatMoney = (value) => `PKR ${Number(value || 0).toLocaleString()}`;

function CartPanel({
  lines,
  localSubtotal,
  quote,
  quoteLoading,
  quoteError,
  paymentMethod,
  onPaymentMethodChange,
  onIncrementLine,
  onDecrementLine,
  onRemoveLine,
  onUpdateLineNote,
  promoInput,
  appliedPromoCode,
  onPromoInputChange,
  onApplyPromo,
  onRemovePromo,
  promoError,
  checkoutBusy,
  checkoutError,
  pendingOrder,
  onConfirmOrder,
  onMarkAsCompleted,
  manualDiscountEnabled,
  manualDiscountInput,
  onManualDiscountInputChange,
  onClearCart,
  onHoldOrder,
  heldOrders,
  onResumeHeldOrder,
  onDeleteHeldOrder,
  cashReceivedInput,
  onCashReceivedInputChange,
  changeDue,
  isCashInsufficient,
  onOpenCashDrawer,
  cashDrawerStatus,
  checkoutDisabled,
}) {
  const hasCartItems = lines.some((line) => Number(line.quantity || 0) > 0);
  const totalUnits = lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const subtotal = quote ? Number(quote.subtotal || 0) : localSubtotal;
  const tax = quote ? Number(quote.tax || 0) : 0;
  const discount = quote ? Number(quote.discount_total || 0) : 0;
  const total = quote ? Number(quote.final_total || 0) : Math.max(0, localSubtotal - discount + tax);
  const bulkDiscount = quote ? Number(quote.bulk_discount_total || 0) : 0;
  const promoDiscount = quote ? Number(quote.promo_discount_total || 0) : 0;
  const manualDiscount = manualDiscountEnabled ? Number(manualDiscountInput || 0) : 0;
  const payableTotal = Math.max(0, total - manualDiscount);
  const enteredCashDigits = String(cashReceivedInput || '').replace(/\D/g, '');
  const enteredCashValue = enteredCashDigits ? Number(enteredCashDigits) : 0;

  const appendCashDigit = (digit) => {
    const normalizedDigit = String(digit || '').replace(/\D/g, '');
    if (!normalizedDigit) return;
    const current = String(cashReceivedInput || '').replace(/\D/g, '');
    const base = current === '0' ? '' : current;
    const nextRaw = `${base}${normalizedDigit}`.slice(0, 9);
    const next = nextRaw.replace(/^0+(?=\d)/, '');
    onCashReceivedInputChange(next);
  };

  const deleteCashDigit = () => {
    const current = String(cashReceivedInput || '').replace(/\D/g, '');
    if (!current) return;
    const next = current.slice(0, -1);
    onCashReceivedInputChange(next);
  };

  return (
    <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-900">Open Order</h2>
        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
          {totalUnits} item{totalUnits === 1 ? '' : 's'}
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onClearCart}
          disabled={!hasCartItems}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brandYellow disabled:cursor-not-allowed disabled:opacity-60"
        >
          Clear Cart
        </button>
        <button
          type="button"
          onClick={onHoldOrder}
          disabled={!hasCartItems}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:border-brandYellow disabled:cursor-not-allowed disabled:opacity-60"
        >
          Hold Order
        </button>
      </div>

      {heldOrders.length > 0 && (
        <div className="mt-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Held Orders</p>
          <div className="space-y-1">
            {heldOrders.map((held) => (
              <div key={held.id} className="flex items-center gap-2 rounded-lg bg-white p-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-800">{held.label}</p>
                  <p className="text-[11px] text-slate-500">{held.summary}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onResumeHeldOrder(held.id)}
                  className="rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 hover:border-brandYellow"
                >
                  Resume
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteHeldOrder(held.id)}
                  className="rounded-md border border-rose-200 px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {!hasCartItems ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
            Add items from the menu to start an order.
          </div>
        ) : (
          lines.map((line) => {
            const lineId = line.line_id || line.product_id;
            const maxStock =
              line.effective_stock === null || line.effective_stock === undefined
                ? null
                : Number(line.effective_stock);
            const atMax = maxStock !== null && line.quantity >= maxStock;

            return (
              <div key={lineId} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{line.name}</p>
                    <p className="text-xs text-slate-500">{formatMoney(line.unit_price)} each</p>
                    {Array.isArray(line.addons) && line.addons.length > 0 && (
                      <p className="mt-1 text-[11px] text-slate-600">
                        {line.addons
                          .map((group) => {
                            const options = Array.isArray(group.options)
                              ? group.options.map((option) => option.label).filter(Boolean)
                              : [];
                            if (!options.length) return null;
                            return `${group.group_label || group.group_id}: ${options.join(', ')}`;
                          })
                          .filter(Boolean)
                          .join(' | ')}
                      </p>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-800">{formatMoney(line.line_total)}</p>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onRemoveLine(lineId)}
                    className="rounded-md border border-rose-200 px-2 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50"
                  >
                    Remove
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onDecrementLine(lineId)}
                      className="h-7 w-7 rounded-full border border-slate-200 text-sm text-slate-700 hover:border-brandYellow"
                    >
                      -
                    </button>
                    <span className="w-6 text-center text-sm font-medium">{line.quantity}</span>
                    <button
                      type="button"
                      onClick={() => onIncrementLine(lineId)}
                      disabled={atMax}
                      className="h-7 w-7 rounded-full border border-slate-200 text-sm text-slate-700 hover:border-brandYellow disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      +
                    </button>
                  </div>
                </div>
                <textarea
                  value={line.note || ''}
                  onChange={(event) => onUpdateLineNote(lineId, event.target.value)}
                  placeholder="Add note for this item"
                  className="mt-2 min-h-[56px] w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
                />
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4">
        <PromoRow
          promoInput={promoInput}
          appliedPromoCode={appliedPromoCode}
          onPromoInputChange={onPromoInputChange}
          onApplyPromo={onApplyPromo}
          onRemovePromo={onRemovePromo}
          busy={quoteLoading || checkoutBusy}
          error={promoError}
        />
      </div>

      {manualDiscountEnabled && (
        <div className="mt-4 rounded-xl border border-slate-200 p-3">
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Manual Discount</p>
          <input
            type="number"
            min="0"
            step="0.01"
            value={manualDiscountInput}
            onChange={(event) => onManualDiscountInputChange(event.target.value)}
            placeholder="0.00"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
        </div>
      )}

      <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-600">Subtotal</span>
          <span className="font-medium text-slate-900">{formatMoney(subtotal)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-600">Tax</span>
          <span className="font-medium text-slate-900">{formatMoney(tax)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-600">Discount</span>
          <span className="font-medium text-slate-900">-{formatMoney(discount)}</span>
        </div>
        {manualDiscountEnabled && manualDiscount > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-600">Manual Discount</span>
            <span className="font-medium text-slate-900">-{formatMoney(manualDiscount)}</span>
          </div>
        )}
        {(bulkDiscount > 0 || promoDiscount > 0) && (
          <div className="space-y-1 border-t border-slate-200 pt-2 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Bulk discount</span>
              <span>-{formatMoney(bulkDiscount)}</span>
            </div>
            <div className="flex justify-between">
              <span>Promo discount</span>
              <span>-{formatMoney(promoDiscount)}</span>
            </div>
          </div>
        )}
        <div className="flex justify-between border-t border-slate-200 pt-2">
          <span className="font-semibold text-slate-800">Total</span>
          <span className="text-lg font-semibold text-slate-900">{formatMoney(payableTotal)}</span>
        </div>
      </div>

      {quoteError && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {quoteError}. Checkout will continue with server-side totals.
        </p>
      )}

      <div className="mt-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Select Payment Method</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { key: 'cash', label: 'Cash' },
            { key: 'card', label: 'Card' },
          ].map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => onPaymentMethodChange(option.key)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                paymentMethod === option.key
                  ? 'border-slate-900 bg-slate-900 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-brandYellow'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {paymentMethod === 'cash' && (
        <div className="mt-4 space-y-2 rounded-xl border border-slate-200 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Cash Handling</p>
          <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-600">Cash received</span>
            <span className="font-semibold text-slate-900">{formatMoney(enteredCashValue)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'Del'].map((key) =>
              key ? (
                <button
                  key={key}
                  type="button"
                  onClick={() => (key === 'Del' ? deleteCashDigit() : appendCashDigit(key))}
                  className="rounded-xl border border-slate-200 bg-white py-3 text-xl font-medium text-slate-800 hover:border-brandYellow"
                >
                  {key}
                </button>
              ) : (
                <div key="blank-key" />
              )
            )}
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <span className="text-slate-600">Change</span>
            <span className="font-semibold text-slate-900">{formatMoney(changeDue)}</span>
          </div>
          {isCashInsufficient && (
            <p className="rounded-lg bg-rose-50 px-2 py-1.5 text-xs text-rose-700">Insufficient cash received.</p>
          )}
          <button
            type="button"
            onClick={onOpenCashDrawer}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:border-brandYellow"
          >
            Open Cash Drawer
          </button>
          {cashDrawerStatus && <p className="text-xs text-slate-600">{cashDrawerStatus}</p>}
        </div>
      )}

      {checkoutError && (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{checkoutError}</p>
      )}

      {pendingOrder && (
        <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
          Order {pendingOrder.order_number || ''} is pending. Mark as completed to finish.
        </p>
      )}

      <button
        type="button"
        onClick={pendingOrder ? () => onMarkAsCompleted(pendingOrder) : onConfirmOrder}
        disabled={checkoutDisabled}
        className="mt-4 w-full rounded-lg bg-brandYellow py-3 text-sm font-semibold text-ink transition hover:bg-brandYellowDark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {checkoutBusy ? 'Saving...' : pendingOrder ? 'Mark as Completed' : 'Confirm Order'}
      </button>
    </aside>
  );
}

export default CartPanel;
