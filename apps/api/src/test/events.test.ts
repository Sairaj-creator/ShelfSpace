import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { Role } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_key';

describe('Tier 3 - Real-Time SSE Events', () => {
  let ownerToken: string;
  let orgId: string;

  beforeAll(async () => {
    // Clean up
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();

    const pwHash = await bcrypt.hash('password123', 10);
    const org = await prisma.organization.create({
      data: { name: 'Events Org', plan: 'free', subscription_status: 'active' }
    });
    orgId = org.id;

    const owner = await prisma.user.create({
      data: { org_id: org.id, email: 'events@test.com', password_hash: pwHash, role: Role.owner }
    });

    ownerToken = jwt.sign({ userId: owner.id, email: owner.email, role: owner.role, orgId: owner.org_id }, JWT_SECRET, { expiresIn: '15m' });
  });

  afterAll(async () => {
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
  });

  it('should return a 200 event stream for authenticated users', async () => {
    const res = await request(app)
      .get('/events')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(res.status).toBe(200);
    expect(res.header['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('data: {"type": "connected"}');
  });

  it('should reject unauthenticated access', async () => {
    const res = await request(app)
      .get('/events');

    expect(res.status).toBe(401);
  });
});
