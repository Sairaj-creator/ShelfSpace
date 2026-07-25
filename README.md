# 📦 ShelfSpace

> **Enterprise-Grade Multi-Tenant Inventory & Order Management Platform**

![Node.js](https://img.shields.io/badge/Node.js-v20%2B-green?logo=nodedotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-v5.0-blue?logo=typescript)
![React](https://img.shields.io/badge/React-v18.0-61DAFB?logo=react)
![Express](https://img.shields.io/badge/Express-v4.18-000000?logo=express)
![Prisma](https://img.shields.io/badge/Prisma-v5.22-2D3748?logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-v16-4169E1?logo=postgresql)
![Vitest](https://img.shields.io/badge/Vitest-Passing-success?logo=vitest)
![Playwright](https://img.shields.io/badge/Playwright-E2E_Verified-2EAD33?logo=playwright)
![License](https://img.shields.io/badge/License-MIT-purple)

---

## 🚀 Overview

**ShelfSpace** is a modern, high-performance B2B SaaS application designed for multi-tenant inventory control, automated order processing, and subscription management. Built with a production-ready monorepo structure, ShelfSpace enforces strict database-level physical tenant isolation (`org_id`), role-based access control (RBAC), and automated billing via Stripe.

---

## ✨ Features

- 🔒 **Strict Multi-Tenancy**: Automated tenant query injection via Prisma middleware extensions (`scopedPrisma`), preventing cross-tenant data leaks.
- 🔑 **Secure Authentication**: JWT Access Tokens (15m) + HttpOnly Refresh Cookies (7d), featuring automated silent refresh queuing.
- 🛡️ **Role-Based Access Control (RBAC)**: Fine-grained permissions (`owner` vs `staff`) guarding deletion and management endpoints.
- 📊 **Real-time Analytics**: Server-side SQL aggregations (`Prisma.aggregate`) for revenue tracking and dynamic low-stock alerts.
- 💳 **Stripe Billing Integration**: Automated checkout sessions, tier enforcement (free tier cap at 25 products), and Stripe Webhook signature verification.
- ⚡ **Rate Limiting**: Brute-force protection on authentication routes powered by `express-rate-limit`.
- 🧪 **Full Test Coverage**: 100% green test suite — 50 Vitest backend integration tests and Playwright E2E browser automation.

---

## 🏗️ Architecture & Monorepo Structure

```text
ShelfSpace/
├── apps/
│   ├── api/             # Express.js REST API + Prisma ORM + Vitest Suite
│   └── web/             # React + Vite SPA + Playwright E2E Suite
├── packages/
│   └── shared-types/    # Shared TypeScript contracts and interfaces
├── prisma/
│   ├── schema.prisma    # Multi-tenant PostgreSQL Data Schema
│   └── seed.ts          # Multi-tenant test seed data
├── docker-compose.yml   # PostgreSQL + API containerization
└── README.md
```

---

## 🗄️ Database Schema

```mermaid
erDiagram
    ORGANIZATION ||--o{ USER : "has members"
    ORGANIZATION ||--o{ PRODUCT : "owns"
    ORGANIZATION ||--o{ ORDER : "processes"
    ORDER ||--o{ ORDER_ITEM : "contains"
    PRODUCT ||--o{ ORDER_ITEM : "referenced in"

    ORGANIZATION {
        string id PK
        string name
        string plan
        string subscription_status
    }

    USER {
        string id PK
        string org_id FK
        string email
        string role
    }

    PRODUCT {
        string id PK
        string org_id FK
        string name
        string sku
        int price
        int stock_qty
    }

    ORDER {
        string id PK
        string org_id FK
        string customer_name
        int total
        string status
    }
```

---

## 🛠️ Quick Start & Local Setup

### Prerequisites

- **Node.js**: `v18+`
- **npm**: `v9+`
- **PostgreSQL**: `v15+` (or Docker)

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/Sairaj-creator/ShelfSpace.git
cd ShelfSpace
npm install
```

### 2. Environment Configuration

Create a `.env` file in the project root:

```env
PORT=3000
DATABASE_URL=postgresql://shelfspace:shelfspace_password@localhost:5432/shelfspace?schema=public
JWT_SECRET=super_secret_jwt_key
STRIPE_SECRET_KEY=sk_test_mock
STRIPE_WEBHOOK_SECRET=whsec_mock
```

### 3. Database Initialization

```bash
# Push schema migrations
npx prisma db push

# Seed multi-tenant data
npx prisma db seed
```

### 4. Run Development Servers

```bash
# Run both Backend API and Frontend Web concurrently
npm run dev
```

- **Frontend Application**: `http://localhost:5173`
- **Backend API**: `http://localhost:3000`

---

## 🧪 Running Tests

### Backend Unit & Integration Tests (Vitest)

```bash
cd apps/api
npx vitest run --fileParallelism=false
```

### Frontend End-to-End Tests (Playwright)

```bash
cd apps/web
npx playwright test
```

---

## 📜 License

Distributed under the **MIT License**. See `LICENSE` for more information.
