# Orderly POS Master TODO (Data Authority + Orders Module)

## Objective
Make the POS admin dashboard fully data-driven from PostgreSQL with 15-second polling and strict backend authority rules.

## Non-Negotiable Data Authority Rule
- [x] Every dashboard metric comes from PostgreSQL backend queries.
- [x] No hard-coded numbers in frontend.
- [x] No financial or KPI calculation in frontend.
- [x] No chart-overlay-derived values.
- [x] `orders` table is the single source of truth for order-level metrics.

## Canonical Data Sources (Where data must come from)
### Dashboard Summary
- Source: `orders`
- Filters: `status`, date window, `outlet_id`, `deleted_at IS NULL`
- Fields produced by backend:
  - `total_sales`
  - `total_orders`
  - `avg_order_value`
  - `highest_order_value`
  - `new_vs_old` (nullable if no customer history)

### Order Trend
- Source: `orders`
- Filters: date range + `outlet_id` + `deleted_at IS NULL`
- Series:
  - total orders/sales
  - website-only series from `source = 'website'` query (server-side only)

### Rejected Trend
- Source: `orders`
- Filter: `status = 'rejected'` + date + `outlet_id`

### Top Products / Trending Items
- Source: `order_items` joined with `orders`
- Filter: completed orders + date + `outlet_id`

### Channel Contribution (Delivery/Dine-in/Takeaway)
- Source: `orders`
- Group by: `order_type`
- Percentages computed in backend response

### Payment Type
- Source: `orders`
- Group by: `payment_method`
- Percentages computed in backend response

### Live Orders
- Source: `orders`
- Filter:
  - `status IN ('open','preparing','ready','out_for_delivery')`
  - `(scheduled_for IS NULL OR scheduled_for <= NOW())`
  - `deleted_at IS NULL`

### Pre Orders
- Source: `orders`
- Filter:
  - `scheduled_for > NOW()`
  - `status NOT IN ('cancelled','refunded')`
  - `deleted_at IS NULL`

### Call/Phone Orders
- Source: `orders`
- Filter:
  - `source = 'phone'`
  - `deleted_at IS NULL`

### Order Reviews
- Source: `order_reviews` joined with `orders`
- Returns: list + `average_rating` + `total_reviews`

## Database Tasks
- [x] Confirm `orders` has all required fields:
  - `id`, `order_number`, `source`, `order_type`, `status`
  - `scheduled_for`, `subtotal`, `tax`, `discount`, `total`
  - `payment_status`, `payment_method`
  - `customer_id`, `outlet_id`
  - `external_order_id`, `external_source`, `metadata`
  - `created_at`, `updated_at`, `completed_at`, `deleted_at`
- [x] Confirm `order_items` exists with FK to `orders`.
- [x] Create `order_reviews` table with FK to `orders`.
- [x] Create `order_status_history` table for status audit logs.
- [x] Enforce money columns as `numeric(12,2)`.
- [x] Add/verify indexes:
  - `orders(status, created_at)`
  - `orders(source, created_at)`
  - `orders(outlet_id, created_at)`
  - `orders(scheduled_for)`
  - `order_items(order_id)`
  - `order_items(product_id)`

## API Tasks (Read-only dashboard)
- [x] `GET /api/dashboard/summary?range=day|month&outlet_id=...`
- [x] `GET /api/dashboard/sales-trend?range=day|month&outlet_id=...`
- [x] `GET /api/dashboard/rejected-trend?range=day|month&outlet_id=...`
- [x] `GET /api/dashboard/top-products?range=month&outlet_id=...`
- [x] `GET /api/dashboard/channel-contribution?range=month&outlet_id=...`
- [x] `GET /api/dashboard/payment-type?range=month&outlet_id=...`
- [x] `GET /api/orders/live?outlet_id=...`
- [x] `GET /api/orders/pre?outlet_id=...`
- [x] `GET /api/orders/phone?outlet_id=...`
- [x] `GET /api/orders/reviews/summary?outlet_id=...`

## Write Path Tasks
- [x] `POST /api/orders` supports `source = pos|website|phone|kiosk`.
- [x] Server validates totals and writes `orders` + `order_items` in one transaction.
- [x] Website integration will call same endpoint with `source = 'website'`.
- [x] No frontend-created metrics.

## Polling Tasks
- [x] Poll every 15s:
  - summary
  - live orders
  - pre orders
  - phone orders
  - reviews summary
- [x] Poll every 30-60s:
  - trends
  - top products
  - channel contribution
  - payment type

## Security and Access Control
- [x] Enforce `WHERE outlet_id = current_user.outlet_id` at query level.
- [x] Role model:
  - cashier: limited
  - manager: full outlet
  - admin: multi-outlet
- [x] Soft delete only (`deleted_at`), no hard delete for orders.

## UI Cleanup Tasks
- [x] Remove any placeholder seed display when no DB data exists.
- [x] Keep only `Day` and `Month` toggles where requested.
- [x] Ensure chart labels do not clip and pie stays perfectly circular.
- [x] Keep dashboard cards/charts bound to API responses only.

## Test and Validation
- [ ] Empty DB test: all widgets show zero/empty states (no fake Cola/Water rows).
- [ ] Source test: website metrics only from `source = 'website'`.
- [x] Outlet isolation test: no cross-outlet leak.
- [ ] Trend window test: day/month range correctness.
- [ ] Payment/channel percentages sum to 100% (or 0 with no data).
- [x] API response schema checks for each endpoint.

## Definition of Done
- [x] No hard-coded dashboard values remain.
- [x] All charts/tables/cards are backend-driven.
- [ ] Polling runs without console/API errors.
- [x] Orders from POS, website, and phone appear correctly by source filters.
- [ ] Dashboard metrics match direct SQL verification queries.
