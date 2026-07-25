# ShelfSpace — Master Build Prompt (God-Tier Edition)

> **How to use this file:** Paste the entire contents below (everything after the divider) into Claude Code, a fresh Claude chat, or any coding agent, as your very first message. It is self-contained — the agent should not need to ask you what to build next, only how to configure secrets (Stripe keys, DB URL, etc.).

---

## MASTER PROMPT (copy from here down)

You are acting as a senior full-stack engineer and technical lead. Build a complete, production-quality, multi-tenant SaaS application called **ShelfSpace** — an inventory and order manager for small online sellers (Etsy/Instagram-style shops), with tiered Stripe subscription billing.

Do not ask clarifying questions about scope — the full spec is below. Only ask when you need a secret, credential, or a genuine judgment call with no reasonable default. Work layer by layer, in the exact order given. **After finishing each layer, stop, run the tests for that layer, show me the results, and only then proceed to the next layer.** Do not silently skip the testing checkpoints.

### Tech stack (fixed — do not substitute)
- Frontend: React + TypeScript
- Backend: Node.js + Express + TypeScript
- ORM: Prisma
- Database: PostgreSQL (via Docker locally)
- Auth: hand-rolled JWT + bcrypt (no NextAuth — I want to own the mechanics)
- Payments: Stripe (test mode) — Checkout + Billing + Webhooks
- Containerization: Docker + docker-compose for local dev
- CI: GitHub Actions (lint + test on push)
- Testing: Vitest/Jest for unit + integration, Supertest for API, Playwright for one critical e2e flow

---

## THE 7 LAYERS (build strictly in this order)

Each layer is a checkpoint. A layer is not "done" until its tests pass and you've shown me proof (test output, curl output, or screenshot description).

### Layer 0 — Scaffolding & Infra
- Monorepo structure:
  ```
  shelfspace/
    apps/
      api/          # Express + TS backend
      web/          # React + TS frontend
    packages/
      shared-types/ # shared TS interfaces between api and web
    prisma/
      schema.prisma
    docker-compose.yml
    .github/workflows/ci.yml
    README.md
  ```
- `docker-compose.yml` spins up Postgres + the API.
- Root `package.json` with workspaces (npm/pnpm/yarn — your call, state which and why).
- **Test:** `docker-compose up` boots cleanly; `GET /health` on the API returns `200 {"status":"ok"}`.

### Layer 1 — Data Model (Prisma schema)
Implement exactly this schema (expand types/enums as needed, but keep these tables and relations):
```
organizations (id, name, stripe_customer_id, subscription_status, plan, created_at)
users (id, org_id, email, password_hash, role, created_at)
products (id, org_id, name, sku, price, stock_qty, created_at)
orders (id, org_id, customer_name, status, total, created_at)
order_items (id, order_id, product_id, qty, unit_price)
```
- Every table except `organizations` must have a foreign key to `org_id` (directly or via `order_id`).
- Add indexes on all `org_id` columns — this is the query pattern that will run constantly.
- **Test:** `prisma migrate dev` runs clean; `prisma studio` (or a seed script) shows all 5 tables with correct FKs; write a seed script that creates 2 fake orgs with data, confirm no cross-contamination.

### Layer 2 — Auth
- Endpoints: `POST /auth/signup`, `POST /auth/login`, `POST /auth/verify-email`, `POST /auth/request-reset`, `POST /auth/reset-password`.
- Passwords hashed with bcrypt (cost factor 12). JWT access token (15 min) + refresh token (7 days, httpOnly cookie).
- Signup creates both a `users` row AND a new `organizations` row (the signer becomes `role: owner`).
- **Test:** Supertest suite covering: signup success, duplicate email rejected, login wrong password rejected, expired token rejected on a protected route, refresh flow issues a new access token.

### Layer 3 — Tenant Isolation Middleware (the layer that matters most for your resume)
- Express middleware that decodes the JWT, attaches `req.orgId` and `req.role`.
- Every Prisma query in every route MUST be scoped with `where: { org_id: req.orgId }` — write a lint rule or a code-review checklist comment enforcing this; better yet, wrap Prisma in a helper (`scopedPrisma(orgId)`) so it's structurally impossible to forget.
- **Test:** Write an integration test that logs in as Org A, tries to fetch/update/delete a resource belonging to Org B by ID, and asserts a 403/404 — not a 200 with leaked data. This is the single most important test in the whole project; do not skip it.

