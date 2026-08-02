import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

describe('Dashboard Metrics', () => {
  let token: string;
  let orgId: string;
  let ownerId: string;

  beforeEach(async () => {
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();

    const passwordHash = await bcrypt.hash('password123', 10);
    const org = await prisma.organization.create({
      data: {
        name: 'Dashboard Org',
        users: {
          create: {
            email: 'dashboard@example.com',
            password_hash: passwordHash,
            role: Role.owner,
          }
        }
      },
      include: { users: true }
    });

    orgId = org.id;
    ownerId = org.users[0].id;
    token = jwt.sign({ userId: ownerId, orgId, role: Role.owner }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '15m' });
  });

  it('aggregates revenue correctly (excluding cancelled orders)', async () => {
    // 1. Create a product
    const product = await prisma.product.create({
      data: {
        org_id: orgId,
        name: 'Dashboard Item',
        sku: 'DASH-1',
        price: 1500,
        stock_qty: 20
      }
    });

    // 2. Create fulfilled order
    await prisma.order.create({
      data: {
        org_id: orgId,
        customer_name: 'Bob',
        status: 'fulfilled',
        total: 3000,
        items: {
          create: [{ product_id: product.id, qty: 2, unit_price: 1500 }]
        }
      }
    });

    // 3. Create pending order
    await prisma.order.create({
      data: {
        org_id: orgId,
        customer_name: 'Alice',
        status: 'pending',
        total: 1500,
        items: {
          create: [{ product_id: product.id, qty: 1, unit_price: 1500 }]
        }
      }
    });

    // 4. Create cancelled order (should NOT be in revenue)
    await prisma.order.create({
      data: {
        org_id: orgId,
        customer_name: 'Eve',
        status: 'cancelled',
        total: 6000,
        items: {
          create: [{ product_id: product.id, qty: 4, unit_price: 1500 }]
        }
      }
    });

    // 5. Fetch metrics
    const res = await request(app)
      .get('/dashboard/metrics')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    // 3000 (fulfilled) + 1500 (pending) = 4500. Cancelled (6000) ignored.
    expect(res.body.revenue_cents).toBe(4500);
    expect(res.body.low_stock_products).toEqual([]);
    expect(res.body.daily_revenue).toBeDefined();
    expect(res.body.daily_revenue.length).toBe(30);
  });

  it('returns products with stock < low_stock_threshold', async () => {
    // 1. Create one low stock product
    const lowStock = await prisma.product.create({
      data: { org_id: orgId, name: 'Low Stock', sku: 'LOW', price: 1000, stock_qty: 2 }
    });
    
    // 2. Create one sufficient stock product
    await prisma.product.create({
      data: { org_id: orgId, name: 'High Stock', sku: 'HIGH', price: 2000, stock_qty: 10 }
    });

    // 3. Create one custom threshold product that is low
    const customLow = await prisma.product.create({
      data: { org_id: orgId, name: 'Custom Low', sku: 'CUST-LOW', price: 3000, stock_qty: 8, low_stock_threshold: 10 }
    });
    
    // 4. Create one custom threshold product that is sufficient
    await prisma.product.create({
      data: { org_id: orgId, name: 'Custom High', sku: 'CUST-HIGH', price: 4000, stock_qty: 12, low_stock_threshold: 10 }
    });

    const res = await request(app)
      .get('/dashboard/metrics')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.low_stock_products).toHaveLength(2);
    const ids = res.body.low_stock_products.map((p: any) => p.id);
    expect(ids).toContain(lowStock.id);
    expect(ids).toContain(customLow.id);
  });
});
