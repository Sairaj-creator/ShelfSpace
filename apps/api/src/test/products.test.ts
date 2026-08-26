import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

describe('Products API', () => {
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
        name: 'Products Org',
        users: {
          create: {
            email: 'products@example.com',
            password_hash: passwordHash,
            role: Role.owner,
          }
        },
        locations: {
          create: { name: 'Main Warehouse' }
        }
      },
      include: { users: true, locations: true }
    });

    orgId = org.id;
    ownerId = org.users[0].id;
    (global as any).testProdLoc = org.locations[0].id;
    token = jwt.sign({ userId: ownerId, orgId, role: Role.owner }, process.env.JWT_SECRET || 'fallback-secret', { expiresIn: '15m' });
  });

  it('creates a product with a default low_stock_threshold', async () => {
    const res = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Product',
        sku: 'TEST-1',
        price: 1000,
        stock_qty: 10
      });

    expect(res.status).toBe(201);
    expect(res.body.product.low_stock_threshold).toBe(5);
  });

  it('creates a product with a custom low_stock_threshold', async () => {
    const res = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Test Product 2',
        sku: 'TEST-2',
        price: 1500,
        stock_qty: 10,
        low_stock_threshold: 20
      });

    expect(res.status).toBe(201);
    expect(res.body.product.low_stock_threshold).toBe(20);
  });

  it('updates a product low_stock_threshold', async () => {
    const product = await prisma.product.create({
      data: {
        org_id: orgId,
        name: 'Update Item',
        sku: 'UPD-1',
        price: 1500,
        inventory_levels: {
          create: {
            location_id: (global as any).testProdLoc,
            stock_qty: 20,
            low_stock_threshold: 10
          }
        }
      }
    });

    const res = await request(app)
      .put(`/products/${product.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        low_stock_threshold: 15
      });

    expect(res.status).toBe(200);
    expect(res.body.product.low_stock_threshold).toBe(15);
    expect(res.body.product.stock_qty).toBe(20); // Make sure other fields didn't change
  });

  it('rejects product creation with a duplicate SKU', async () => {
    await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Product 1', sku: 'PA-001', price: 1000, stock_qty: 10 });

    const res = await request(app)
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Product 2', sku: 'pa-001', price: 1500, stock_qty: 5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('A product with this SKU already exists');
  });
});