### Layer 4 — Core CRUD (Products & Orders)
- `products`: full CRUD, `stock_qty` decrements on order creation, blocked at 0 (or configurable backorder flag).
- `orders` + `order_items`: create order → deduct stock → compute total server-side (never trust client-sent totals).
- Role rule: `staff` can create/view orders and products but cannot delete products or view billing endpoints (enforced in Layer 5's role middleware, tested here too).
- **Test:** Supertest suite for CRUD happy paths + edge cases (ordering more than stock, negative qty rejected, total is recalculated server-side even if client sends a fake total).

### Layer 5 — Roles & Permissions
- `role` enum: `owner`, `staff`.
- Middleware `requireRole('owner')` guarding: billing routes, product delete, staff invite/removal.
- Owner can invite staff via email (magic-link or simple invite-token flow — your call, state the tradeoff).
- **Test:** Staff user hits an owner-only route → 403. Owner hits everything → 200. Invite flow creates a pending user correctly scoped to the same org.

### Layer 6 — Stripe Billing (the hardest, most valuable layer)
- Plans: `free` (capped at 25 products) and `pro` (unlimited + analytics).
- `POST /billing/create-checkout-session` → Stripe Checkout for upgrade to Pro.
- `POST /billing/webhook` (raw body, signature-verified) handling at minimum:
  - `checkout.session.completed` → set org to `pro`, store `stripe_customer_id`
  - `invoice.paid` → confirm `subscription_status: active`
  - `invoice.payment_failed` → set `subscription_status: past_due`, surface a banner condition
  - `customer.subscription.deleted` → downgrade org to `free`
- Enforce the free-tier product cap server-side (not just UI-side).
- **Test:** Use Stripe CLI (`stripe listen --forward-to`) to trigger each event type locally and assert the org's `subscription_status`/`plan` updates correctly in the DB. Include at least one test for "what happens to existing data when downgraded" (e.g., org has 40 products, downgrades to free — decide and document the policy: block new products but don't delete existing ones).

### Layer 7 — Dashboard & Frontend
- React + TS app: login/signup pages, product table, order table, "Upgrade to Pro" flow via Stripe Checkout redirect, a dashboard view with:
  - Revenue this month (aggregate SQL, not client-side summed)
  - Low-stock alert list (`stock_qty < threshold`)
  - Subscription status banner (shows a warning state if `past_due`)
- **Test:** Playwright e2e covering the single critical path: signup → add product → create order → see revenue update on dashboard → attempt upgrade → mock/stub Stripe redirect back to a success page.

---

## AFTER EVERY LAYER — CHECKPOINT RITUAL
For each layer, before moving on:
1. Run the layer's test suite and paste the output.
2. Give me a 2–3 sentence plain-English summary of what was actually built (not just "done").
3. Flag any shortcut taken (e.g., "invite flow skips real email sending, logs the link to console instead") so nothing silently becomes technical debt I don't know about.

---

## FINAL DELIVERABLE — `BUILD_LOG.md`
Once all 7 layers pass, generate a markdown file at the project root called `BUILD_LOG.md` containing:
1. **Architecture diagram** (ASCII or Mermaid) showing frontend → API → DB → Stripe.
2. **What was built, layer by layer**, in plain English (2–4 sentences each) — written so a non-technical recruiter skimming it still understands the scope, and a technical interviewer can drill into any layer.
3. **The hardest technical problem solved** (expect this to be tenant isolation or webhook idempotency — pick honestly based on what actually gave the most trouble) and how it was solved, in enough detail to survive a follow-up interview question.
4. **A ready-to-paste resume bullet**, in this style:
   > "Built a multi-tenant SaaS platform with JWT auth, role-based access control, and Stripe subscription billing (webhook-driven state sync); designed relational schema across 5+ tables enforcing tenant data isolation, validated via automated cross-tenant-leak tests."
5. **A "if I had more time" section** — 3-5 honest next steps (e.g., rate limiting, audit logs, soft deletes) — interviewers respect this more than pretending it's flawless.
6. **Setup instructions** (env vars needed, `docker-compose up`, seed command, how to run each test suite) so the repo is runnable by someone else in under 10 minutes.

Do not write `BUILD_LOG.md` until Layer 7's tests are passing — it should describe what was actually built, not what was planned.

---

## GROUND RULES THROUGHOUT
- Never trust client-sent data for money/stock calculations — recompute server-side.
- Every new table/column touching tenant data must include `org_id` and be indexed on it.
- Prefer boring, explicit code over clever abstractions — this project is meant to be defensible in an interview, not impressive in a vacuum.
- Commit after each layer passes its tests, with a message like `feat(layer-3): tenant isolation middleware + cross-tenant leak tests`.