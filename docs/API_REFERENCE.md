# POS Backend API Reference

Last updated: 2026-02-13

This document is the developer-facing API reference for the backend in this repo.
Source of truth for active APIs is `backend/src/app.js`.

## Base URL

- Local: `http://localhost:5000`
- API prefix: `/api`

## Auth, Role, and Outlet Scope

- Public routes:
  - `GET /api/health`
  - `GET /api/health/db`
  - `/api/auth/*` (placeholder routes)
- Protected route groups use both middleware:
  - `authClaims` (`backend/src/middleware/authClaims.js`)
  - `outletScope` (`backend/src/middleware/outletScope.js`)

### JWT claims contract (protected routes)

- `sub`: user id (string)
- `role`: `cashier | manager | admin`
- `outlet_id`: required for `cashier` and `manager`
- `outlet_ids`: required for `admin` (array)
- `timezone`: optional, defaults to `UTC`

### Outlet behavior

- `cashier/manager`:
  - always scoped to token `outlet_id`
  - if query has `outlet_id` and it differs, request is rejected (`403`)
- `admin`:
  - must pass `outlet_id` in query
  - requested outlet must exist in token `outlet_ids`

## Common response shapes

Standard object:

```json
{ "data": {} }
```

Paginated object:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "page_size": 25,
    "total": 0,
    "total_pages": 0
  }
}
```

Error:

```json
{ "error": "message" }
```

## Health (public)

- `GET /api/health`
- `GET /api/health/db`

## Auth (public placeholders)

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/register`

Note: these are currently placeholder endpoints.

## Products (`/api/products`)

### Read endpoints

- `GET /api/products`
  - Compatibility POS list (active + available products for effective outlet).
- `GET /api/products/items`
  - Query:
    - `section_id` (uuid, optional)
    - `search` (name/sku)
    - `page`, `page_size` (default `1`, `25`, max `100`)
    - `include_inactive` (manager/admin only)
    - `include_unavailable` (manager/admin only)
  - Returns product rows with effective outlet price/stock and primary image.
- `GET /api/products/sections`
  - Returns global + outlet sections sorted by `display_order`.
- `GET /api/products/items/:product_uid/images`
- `GET /api/products/items/:product_uid/outlets`
  - Role: `manager/admin`
  - Query: `outlet_id` optional; defaults to effective outlet.
- `GET /api/products/:id`
  - Legacy numeric-id product read.

### Write endpoints

- `POST /api/products/items` (`manager/admin`)
  - Body keys:
    - `name` (required)
    - `sku` (required)
    - `description`, `barcode`
    - `base_price` (or `price`) required
    - `cost_price`, `tax_rate`
    - `section_id` (uuid, optional)
    - `is_active`, `track_inventory`
    - `stock_quantity` (or `stock`)
- `PATCH /api/products/items/:product_uid` (`manager/admin`)
  - Partial update of same fields.
- `PATCH /api/products/items/:product_uid/active` (`manager/admin`)
  - Body: `{ "is_active": true|false }`
- `DELETE /api/products/items/:product_uid` (`manager/admin`)
  - Soft delete.

### Sections write endpoints

- `POST /api/products/sections` (`admin`)
  - Body: `name` required, optional `description`, `display_order`, `is_active`, `outlet_id`.
- `PATCH /api/products/sections/:section_id` (`admin`)
  - Partial body for section fields.
- `PATCH /api/products/sections/reorder` (`admin`)
  - Body:
    ```json
    {
      "items": [
        { "id": "section-uuid", "display_order": 0 }
      ]
    }
    ```
- `DELETE /api/products/sections/:section_id` (`admin`)
  - Soft delete.

### Images write endpoints

- `POST /api/products/items/:product_uid/images` (`manager/admin`)
  - Body: `image_url` required, optional `display_order`, `is_primary`.
  - `image_url` max length: `5000`.
- `POST /api/products/items/:product_uid/images/upload` (`manager/admin`)
  - Multipart field: `image`
  - Optional form fields: `display_order`, `is_primary`
  - Upload limit: `500KB`
  - Stores generated URL in DB, not binary data.
- `PATCH /api/products/items/:product_uid/images/:image_id` (`manager/admin`)
  - Partial body: `image_url`, `display_order`, `is_primary`.
- `DELETE /api/products/items/:product_uid/images/:image_id` (`manager/admin`)
  - Soft delete.

### Outlet settings write endpoint

- `PUT /api/products/items/:product_uid/outlets/:outlet_id` (`manager/admin`)
  - Body keys:
    - `is_available` (bool)
    - `price_override` (numeric or null)
    - `stock_override` (non-negative integer or null)

