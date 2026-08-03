# ShelfSpace — BUILD_LOG.md

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Client (React + Vite)                 │
│  Login / Signup · Products · Orders · Settings · Billing    │
│  CSV Import Modal · Theme Engine · Audit Log Viewer         │
└────────────────────────────┬────────────────────────────────┘
                             │ HTTPS / JWT Bearer
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Express API  (:3000)                       │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │  requireAuth │  │ requireRole  │  │  scopedPrisma    │  │
│  │  (JWT verify │  │ (DB lookup,  │  │  (org_id inject  │  │
│  │ + type guard)│  │ stale-JWT    │  │  via $extends    │  │
│  └──────────────┘  │   defeat)   │  │  on every query) │  │
│                    └──────────────┘  └──────────────────┘  │
│                                                             │
│  /auth   /products   /orders   /users   /billing   /audit  │
│           export/bulk  export   invite  webhooks   logs     │
└────────────────────────────┬────────────────────────────────┘
                             │ Prisma ORM
             ┌───────────────┼───────────────┐
             ▼               ▼               ▼
    ┌──────────────┐  ┌───────────┐  ┌────────────────┐
    │  PostgreSQL  │  │  Stripe   │  │ EmailService   │
    │  (:5432)     │  │  API/     │  │ (console shim, │
    │  (Docker)    │  │ Webhooks  │  │  Resend-ready) │
    └──────────────┘  └───────────┘  └────────────────┘
```

**Data model summary:**  
`Organization` → (has many) `User`, `Product`, `Order`, `AuditLog`  
`Order` → (has many) `OrderItem` → (references) `Product`  
Every tenant-scoped table carries `org_id`. `scopedPrisma` auto-injects it via Prisma's `$extends` on every read, write, and count — enforced at the ORM layer, not in application code.

---

## Hardest Engineering Problem

**The hardest problem was getting multi-tenant isolation correct without leaking across layers.**

The naive approach — manually filtering `where: { org_id }` in every route handler — is a footgun: one missed `findMany` and you have a data leak. The solution was to implement isolation at the ORM layer via Prisma's `$extends` API, so `scopedPrisma(orgId)` automatically injects the `org_id` filter on every read and forces it on every write.

The real difficulty was the edge cases:
- **`findUnique`** ignores extra `where` fields (Prisma enforces the unique index, not composite filters), so `update`/`delete` on a record from another org would silently succeed if `org_id` was just appended to `where`. The fix: let Prisma throw a `RecordNotFound` for reads/updates, since `{ id: X, org_id: wrongOrg }` returns null — the mutation then fails.
- **`OrderItem`** has no `org_id` column. It's owned transitively through `Order`. The solution was a two-step ownership pre-check using the unscoped client before any write is allowed.
- **`AuditLog`** was initially omitted from `tenantModels`, silently leaking all org events. Discovered during security review; fixed by adding it to the list and adding a regression test that asserts `scopedPrisma(orgA).auditLog.findMany()` never returns `orgB`'s records.

The lesson: for multi-tenant SaaS, isolation must be structural and not rely on developer discipline in route handlers. Making the unsafe operation impossible by default — rather than just discouraged — is what separates a real architecture from a fragile one.

---

## Resume Bullet

> Built a multi-tenant SaaS inventory platform (ShelfSpace) in TypeScript/Node/React with Prisma-level tenant isolation using `$extends`, transactional audit logging, Stripe subscription billing with webhook idempotency, RBAC with stale-JWT defeat, and OWASP CSV injection protection. 5-phase layered architecture; 67 Vitest unit tests + 2 Playwright E2E tests passing.

---

## If I Had More Time

1. **Refresh token rotation + revocation list** — stolen refresh tokens are currently valid for 7 days with no server-side invalidation. Would store a `jti` (JWT ID) on each refresh token, persist it against the user row, and rotate it on every `/auth/refresh` call. Revoke on logout and password change.

2. **Real email delivery** — `EmailService` logs to console. Would wire Resend (or Postmark/SES) behind the same interface with a 5-minute retry queue for failed deliveries.

3. **Background job queue** — invite emails, low-stock alerts, and webhook retries all run synchronously inline. Would add BullMQ (Redis-backed) to decouple side-effects from request handlers.

4. **Soft deletes for products and orders** — currently hard-deleting a product that has historical order lines requires catching `P2003`. Adding `deleted_at` / `is_deleted` columns would preserve audit trails and enable undo, which is table stakes for an inventory system.

5. **Idempotency keys on orders** — double-submitted order forms (browser refresh, network retry) can double-create. Would accept a client-supplied `idempotency_key` and dedupe on it inside a DB transaction.

6. **Admin tier in RBAC** — schema comments out `admin: 2` in `ROLE_WEIGHT`; a real product needs an intermediate role (e.g., can manage products and orders but not billing/users). Would implement as a proper Prisma enum value with route-level guards.

7. **Multi-currency support** — prices are stored as integer cents with no currency column, which is fine for a US-only demo but not for "enterprise-grade" as the README claims.

8. **Warehouse / location tracking** — the "ShelfSpace" name implies bin/shelf/location tracking that doesn't exist yet. Would add a `Location` model with `Product → LocationStock` linking stock quantities to physical locations.
