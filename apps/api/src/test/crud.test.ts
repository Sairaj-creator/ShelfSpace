import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

describe('Layer 4 - Core CRUD (Products & Orders)', () => {
  let ownerToken: string;
  let staffToken: string;
  let orgId: string;
  let productId: string;

  beforeAll(async () => {
    // Teardown
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();

    // Create org
    const org = await prisma.organization.create({
      data: { name: 'CRUD Org', plan: 'free', subscription_status: 'active' }
    });
    orgId = org.id;

    const pwHash = await bcrypt.hash('password123', 12);

    // Create owner
    const owner = await prisma.user.create({
      data: { org_id: org.id, email: 'owner@crud.com', password_hash: pwHash, role: Role.owner }
    });
    ownerToken = jwt.sign({ userId: owner.id, email: owner.email, role: owner.role, orgId: owner.org_id }, JWT_SECRET, { expiresIn: '15m' });

    // Create staff
    const staff = await prisma.user.create({
      data: { org_id: org.id, email: 'staff@crud.com', password_hash: pwHash, role: Role.staff }
    });
    staffToken = jwt.sign({ userId: staff.id, email: staff.email, role: staff.role, orgId: staff.org_id }, JWT_SECRET, { expiresIn: '15m' });
  });

  afterAll(async () => {
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
  });

  describe('Products', () => {
    it('should create a product', async () => {
      const res = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Test Product',
          sku: 'TEST-1',
          price: 1500, // $15.00
          stock_qty: 10
        });
      
      if (res.status !== 201) {
        console.error('Create Product Failed:', res.body);
      }
      expect(res.status).toBe(201);
      expect(res.body.product.name).toBe('Test Product');
      productId = res.body.product.id;
    });

    it('should list products', async () => {
      const res = await request(app)
        .get('/products')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.products).toHaveLength(1);
    });

    it('should update a product', async () => {
      const res = await request(app)
        .put(`/products/${productId}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          price: 2000
        });
      
      expect(res.status).toBe(200);
      expect(res.body.product.price).toBe(2000);
    });

    it('should reject product deletion by staff', async () => {
      const res = await request(app)
        .delete(`/products/${productId}`)
        .set('Authorization', `Bearer ${staffToken}`);
      
      expect(res.status).toBe(403);
    });
  });

  describe('Orders', () => {
    it('should reject order with negative quantities', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${staffToken}`) // Staff can create orders
        .send({
          customer_name: 'Jane Doe',
          items: [
            { product_id: productId, qty: -2 }
          ]
        });
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Quantity must be greater than zero');
    });

    it('should reject order with more than stock', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          customer_name: 'Jane Doe',
          items: [
            { product_id: productId, qty: 15 } // stock is 10
          ]
        });
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Insufficient stock');
    });

    it('should create order, decrement stock, and compute total correctly (ignoring fake total)', async () => {
      const res = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          customer_name: 'John Smith',
          total: 10, // fake total
          items: [
            { product_id: productId, qty: 3 }
          ]
        });
      
      expect(res.status).toBe(201);
      const order = res.body.order;
      expect(order.customer_name).toBe('John Smith');
      
      // qty 3 * price 2000 = 6000
      expect(order.total).toBe(6000);
      expect(order.items).toHaveLength(1);

      // Verify stock was decremented
      const prodRes = await request(app)
        .get(`/products/${productId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(prodRes.body.product.stock_qty).toBe(7); // 10 - 3
    });

    it('should reject deleting a product with existing orders', async () => {
      const res = await request(app)
        .delete(`/products/${productId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot delete product');
    });

    it('should allow owner to delete an unused product', async () => {
      // Create a temporary product
      const createRes = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Temp', sku: 'TMP', price: 100, stock_qty: 1 });
      const tempId = createRes.body.product.id;

      const res = await request(app)
        .delete(`/products/${tempId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);

      // Verify deleted
      const check = await request(app)
        .get(`/products/${tempId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(check.status).toBe(404);
    });
  });
});
