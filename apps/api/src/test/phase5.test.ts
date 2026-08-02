import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { Role } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../middleware/tenant';
import { sanitizeCsvCell, formatRowToCsv } from '../utils/csv';

describe('Phase 5 Features & Security', () => {
  let orgId: string;
  let ownerToken: string;
  let staffToken: string;
  let ownerUserId: string;

  beforeEach(async () => {
    // Clean database
    await prisma.auditLog.deleteMany();
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();

    // Create test organization
    const org = await prisma.organization.create({
      data: {
        name: 'Phase 5 Test Org',
        plan: 'free',
        users: {
          create: [
            {
              email: 'owner@phase5.com',
              password_hash: 'hash',
              role: Role.owner,
            },
            {
              email: 'staff@phase5.com',
              password_hash: 'hash',
              role: Role.staff,
            },
          ],
        },
      },
      include: { users: true },
    });

    orgId = org.id;
    const owner = org.users.find(u => u.role === Role.owner)!;
    const staff = org.users.find(u => u.role === Role.staff)!;
    ownerUserId = owner.id;

    ownerToken = jwt.sign({ userId: owner.id, orgId: org.id, role: Role.owner }, getJwtSecret());
    staffToken = jwt.sign({ userId: staff.id, orgId: org.id, role: Role.staff }, getJwtSecret());
  });

  describe('OWASP Formula / CSV Injection Sanitizer', () => {
    it('should prefix leading =, +, -, @, \\t, \\r with single quote', () => {
      expect(sanitizeCsvCell('=1+1')).toBe("'=1+1");
      expect(sanitizeCsvCell('+123')).toBe("'+123");
      expect(sanitizeCsvCell('-SUM(A1:A10)')).toBe("'-SUM(A1:A10)");
      expect(sanitizeCsvCell('@cmd')).toBe("'@cmd");
      expect(sanitizeCsvCell('\tTabLeading')).toBe("'\tTabLeading");
      expect(sanitizeCsvCell('\rCarriageReturn')).toBe("'\rCarriageReturn");
    });

    it('should handle normal strings and values cleanly', () => {
      expect(sanitizeCsvCell('Normal Product')).toBe('Normal Product');
      expect(sanitizeCsvCell(1234)).toBe('1234');
      expect(sanitizeCsvCell(null)).toBe('');
    });

    it('should properly format and quote CSV rows containing commas or quotes', () => {
      const row = ['Product, Widget', 'SKU-123', '=HYPERLINK("http://evil.com")'];
      const formatted = formatRowToCsv(row);
      expect(formatted).toContain('"Product, Widget"');
      expect(formatted).toContain("'=HYPERLINK(");
    });
  });

  describe('Bulk Product Import (/products/bulk)', () => {
    it('should reject bulk import containing duplicate SKUs within the file', async () => {
      const res = await request(app)
        .post('/products/bulk')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          products: [
            { name: 'Item 1', sku: 'DUP-SKU', price: 1000 },
            { name: 'Item 2', sku: 'OTHER-SKU', price: 2000 },
            { name: 'Item 3', sku: 'dup-sku', price: 1500 }, // case-insensitive duplicate
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Duplicate SKU 'dup-sku' found in CSV at row 1 and row 3");
    });

    it('should reject bulk import exceeding free plan limit (25 products)', async () => {
      // Create 20 products
      const bulkData = Array.from({ length: 10 }, (_, i) => ({
        name: `Product ${i}`,
        sku: `SKU-${i}`,
        price: 500,
      }));

      await request(app)
        .post('/products/bulk')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ products: bulkData });

      // Try importing 20 more on free plan (20 + 10 = 30 > 25)
      const overflowData = Array.from({ length: 20 }, (_, i) => ({
        name: `New Product ${i}`,
        sku: `NEW-SKU-${i}`,
        price: 500,
      }));

      const res = await request(app)
        .post('/products/bulk')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ products: overflowData });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Bulk import of 20 products exceeds free plan limit of 25 products');
    });

    it('should successfully bulk import products and generate a transactional AuditLog entry', async () => {
      const res = await request(app)
        .post('/products/bulk')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          products: [
            { name: 'Bulk Product A', sku: 'BULK-A', price: 1999, stock_qty: 10 },
            { name: 'Bulk Product B', sku: 'BULK-B', price: 2999, stock_qty: 20 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.created_count).toBe(2);

      // Verify Audit Log
      const logs = await prisma.auditLog.findMany({ where: { org_id: orgId } });
      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe('BULK_PRODUCTS_IMPORTED');
      expect(logs[0].actor_id).toBe(ownerUserId);
      expect(JSON.parse(logs[0].details!)).toEqual({ count: 2 });
    });
  });

  describe('Audit Log Endpoint (/audit-logs)', () => {
    it('should reject staff members from accessing audit logs', async () => {
      const res = await request(app)
        .get('/audit-logs')
        .set('Authorization', `Bearer ${staffToken}`);

      expect(res.status).toBe(403);
    });

    it('should return paginated audit logs for owner', async () => {
      // Trigger an invite to produce an audit log
      await request(app)
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: 'newstaff@test.com' });

      const res = await request(app)
        .get('/audit-logs?page=1&limit=10')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.audit_logs.length).toBe(1);
      expect(res.body.audit_logs[0].action).toBe('USER_INVITED');
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
    });
  });

  describe('CSV Export Endpoints', () => {
    it('should export OWASP-sanitized products CSV', async () => {
      // Create product with formula name
      await prisma.product.create({
        data: {
          org_id: orgId,
          name: '=SUM(A1:A50)',
          sku: '+FORMULA-SKU',
          price: 1500,
        },
      });

      const res = await request(app)
        .get('/products/export')
        .set('Authorization', `Bearer ${ownerToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain("'=SUM(A1:A50)");
      expect(res.text).toContain("'+FORMULA-SKU");
    });
  });
});
