diff --git a/c:\Users\Uzari\OneDrive\Desktop\POS\docs/HANDOFF_SUMMARY.md b/c:\Users\Uzari\OneDrive\Desktop\POS\docs/HANDOFF_SUMMARY.md
new file mode 100644
--- /dev/null
+++ b/c:\Users\Uzari\OneDrive\Desktop\POS\docs/HANDOFF_SUMMARY.md
@@ -0,0 +1,107 @@
+# Orderly POS Handoff Summary
+
+## Current Project State
+- Monorepo folders: `backend`, `frontend`, `mobile`, `database`, `docs`.
+- Current uncommitted change: `todo.md` updated with the latest master data-authority checklist.
+- Backend and frontend are both runnable locally.
+
+## Confirmed Tech Stack
+- Backend: Node.js + Express + PostgreSQL (`pg`).
+- Frontend: React (`react-scripts`) + Tailwind + Recharts.
+- Auth: Appwrite session login on frontend.
+
+## Backend (What is already implemented)
+- DB pool helper exists at `backend/src/services/db.js` (supports `DATABASE_URL` or `PG*` env vars).
+- Health endpoints:
+  - `GET /api/health`
+  - `GET /api/health/db`
+- Routes mounted:
+  - `backend/src/routes/auth.js`
+  - `backend/src/routes/products.js`
+  - `backend/src/routes/sales.js`
+  - `backend/src/routes/dashboard.js`
+- Sales write path (`POST /api/sales`) is transactional:
+  - validates payload
+  - locks product rows (`FOR UPDATE`)
+  - inserts into `orders` and `order_items`
+  - decrements stock
+  - supports `source`, `status`, `order_type`, `cashier_id`, `customer_id`
+- Dashboard APIs implemented:
+  - `GET /api/dashboard/summary`
+  - `GET /api/dashboard/sales-trend`
+  - `GET /api/dashboard/rejected-trend`
+  - `GET /api/dashboard/heatmap`
+  - `GET /api/dashboard/top-products`
+  - `GET /api/dashboard/channel-contribution`
+  - `GET /api/dashboard/payment-type`
+
+## Database Migrations Present
+- `database/migrations/005_create_orders_table_pg.sql`
+- `database/migrations/006_create_order_items_table_pg.sql`
+- `database/migrations/007_create_products_table_pg.sql`
+- `database/migrations/008_alter_orders_add_cashier_id.sql`
+- `database/migrations/009_alter_orders_add_source.sql`
+- Seed: `database/seeds/001_products_seed_pg.sql`
+
+## Frontend (What is already implemented)
+- Routing in `frontend/src/App.js`:
+  - `/` and `/login` -> login page
+  - admin routes wrapped with `AdminLayout` (`/home`, `/dashboard`, `/orders`, `/products`, `/discounts`, `/customers`, `/sms`, `/reporting`, `/settings`)
+- Appwrite configured in `frontend/src/services/appwrite.js` with:
+  - endpoint: `https://fra.cloud.appwrite.io/v1`
+  - project: `698974820021316226bd`
+- Dashboard uses live backend APIs via `frontend/src/services/dashboard.js`.
+- Polling behavior in `frontend/src/pages/Dashboard.js`:
+  - fast data every 15s (summary/top products/payment/channel)
+  - slow data every 60s (sales trend/rejected trend)
+- UI has multiple custom chart/card adjustments already applied.
+
+## Important Product Rules Agreed
+- Dashboard must be backend-authoritative.
+- No hard-coded KPI values.
+- No frontend financial derivation.
+- Website order metrics must come from backend query using `orders.source = 'website'`.
+- POS + website + phone orders should be unified in `orders`.
+
+## Current Master Plan Source
+- `todo.md` now contains the authoritative checklist:
+  - canonical data sources by widget
+  - DB/schema tasks
+  - API tasks
+  - polling tasks
+  - security/outlet filtering
+  - validation and done criteria
+
+## Known Gaps / Next Work (from `todo.md`)
+- Align schema fully to production authority model (`deleted_at`, `scheduled_for`, reviews/history tables, outlet scoping).
+- Add dedicated orders endpoints:
+  - `/api/orders/live`
+  - `/api/orders/pre`
+  - `/api/orders/phone`
+  - `/api/orders/reviews/summary`
+- Remove remaining placeholder/demo behavior in frontend widgets where needed.
+- Enforce outlet-level authorization in queries.
+- Add tests for API response shape and aggregations.
+
+## Run Commands
+- Backend:
+```powershell
+cd backend
+npm run dev
+```
+- Frontend:
+```powershell
+cd frontend
+npm start
+```
+
+## New Chat Starter Prompt (copy/paste)
+```text
+Continue Orderly POS from docs/HANDOFF_SUMMARY.md and todo.md.
+Implement todo.md in this order:
+1) DB schema alignment and migrations
+2) backend orders/read-model endpoints with outlet scoping
+3) frontend wiring cleanup to remove any placeholder data
+4) verification tests + final smoke run
+Update todo.md checkboxes as each task completes.
+```
