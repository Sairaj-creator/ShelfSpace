import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { Role } from '@prisma/client';
import Stripe from 'stripe';
import { stripe } from '../lib/stripe';
import { vi } from 'vitest';

vi.spyOn(stripe.checkout.sessions, 'create').mockResolvedValue({ url: 'https://checkout.stripe.com/mock-session' } as any);


let ownerToken: string;
let staffToken: string;
let orgId: string;

beforeAll(async () => {
  // Clean up
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  // Setup org and owner
  await request(app)
    .post('/auth/signup')
    .send({ email: 'billingowner@test.com', password: 'password123', orgName: 'Billing Org' });

  // Pre-verify email so the login call below passes the email_verified gate
  await prisma.user.update({
    where: { email: 'billingowner@test.com' },
    data: { email_verified: true },
  });

  const loginRes = await request(app)
    .post('/auth/login')
    .send({ email: 'billingowner@test.com', password: 'password123' });
  
  ownerToken = loginRes.body.accessToken;

  const owner = await prisma.user.findUnique({ where: { email: 'billingowner@test.com' } });
  orgId = owner!.org_id;
  const staff = await prisma.user.create({
    data: {
      email: 'billingstaff@test.com',
      password_hash: 'hash',
      org_id: orgId,
      role: Role.staff
    }
  });

  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET || 'test_jwt_secret_key_123';
  staffToken = jwt.sign({ userId: staff.id, orgId, role: Role.staff }, secret);

  // Set to free plan
  await prisma.organization.update({
    where: { id: orgId },
    data: { plan: 'free' }
  });
});

afterAll(async () => {
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();
});

describe('Layer 6 - Stripe Billing & Product Caps', () => {

  describe('Product Caps', () => {
    it('should allow creating 25th product on free plan', async () => {
      // Create 24 products directly in DB
      const products = Array.from({ length: 24 }).map((_, i) => ({
        org_id: orgId,
        name: `Cap Product ${i}`,
        sku: `CAP-${i}`,
        price: 1000
      }));
      await prisma.product.createMany({ data: products });

      // Create 25th product via API
      const res = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Product 25', sku: 'CAP-25', price: 1000 });

      expect(res.status).toBe(201);
    });

    it('should block concurrent requests from exceeding the 25 product cap (TOCTOU)', async () => {
      // Reset to exactly 24 products
      await prisma.product.deleteMany({ where: { org_id: orgId } });
      const products = Array.from({ length: 24 }).map((_, i) => ({
        org_id: orgId,
        name: `Cap Product Concurrency ${i}`,
        sku: `CAP-CONC-${i}`,
        price: 1000
      }));
      await prisma.product.createMany({ data: products });

      // Fire two concurrent requests
      const req1 = request(app)
        .post('/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Product 25A', sku: 'CAP-25A', price: 1000 });

      const req2 = request(app)
        .post('/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Product 25B', sku: 'CAP-25B', price: 1000 });

      const [res1, res2] = await Promise.all([req1, req2]);
      
      const statuses = [res1.status, res2.status].sort();
      // Exactly one should succeed (201) and exactly one should fail with 403
      expect(statuses).toEqual([201, 403]);
      
      const count = await prisma.product.count({ where: { org_id: orgId } });
      expect(count).toBe(25);
    });

    it('should block creating 26th product on free plan', async () => {
      const res = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Product 26', sku: 'CAP-26', price: 1000 });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Free plan limit reached');
    });

    it('should allow creating 41st product on pro plan', async () => {
      // Upgrade to pro
      await prisma.organization.update({
        where: { id: orgId },
        data: { plan: 'pro' }
      });

      // Create 15 more products directly to reach 40
      const products = Array.from({ length: 15 }).map((_, i) => ({
        org_id: orgId,
        name: `Pro Product ${i}`,
        sku: `PRO-${i}`,
        price: 1000
      }));
      await prisma.product.createMany({ data: products });

      const res = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Product 41', sku: 'PRO-41', price: 1000 });

      expect(res.status).toBe(201);
    });

    it('should block creating 41st product if downgraded to free, but allow reading existing 40', async () => {
      // Downgrade to free
      await prisma.organization.update({
        where: { id: orgId },
        data: { plan: 'free' }
      });

      const resCreate = await request(app)
        .post('/products')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ name: 'Product 42', sku: 'DOWN-42', price: 1000 });

      expect(resCreate.status).toBe(403);

      const resGet = await request(app)
        .get('/products')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(resGet.status).toBe(200);
      expect(resGet.body.products.length).toBeGreaterThanOrEqual(41);
    });
  });

  describe('Billing Roles', () => {
    it('should reject staff from triggering create-checkout-session', async () => {
      const res = await request(app)
        .post('/billing/create-checkout-session')
        .set('Authorization', `Bearer ${staffToken}`);
      
      expect(res.status).toBe(403);
    });

    it('should allow owner to trigger create-checkout-session', async () => {
      const res = await request(app)
        .post('/billing/create-checkout-session')
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.url).toBeDefined();
    });
  });

  describe('Stripe Webhooks', () => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock';
    const stripe = new Stripe('sk_test_mock', { apiVersion: '2025-01-27.acacia' as any });

    const sendWebhook = async (eventType: string, dataObject: any) => {
      const payload = {
        id: 'evt_test',
        object: 'event',
        type: eventType,
        data: {
          object: dataObject
        }
      };

      const payloadString = JSON.stringify(payload);
      const signature = stripe.webhooks.generateTestHeaderString({
        payload: payloadString,
        secret: webhookSecret
      });

      return request(app)
        .post('/billing/webhook')
        .set('stripe-signature', signature)
        .set('Content-Type', 'application/json')
        .send(payloadString); // Send raw string so express.raw parses correctly
    };

    it('should reject webhook with invalid signature', async () => {
      const res = await request(app)
        .post('/billing/webhook')
        .set('stripe-signature', 't=123,v1=invalid')
        .set('Content-Type', 'application/json')
        .send('{"type":"checkout.session.completed"}');
      
      expect(res.status).toBe(400);
    });

    it('should return 200 and not error when webhook contains unknown stripe_customer_id', async () => {
      const res = await sendWebhook('invoice.paid', {
        customer: 'cus_unknown'
      });
      
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    });

    it('should handle checkout.session.completed and upgrade org', async () => {
      const res = await sendWebhook('checkout.session.completed', {
        client_reference_id: orgId,
        customer: 'cus_test123'
      });
      
      expect(res.status).toBe(200);

      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      expect(org?.plan).toBe('pro');
      expect(org?.stripe_customer_id).toBe('cus_test123');
      expect(org?.subscription_status).toBe('active');
    });

    it('should handle invoice.payment_failed and set past_due', async () => {
      const res = await sendWebhook('invoice.payment_failed', {
        customer: 'cus_test123'
      });
      
      expect(res.status).toBe(200);

      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      expect(org?.subscription_status).toBe('past_due');
    });

    it('should handle invoice.paid and set active', async () => {
      const res = await sendWebhook('invoice.paid', {
        customer: 'cus_test123'
      });
      
      expect(res.status).toBe(200);

      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      expect(org?.subscription_status).toBe('active');
    });

    it('should handle customer.subscription.deleted and downgrade to free', async () => {
      const res = await sendWebhook('customer.subscription.deleted', {
        customer: 'cus_test123'
      });
      
      expect(res.status).toBe(200);

      const org = await prisma.organization.findUnique({ where: { id: orgId } });
      expect(org?.plan).toBe('free');
    });
  });
});
