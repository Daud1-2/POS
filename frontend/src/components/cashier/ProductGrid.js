import React, { useState } from 'react';

const formatMoney = (value) => `PKR ${Number(value || 0).toLocaleString()}`;

function ProductCard({ item, onAddItem, cartQuantity = 0 }) {
  const [imageBroken, setImageBroken] = useState(false);
  const effectiveStock =
    item?.effective_stock === null || item?.effective_stock === undefined
      ? null
      : Number(item.effective_stock);
  const remainingStock = effectiveStock === null ? null : Math.max(0, effectiveStock - Number(cartQuantity || 0));
  const outOfStock = remainingStock !== null && remainingStock <= 0;
  const unavailable = item?.is_available === false || outOfStock;
  const stockLabel = outOfStock ? 'Out of stock' : remainingStock === null ? 'In stock' : `Stock ${remainingStock}`;

  return (
    <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-soft">
      <div className="relative h-36 bg-slate-100">
        {item?.image_url && !imageBroken ? (
          <img
            src={item.image_url}
            alt={item.name}
            className="h-full w-full object-cover"
            onError={() => setImageBroken(true)}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-medium text-slate-400">
            No Image
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-md bg-white/90 px-2 py-0.5 text-[11px] font-medium text-slate-700">
          {stockLabel}
        </span>
      </div>

      <div className="space-y-2 p-3">
        <div>
          <h3 className="truncate text-sm font-semibold text-slate-900">{item.name}</h3>
          <p className="truncate text-xs text-slate-500">{item.sku || item.section_name || 'Product item'}</p>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-900">{formatMoney(item.effective_price)}</span>
          <button
            type="button"
            disabled={unavailable}
            onClick={() => onAddItem(item)}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {unavailable ? 'Unavailable' : 'Add'}
          </button>
        </div>
      </div>
    </article>
  );
}

function ProductGrid({
  items,
  loading,
  error,
  onRetry,
  onAddItem,
  cartQuantityByProduct,
  hasMore,
  loadingMore,
  onLoadMore,
}) {
  if (loading && !items.length) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-soft">
        Loading products...
      </div>
    );
  }

  return (
    <section className="space-y-3">
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-medium"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {!items.length && !loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500 shadow-soft">
          No products found for current filters.
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {items.map((item) => (
              <ProductCard
                key={item.product_uid}
                item={item}
                onAddItem={onAddItem}
                cartQuantity={Number(cartQuantityByProduct?.[item.id] || 0)}
              />
            ))}
          </div>
          {hasMore && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={onLoadMore}
                disabled={loadingMore}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:border-brandYellow disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loadingMore ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default ProductGrid;
