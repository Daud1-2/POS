# Orderly POS Execution TODO

## Objective
Convert dashboard and core order flow to fully data-driven PostgreSQL behavior with polling-based realtime updates.

## Completed
- [x] Added PostgreSQL migration `database/migrations/007_create_products_table_pg.sql`.
- [x] Added PostgreSQL migration `database/migrations/008_alter_orders_add_cashier_id.sql`.
- [x] Added product seed file `database/seeds/001_products_seed_pg.sql`.
- [x] Applied migrations and seed to local `POSDB`.
- [x] Refactored `backend/src/routes/products.js` to DB-backed CRUD.
- [x] Refactored `backend/src/routes/sales.js`:
  - strict payload validation
  - transactional product row locking (`FOR UPDATE`)
  - order + order_items inserts
  - stock decrement in same transaction
  - `cashier_id` persisted on orders
- [x] Added `GET /api/health/db` in `backend/src/index.js`.
- [x] Installed `recharts` in frontend.
- [x] Rebuilt `frontend/src/pages/Dashboard.js` with real charts:
  - sales trend
  - rejected trend
  - heatmap grid
  - channel contribution pie
- [x] Split polling:
  - fast data every 15s (summary/top products/channel)
  - slow data every 60s (trend/rejected/heatmap)

## Remaining
- [ ] Add automated backend API tests for sales transaction and dashboard aggregations.
- [ ] Add backend setup/run section in README for migrations + seeds.
- [ ] Final smoke test after backend restart with new code.

## Runbook
```powershell
# Apply migrations
$env:PGPASSWORD='Daud@123'
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d POSDB -f database\migrations\005_create_orders_table_pg.sql
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d POSDB -f database\migrations\006_create_order_items_table_pg.sql
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d POSDB -f database\migrations\007_create_products_table_pg.sql
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d POSDB -f database\migrations\008_alter_orders_add_cashier_id.sql

# Seed products
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d POSDB -f database\seeds\001_products_seed_pg.sql

# Start backend
cd backend
npm run dev

# Start frontend
cd ..\frontend
npm start
```