### Legacy compatibility writes

- `POST /api/products` (`manager/admin`)
  - Body: legacy fields `name`, `sku`, `price`, `stock`, optional `isActive`, `section_id`.
- `PUT /api/products/:id` (`manager/admin`)
  - Legacy update via numeric id.
- `DELETE /api/products/:id` (`manager/admin`)
  - Legacy soft delete via numeric id.

## Sales Compatibility (`/api/sales`)

- `GET /api/sales`
  - Recent orders for effective outlet (limit 100).
- `POST /api/sales`
  - Compatibility order create route (internally calls canonical order service).
  - Required: `cashierId`
  - Common body keys:
    - `items[]`, `paymentMethod`, `paymentStatus`, `orderType`, `status`, `tax`, `promoCode`
    - `source` (`app` is mapped to `kiosk`)
    - customer legacy keys: `customerId`, `customerName`, `customerPhone`, `customerEmail`, `customerType`
- `GET /api/sales/report`
  - Completed-order aggregate totals for effective outlet.

## Dashboard (`/api/dashboard`)

All endpoints are outlet-scoped, completed-order based where applicable, and soft-delete aware.

Common query:

- `range=day|month`
  - Invalid values fall back to route default.

Endpoints:

- `GET /api/dashboard/summary`
  - Default range: `day`
  - Returns KPIs including web-only metrics and `new_vs_old` if customer data exists.
- `GET /api/dashboard/sales-trend`
  - Default range: `month`
- `GET /api/dashboard/rejected-trend`
  - Default range: `month`
  - Includes server-side `loss_of_business`.
- `GET /api/dashboard/heatmap`
  - Default range: `month`
- `GET /api/dashboard/top-products`
  - Query: `range`, `limit` (default 10, max 50)
- `GET /api/dashboard/channel-contribution`
  - Default range: `month`
  - Returns server-calculated percentages.
- `GET /api/dashboard/payment-type`
  - Default range: `month`
  - Returns server-calculated percentages.

## Reporting BI (`/api/reporting`)

Protected with `authClaims + reportingScope`.

Common query keys:
- `date_from`, `date_to` (ISO date/time)
- `timezone` optional (fallback from token/user)
- `bucket=hour|day|week|month` (trend endpoints)

Single-outlet endpoints require `outlet_id` for admin users.

- `GET /api/reporting/revenue/overview`
- `GET /api/reporting/revenue/trend`
- `GET /api/reporting/payments/overview`
- `GET /api/reporting/payments/trend`
- `GET /api/reporting/discounts/overview`
- `GET /api/reporting/discounts/deals`
- `GET /api/reporting/products/intelligence`
- `GET /api/reporting/time/analysis`

Branch comparison:
- `GET /api/reporting/branches/compare` (admin only)
  - Requires `outlet_ids` as CSV (for example: `outlet_ids=1,2,3`)
  - Role rules:
    - `admin`: outlets must be subset of token `outlet_ids`
    - `cashier/manager`: denied

## Orders (`/api/orders`)

### `POST /api/orders`

Creates an order transactionally (order, order_items, status history, promo usage, inventory deduction if completed).

Common body keys:

- `items` (required array)
  - each item: `product_id`, `quantity`, optional `modifiers`
- `source`: `pos|website|phone|kiosk` (default `pos`)
- `order_type`: `dine_in|takeaway|delivery` (default `takeaway`)
- `status`: `open|preparing|ready|out_for_delivery|completed|cancelled|refunded` (default `open`)
- `payment_method`: `cash|card|online` (accepts `credit` and maps to `card`)
- `payment_status`: `unpaid|paid|partially_paid`
- `tax`, optional `subtotal` and `total` (if provided, validated against server computation)
- `scheduled_for`, `completed_at`
- customer fields:
  - `customer_id`
  - `customer` object with optional `id`, `name`, `phone`, `email`, `type`
  - snapshot override fields: `customer_name_snapshot`, `customer_phone_snapshot`, `customer_email_snapshot`
- outlet and metadata fields:
  - `outlet_id` (middleware-scoped)
  - `order_number` (optional)
  - `external_order_id`, `external_source`
  - `promo_code`
  - `metadata`

### `PATCH /api/orders/:order_id/status`

- Body:
  - `status` required
  - optional `payment_status`, `reason`, `metadata`
- Rules:
  - completed orders cannot move back to another status
  - entering `completed` triggers inventory deduction once

### List endpoints

All are paginated with `page` and `page_size` (default `1`/`25`, max `100`):

- `GET /api/orders/live`
  - `status IN ('open','preparing','ready','out_for_delivery')`
  - `(scheduled_for IS NULL OR scheduled_for <= now())`
