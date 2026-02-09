# POS System Plan (Web, Mobile, Windows)

## Goal
Build a cloud POS that works online and offline, starting with cashier flow. Stack: React + Tailwind (web), React Native + Expo + NativeWind (mobile), Windows POS via Web + Electron. Backend: Node.js + Express. Database: AWS RDS PostgreSQL.

## Phases

### Phase 0: Decisions locked
- Payments: cash + credit only
- Roles: admin + cashier
- Backend: Node.js + Express
- Database: AWS RDS PostgreSQL
- Web: React + Tailwind CSS
- Mobile: React Native + Expo + NativeWind
- Windows POS: Web app wrapped with Electron

### Phase 1: Cashier Web MVP
- Product list, cart, checkout
- Payment method: cash/credit
- Sales stored in PostgreSQL
- Basic sales report
- Auth (simple role-based gates)

### Phase 2: Admin Web
- Manage products
- Track inventory
- View sales analytics (top items, totals)

### Phase 3: Offline support
- Local storage + sync queue on web client
- Auto-sync sales when online
- Conflict rules (server authoritative for catalog; client authoritative for sales until synced)

### Phase 4: Mobile Cashier
- React Native cashier app
- Same API as web
- Offline queue

### Phase 5: Windows POS
- Electron wrapper for web app
- Local offline storage + sync

## Data Model (Postgres)
- users (admin/cashier)
- products
- sales
- sale_items
- customers (optional for credit ledger)

## Key API Endpoints
- POST /auth/login
- GET /products
- POST /products
- PUT /products/:id
- DELETE /products/:id
- GET /sales
- POST /sales
- GET /sales/report

## Next Implementation Steps
1. Add PostgreSQL connection (pg)
2. Wire routes to DB
3. Build cashier UI in web
4. Add admin roles and dashboards

## Appwrite User Creation
- Create users in Appwrite Console: `Users` → `Create User`
- Use those credentials to sign in on the login page

## Notes
- Offline sync requires an event queue on client and idempotent server endpoints.
- Credit payments should track customer balance if needed.
