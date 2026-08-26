import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import * as queue from '../lib/queue';
import { Role } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

describe('Layer 5 - Roles & Permissions', () => {
  let ownerToken: string;
  let staffToken: string;
  let orgId: string;
  let staffId: string;
  let ownerId: string;
  let inviteToken: string;

  beforeAll(async () => {
    // Clean up
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();

    // Setup base data
    const org = await prisma.organization.create({
      data: { name: 'Role Test Org', plan: 'pro', subscription_status: 'active' }
    });
    orgId = org.id;

    const pwHash = await bcrypt.hash('password123', 12);

    const owner = await prisma.user.create({
      data: { org_id: org.id, email: 'owner@roles.com', password_hash: pwHash, role: Role.owner }
    });
    ownerId = owner.id;
    ownerToken = jwt.sign({ userId: owner.id, email: owner.email, role: owner.role, orgId: owner.org_id }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '15m' });

    const staff = await prisma.user.create({
      data: { org_id: org.id, email: 'staff@roles.com', password_hash: pwHash, role: Role.staff }
    });
    staffId = staff.id;
    staffToken = jwt.sign({ userId: staff.id, email: staff.email, role: staff.role, orgId: staff.org_id }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '15m' });
  });

  afterAll(async () => {
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
  });

  describe('User Management', () => {
    it('should allow staff to list users', async () => {
      const res = await request(app)
        .get('/users')
        .set('Authorization', `Bearer ${staffToken}`);
      
      expect(res.status).toBe(200);
      expect(res.body.users.length).toBeGreaterThanOrEqual(2);
    });

    it('should reject staff trying to invite users', async () => {
      const res = await request(app)
        .post('/users/invite')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({ email: 'newstaff@roles.com' });
      
      expect(res.status).toBe(403);
    });

    it('should allow owner to invite users', async () => {
      const enqueueSpy = vi.spyOn(queue, 'enqueueJob').mockImplementation(async (name, data) => {
        if (name === 'sendEmail' && data.template === 'invite') {
          inviteToken = data.token;
        }
      });

      const res = await request(app)
        .post('/users/invite')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ email: 'newstaff@roles.com' });
      
      expect(res.status).toBe(200);
      expect(res.body.token).toBeUndefined(); // Token must NOT appear in response body
      expect(inviteToken).toBeDefined(); // Token captured via email send

      enqueueSpy.mockRestore();
    });

    it('should allow invited staff to accept invite and create user', async () => {
      const res = await request(app)
        .post('/auth/accept-invite')
        .send({ token: inviteToken, password: 'newpassword123' });
      
      expect(res.status).toBe(201);

      // Verify they were added to the DB
      const user = await prisma.user.findUnique({ where: { email: 'newstaff@roles.com' } });
      expect(user).toBeDefined();
      expect(user?.org_id).toBe(orgId);
      expect(user?.role).toBe(Role.staff);
    });

    it('should reject accepting the same invite token twice (duplicate email)', async () => {
      const res = await request(app)
        .post('/auth/accept-invite')
        .send({ token: inviteToken, password: 'newpassword123' });
      
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('User already exists');
    });

    it('should reject tampered cross-org invite tokens', async () => {
      // Forge a token for a different org using a fake secret
      const forgedToken = jwt.sign(
        { email: 'hacker@roles.com', orgId: 'fake-org-id', role: Role.owner, isInvite: true },
        'wrong-secret',
        { expiresIn: '24h' }
      );

      const res = await request(app)
        .post('/auth/accept-invite')
        .send({ token: forgedToken, password: 'hackerpassword' });
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid or expired invite token');
    });

    it('should reject staff trying to delete users', async () => {
      const res = await request(app)
        .delete(`/users/${staffId}`)
        .set('Authorization', `Bearer ${staffToken}`);
      
      expect(res.status).toBe(403);
    });

    it('should allow owner to delete staff', async () => {
      const res = await request(app)
        .delete(`/users/${staffId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(200);

      // Verify deletion
      const user = await prisma.user.findUnique({ where: { id: staffId } });
      expect(user).toBeNull();
    });

    it('should prevent owner from deleting themselves', async () => {
      const res = await request(app)
        .delete(`/users/${ownerId}`)
        .set('Authorization', `Bearer ${ownerToken}`);
      
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot delete yourself');
    });
  });
});
