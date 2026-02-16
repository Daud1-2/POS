import React from 'react';

function PromoRow({
  promoInput,
  appliedPromoCode,
  onPromoInputChange,
  onApplyPromo,
  onRemovePromo,
  busy,
  error,
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          value={promoInput}
          onChange={(event) => onPromoInputChange(event.target.value)}
          placeholder="Promo code"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        />
        {!appliedPromoCode ? (
          <button
            type="button"
            onClick={onApplyPromo}
            disabled={busy}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-brandYellow disabled:cursor-not-allowed disabled:opacity-60"
          >
            Apply
          </button>
        ) : (
          <button
            type="button"
            onClick={onRemovePromo}
            disabled={busy}
            className="rounded-lg border border-rose-200 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Remove
          </button>
        )}
      </div>
      {appliedPromoCode && (
        <p className="text-xs text-emerald-700">
          Promo applied: <span className="font-semibold">{appliedPromoCode}</span>
        </p>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

export default PromoRow;
