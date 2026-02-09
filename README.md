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
