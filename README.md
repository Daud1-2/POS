# POS System

A comprehensive Point of Sale (POS) system built with modern web technologies.

## Project Structure

```
POS/
├── frontend/              # React/Vue frontend application
│   ├── src/
│   │   ├── components/   # Reusable UI components
│   │   ├── pages/        # Page components
│   │   ├── services/     # API services
│   │   └── assets/       # Images, fonts, etc.
│   ├── public/           # Static files
│   └── package.json
│
├── backend/              # Node.js/Express backend API
│   ├── src/
│   │   ├── routes/       # API routes
│   │   ├── controllers/  # Route controllers
│   │   ├── models/       # Database models
│   │   ├── middleware/   # Express middleware
│   │   ├── services/     # Business logic
│   │   └── utils/        # Utility functions
│   ├── .env              # Environment variables
│   └── package.json
│
├── database/             # Database schemas and migrations
│   ├── migrations/       # Database migrations
│   └── seeds/            # Seed data
│
└── docs/                 # Documentation
```

## Features

- User Authentication & Authorization
- Product/Inventory Management
- Sales/Transaction Processing
- Customer Management
- Reporting & Analytics
- Receipt Generation
- Multi-user Support

## Installation

See individual README files in frontend and backend directories.

## PostgreSQL Setup (Current)

1. Configure backend env in `backend/.env`:
```env
PORT=5000
PGHOST=localhost
PGPORT=5432
PGDATABASE=POSDB
PGUSER=postgres
PGPASSWORD=your_password
PGSSLMODE=disable
```

2. Run migrations:
```powershell
$env:PGPASSWORD='your_password'
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d POSDB -f database\migrations\005_create_orders_table_pg.sql
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d POSDB -f database\migrations\006_create_order_items_table_pg.sql
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d POSDB -f database\migrations\007_create_products_table_pg.sql
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d POSDB -f database\migrations\008_alter_orders_add_cashier_id.sql
```

3. Seed products:
```powershell
& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h localhost -U postgres -d POSDB -f database\seeds\001_products_seed_pg.sql
```

4. Start apps:
```powershell
cd backend
npm run dev

cd ..\frontend
npm start
```

## Dashboard APIs

- `GET /api/health`
- `GET /api/health/db`
- `GET /api/dashboard/summary?range=today|30d|overall`
- `GET /api/dashboard/sales-trend?range=today|30d`
- `GET /api/dashboard/rejected-trend?range=30d`
- `GET /api/dashboard/heatmap?range=30d`
- `GET /api/dashboard/top-products?range=30d&limit=10`
- `GET /api/dashboard/channel-contribution?range=30d`