- `GET /api/orders/pre`
  - `scheduled_for > now()` and status not cancelled/refunded
- `GET /api/orders/phone`
  - `source='phone'`
- `GET /api/orders/reviews/summary`
  - Returns paginated review rows plus:
    - `summary.average_rating`
    - `summary.total_reviews`

## Discounts (`/api/discounts`)

### Promo codes

- `GET /api/discounts/promo-codes`
  - Query:
    - pagination: `page`, `page_size`
    - filters: `search`, `status`, `active_now`, `expired`, `upcoming`
- `POST /api/discounts/promo-codes` (`manager/admin`)
- `PATCH /api/discounts/promo-codes/:uuid` (`manager/admin`)
- `PATCH /api/discounts/promo-codes/:uuid/toggle` (`manager/admin`)
- `DELETE /api/discounts/promo-codes/:uuid` (`manager/admin`, soft delete)
- `POST /api/discounts/promo-codes/validate`
  - Body:
    - `promo_code` (or `promoCode` or `code`)
    - `source`
    - `customer_id` / `customerId`
    - `amount_before_promo` / `subtotal`

Promo payload keys for create/update:

- `code`, `name`
- `applicable_on`: `app|web|both`
- `discount_type`: `percentage|fixed`
- `discount_value`
- `min_order_amount`, `max_discount_amount`
- `usage_limit`, `used_count`, `per_user_limit`
- `start_time`, `end_time`
- `status`: `active|inactive`

### Bulk discounts

- `GET /api/discounts/bulk-discounts`
  - Query same filter style as promo list.
- `POST /api/discounts/bulk-discounts` (`manager/admin`)
- `PATCH /api/discounts/bulk-discounts/:uuid` (`manager/admin`)
- `PATCH /api/discounts/bulk-discounts/:uuid/toggle` (`manager/admin`)
- `DELETE /api/discounts/bulk-discounts/:uuid` (`manager/admin`, soft delete)
- `POST /api/discounts/quote`
  - Body:
    - `items[]` (`product_id`, `quantity`)
    - `source`, `customer_id`/`customerId`, `promo_code`/`promoCode`
    - optional `tax`

Bulk payload keys for create/update:

- `name`, `description`
- `discount_type`: `percentage|fixed`
- `discount_value`
- `applies_to`: `category|product|section|branch`
- Targeting keys depending on `applies_to`:
  - `category_id` or `product_id` or `section_id` (uuid) or `branch_id`
- `min_quantity`
- `start_time`, `end_time`
- `priority`
- `status`: `active|inactive`

## Customers (`/api/customers`)

### Segmentation and insights

- `GET /api/customers/segments`
  - Query:
    - pagination: `page`, `page_size`
    - search/sort: `search`, `sort_by`, `sort_order`
    - filters:
      - `segment` (`risk|loyal` groups supported, plus legacy segment names)
      - `last_order_from`, `last_order_to`
      - `total_orders_min`, `total_orders_max`
      - `total_revenue_min`, `total_revenue_max`
      - `rfm_r_min`, `rfm_f_min`, `rfm_m_min`
      - `include_guests` (default `true`)
  - Returns paginated customer rows + `ai_recommendations`.

- `GET /api/customers/insights`
  - Same filter model as segments.
  - Returns aggregate metrics (`risk_count`, `loyal_count`, segment counts, averages, recommendations).

### Audience templates

- `POST /api/customers/audiences/templates` (`manager/admin`)
  - Body:
    - `name` (required)
    - `platform`: `meta|google|both`
    - `segment` or `segment_key`
    - `lookalike_seed_segment`
    - `filters` (object)
- `GET /api/customers/audiences/templates` (`manager/admin`)
  - Query: `search`, `page`, `page_size`
- `GET /api/customers/audiences/templates/:uuid/export` (`manager/admin`)
  - Query:
    - `platform=meta|google|both` (optional)
    - `download=true` to return CSV file bytes directly
  - Default JSON response includes `matched_count`, `excluded_missing_contact_count`, `lookalike_suggestion`, `file_name`, and `csv` string.

## Inactive (not mounted in `app.js`)

These files exist but are not active APIs right now:

- `backend/src/routes/sms.js`
- `backend/src/routes/smsWebhook.js`

There are currently no mounted `/api/sms/*` routes.

## Notes for developers

- Most delete operations are soft delete (`deleted_at`) and keep records.
- Protected routes depend on middleware-resolved `req.effectiveOutletId`.
- Product image upload oversize errors return:
  - `400 { "error": "Uploaded file exceeds max size (500KB)" }`
