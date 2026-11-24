# PayBridge 💳

> A simulated payment gateway and FinTech transaction engine built with Node.js, TypeScript, PostgreSQL, and Prisma.

PayBridge simulates the core backend architecture of production payment gateways (such as Paystack, Flutterwave, and Stripe). It demonstrates production-grade transactional integrity, double-entry bookkeeping, idempotency protection against duplicate charges, and HMAC-signed webhook delivery.

---

## 🌟 Core Engineering Features

- **Integer-Based Currency Handling**: Monetary amounts stored in the smallest currency unit (kobo for NGN) to prevent floating-point rounding errors.
- **Idempotency Protection**: Enforces `Idempotency-Key` headers on payment initialization to prevent double billing on network timeouts.
- **Double-Entry Ledger Engine**: Balances maintained through immutable debit and credit entries ($\sum \text{Debits} = \sum \text{Credits}$).
- **State Machine Lifecycle**: Controlled transaction transitions (`PENDING` $\rightarrow$ `SUCCESS` or `FAILED`) with atomic database operations.
- **Secure Webhooks**: Event dispatch with `HMAC-SHA256` signatures and retry tracking.
- **Modular Monolith**: High domain cohesion with separated layers: Routes $\rightarrow$ Middleware $\rightarrow$ Controllers $\rightarrow$ Services $\rightarrow$ Database.

---

## 🏗️ System Architecture

```text
HTTP Request
     │
     ▼
[Express Routes]
     │
     ▼
[Middleware Layer] ── (Auth, Input Validation, Idempotency Checks)
     │
     ▼
[Controllers]      ── (HTTP serialization & status codes)
     │
     ▼
[Service Layer]    ── (Pure business logic: Ledger, Transactions, Webhooks)
     │
     ▼
[Prisma ORM]       ── (Type-safe queries & atomic transactions)
     │
     ▼
[(PostgreSQL)]     ── (Relational integrity & constraints)
```

---

## 🧰 Tech Stack

- **Runtime**: Node.js (v22+)
- **Language**: TypeScript (Strict Mode)
- **Framework**: Express.js
- **Database**: PostgreSQL
- **ORM**: Prisma Client & Migrations
- **Validation**: Zod
- **Security**: Bcryptjs (password hashing), JSONWebTokens (JWT), HMAC-SHA256

---

## 🚀 Getting Started

### Prerequisites

- Node.js (v20 or higher)
- PostgreSQL (v15 or higher)
- npm or pnpm

### 1. Clone the repository
```bash
git clone https://github.com/<your-username>/pay_bridge.git
cd pay_bridge
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Update `DATABASE_URL` with your local PostgreSQL credentials:
```env
PORT=5000
NODE_ENV=development
DATABASE_URL="postgresql://postgres:your_password@localhost:5432/paybridge?schema=public"
JWT_SECRET="your-secure-jwt-secret-key"
```

### 4. Generate Prisma Client & Run Migrations
```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 5. Start the development server
```bash
npm run dev
```
The server will boot on `http://localhost:5000` with hot-reloading enabled.

---

## 🛡️ API Health Check

```bash
curl http://localhost:5000/health
```

Expected response:
```json
{
  "status": "success",
  "service": "PayBridge API",
  "timestamp": "2026-11-24T14:40:00.000Z"
}
```

---

## 📄 License

ISC License. Built for engineering portfolio demonstration.
