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
      data: { 
        name: 'CRUD Org', 
        plan: 'free', 
        subscription_status: 'active',
        locations: { create: { name: 'Main Warehouse' } }
      },
      include: { locations: true }
    });
    orgId = org.id;
    (global as any).testCrudLocId = org.locations[0].id;

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

    it('should soft-delete a product with existing orders', async () => {
      const res = await request(app)
        .delete(`/products/${productId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);

      // Verify it does not appear in GET /products
      const listRes = await request(app)
        .get('/products')
        .set('Authorization', `Bearer ${ownerToken}`);
      expect(listRes.body.products.some((p: any) => p.id === productId)).toBe(false);
    });

    it('should allow recreating a SKU after it is soft-deleted', async () => {
      const res = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Recreated Product', sku: 'TEST-1', price: 1500, stock_qty: 10 });
      
      expect(res.status).toBe(201);
      expect(res.body.product.sku).toBe('TEST-1');
      productId = res.body.product.id;
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

    it('should allow updating order status to fulfilled or cancelled', async () => {
      // Create an order first
      const createRes = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          customer_name: 'Status Test Customer',
          items: [{ product_id: productId, qty: 1 }]
        });
      if (createRes.status !== 201) console.error("TEST FAILED:", createRes.body);
      const orderId = createRes.body.order.id;

      // Transition status to fulfilled
      const patchRes = await request(app)
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ status: 'fulfilled' });

      expect(patchRes.status).toBe(200);
      expect(patchRes.body.order.status).toBe('fulfilled');

      // Invalid status should be rejected
      const invalidRes = await request(app)
        .patch(`/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ status: 'invalid_status' });

      expect(invalidRes.status).toBe(400);
    });

    it('should prevent double-restocking on concurrent order cancellations', async () => {
      // Create an order
      const createRes = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          customer_name: 'Race Customer',
          items: [{ product_id: productId, qty: 1 }]
        });
      const orderId = createRes.body.order.id;

      // Get stock before cancellation
      const beforeRes = await request(app).get(`/products/${productId}`).set('Authorization', `Bearer ${ownerToken}`);
      const stockBefore = beforeRes.body.product.stock_qty;

      // Concurrent cancellations
      const req1 = request(app).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${ownerToken}`).send({ status: 'cancelled' });
      const req2 = request(app).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${ownerToken}`).send({ status: 'cancelled' });
      
      const [res1, res2] = await Promise.all([req1, req2]);
      
      const statuses = [res1.status, res2.status].sort();
      expect(statuses).toEqual([200, 400]); // One should succeed, one should fail

      // Get stock after cancellation
      const afterRes = await request(app).get(`/products/${productId}`).set('Authorization', `Bearer ${ownerToken}`);
      const stockAfter = afterRes.body.product.stock_qty;

      // Stock should increase exactly by 1
      expect(stockAfter).toBe(stockBefore + 1);
    });

    it('should enforce idempotency for order creation (concurrent)', async () => {
      const idempotencyKey = 'idemp-test-key-1';
      
      const req1 = request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ customer_name: 'Idempotency Customer', items: [{ product_id: productId, qty: 1 }] });
        
      const req2 = request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ customer_name: 'Idempotency Customer', items: [{ product_id: productId, qty: 1 }] });

      const [res1, res2] = await Promise.all([req1, req2]);
      
      // Both should return 201 (one created, one idempotent replay or 409 conflict if blocked by timeout)
      // Since it's concurrent, one will lock and the other will block. If the lock releases quickly, it returns 201 replay.
      if (![201, 409].includes(res1.status)) console.error("IDEMP TEST FAIL 1:", res1.body);
      if (![201, 409].includes(res2.status)) console.error("IDEMP TEST FAIL 2:", res2.body);
      expect([201, 409]).toContain(res1.status);
      expect([201, 409]).toContain(res2.status);
      
      if (res1.status === 201 && res2.status === 201) {
        // Both got success, they should have the exact same order ID
        expect(res1.body.order.id).toBe(res2.body.order.id);
      }
    });

    it('should soft-delete an order and atomic restock', async () => {
      // Create an order
      const createRes = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          customer_name: 'Delete Customer',
          items: [{ product_id: productId, qty: 1 }]
        });
      const orderId = createRes.body.order.id;

      // Get stock before delete
      const beforeRes = await request(app).get(`/products/${productId}`).set('Authorization', `Bearer ${ownerToken}`);
      const stockBefore = beforeRes.body.product.stock_qty;

      // Soft delete
      const delRes = await request(app).delete(`/orders/${orderId}`).set('Authorization', `Bearer ${ownerToken}`);
      expect(delRes.status).toBe(200);

      // Verify it's gone from GET /orders
      const listRes = await request(app).get('/orders').set('Authorization', `Bearer ${ownerToken}`);
      expect(listRes.body.orders.some((o: any) => o.id === orderId)).toBe(false);

      // Get stock after delete
      const afterRes = await request(app).get(`/products/${productId}`).set('Authorization', `Bearer ${ownerToken}`);
      const stockAfter = afterRes.body.product.stock_qty;
      expect(stockAfter).toBe(stockBefore + 1);
    });
    it('should allow different orgs to use the same idempotency key without collision', async () => {
      const idempotencyKey = 'shared-idemp-key';
      
      // Org 1 creates order
      const req1 = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ customer_name: 'Org1 Customer', items: [{ product_id: productId, qty: 1 }] });
      
      expect(req1.status).toBe(201);
      const order1Id = req1.body.order.id;

      // Create a second org and user
      const pwHash = await bcrypt.hash('password123', 10);
      const org2 = await prisma.organization.create({
        data: { 
          name: 'Org 2', 
          plan: 'free', 
          subscription_status: 'active',
          locations: { create: { name: 'Main Warehouse' } }
        },
        include: { locations: true }
      });
      const owner2 = await prisma.user.create({
        data: { org_id: org2.id, email: 'owner2@crud.com', password_hash: pwHash, role: Role.owner }
      });
      const owner2Token = jwt.sign({ userId: owner2.id, email: owner2.email, role: owner2.role, orgId: owner2.org_id }, JWT_SECRET, { expiresIn: '15m' });

      const prod2 = await prisma.product.create({
        data: { org_id: org2.id, name: 'Org 2 Product', sku: 'ORG2-PROD', price: 1000, inventory_levels: { create: { location_id: org2.locations[0].id, stock_qty: 10 } } }
      });

      // Org 2 creates order with SAME idempotency key
      const req2 = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${owner2Token}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({ customer_name: 'Org2 Customer', items: [{ product_id: prod2.id, qty: 1 }] });
      
      expect(req2.status).toBe(201);
      const order2Id = req2.body.order.id;

      // Verify they are distinct orders
      expect(order1Id).not.toBe(order2Id);
      expect(req1.body.order.customer_name).toBe('Org1 Customer');
      expect(req2.body.order.customer_name).toBe('Org2 Customer');
    });

    it('should prevent double-restocking on concurrent PATCH status cancel and DELETE order', async () => {
      // Create an order
      const createRes = await request(app)
        .post('/orders')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          customer_name: 'Cross-Route Race Customer',
          items: [{ product_id: productId, qty: 1 }]
        });
      const orderId = createRes.body.order.id;

      // Get stock before cancellation/deletion
      const beforeRes = await request(app).get(`/products/${productId}`).set('Authorization', `Bearer ${ownerToken}`);
      const stockBefore = beforeRes.body.product.stock_qty;

      // Concurrent PATCH cancel and DELETE
      const reqPatch = request(app).patch(`/orders/${orderId}/status`).set('Authorization', `Bearer ${ownerToken}`).send({ status: 'cancelled' });
      const reqDelete = request(app).delete(`/orders/${orderId}`).set('Authorization', `Bearer ${ownerToken}`);
      
      const [resPatch, resDelete] = await Promise.all([reqPatch, reqDelete]);
      
      // Both might theoretically succeed (e.g. Patch sets status to cancelled, Delete sets deleted_at to true) 
      // or one might fail depending on exact timing and lock resolution.
      // The important thing is stock should be incremented EXACTLY once.

      // Get stock after operations
      const afterRes = await request(app).get(`/products/${productId}`).set('Authorization', `Bearer ${ownerToken}`);
      const stockAfter = afterRes.body.product.stock_qty;

      // Stock should increase exactly by 1 (the 1 item we ordered)
      expect(stockAfter).toBe(stockBefore + 1);
    });
  });
});
