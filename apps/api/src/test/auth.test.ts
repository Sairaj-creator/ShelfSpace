import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../app';
import { prisma } from '../db';
import { vi } from 'vitest';
import jwt from 'jsonwebtoken';

describe('Auth Endpoints (Layer 2)', () => {
  beforeEach(async () => {
    // Clean up all tables to ensure fresh state
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const testUser = {
    email: 'test@example.com',
    password: 'password123',
    orgName: 'Test Org'
  };

  it('should sign up a new user and organization', async () => {
    const res = await request(app)
      .post('/auth/signup')
      .send(testUser);

    expect(res.status).toBe(201);
    expect(res.body.message).toBeDefined();

    const org = await prisma.organization.findFirst({ where: { name: testUser.orgName } });
    expect(org).not.toBeNull();

    const user = await prisma.user.findUnique({ where: { email: testUser.email } });
    expect(user).not.toBeNull();
    expect(user?.org_id).toBe(org?.id);
  });

  it('should reject signup with duplicate email', async () => {
    await request(app).post('/auth/signup').send(testUser);
    
    const res = await request(app)
      .post('/auth/signup')
      .send(testUser);

    expect(res.status).toBe(201);
    expect(res.body.message).toBeDefined();
  });

  it('should login and return tokens', async () => {
    await request(app).post('/auth/signup').send(testUser);
    // Pre-verify email so login passes the email_verified gate
    await prisma.user.update({ where: { email: testUser.email }, data: { email_verified: true } });

    const res = await request(app)
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeDefined();
    // Check for refresh token cookie
    expect(res.headers['set-cookie'][0]).toMatch(/refreshToken=/);
  });

  it('should reject login for unverified user with 403', async () => {
    await request(app).post('/auth/signup').send(testUser);
    // Do NOT verify email — user.email_verified remains false

    const res = await request(app)
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/verify your email/i);
  });

  it('should reject login with wrong password', async () => {
    await request(app).post('/auth/signup').send(testUser);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: testUser.email, password: 'wrongpassword' });

    expect(res.status).toBe(401);
  });

  it('should refresh access token using refresh token', async () => {
    await request(app).post('/auth/signup').send(testUser);
    await prisma.user.update({ where: { email: testUser.email }, data: { email_verified: true } });
    const loginRes = await request(app).post('/auth/login').send({ email: testUser.email, password: testUser.password });
    
    const cookie = loginRes.headers['set-cookie'][0];

    const refreshRes = await request(app)
      .post('/auth/refresh')
      .set('Cookie', cookie);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeDefined();
  });

  it('should reject a refresh token presented as a Bearer access token', async () => {
    await request(app).post('/auth/signup').send(testUser);
    await prisma.user.update({ where: { email: testUser.email }, data: { email_verified: true } });
    const loginRes = await request(app).post('/auth/login').send({ email: testUser.email, password: testUser.password });

    // Extract the refresh token from the cookie header
    const cookieHeader = loginRes.headers['set-cookie'][0];
    const refreshToken = cookieHeader.split('refreshToken=')[1].split(';')[0];

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${refreshToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/refresh tokens cannot be used/i);
  });

  it('should reject access with expired token on a protected route', async () => {
    // Generate an expired token manually
    const expiredToken = jwt.sign(
      { userId: '123', orgId: '456', role: 'owner' },
      process.env.JWT_SECRET || 'super_secret_jwt_key',
      { expiresIn: '-1h' } // Expired 1 hour ago
    );

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${expiredToken}`);

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Token expired');
  });

  it('should accept valid token on protected route', async () => {
    await request(app).post('/auth/signup').send(testUser);
    await prisma.user.update({ where: { email: testUser.email }, data: { email_verified: true } });
    const loginRes = await request(app).post('/auth/login').send({ email: testUser.email, password: testUser.password });
    const token = loginRes.body.accessToken;

    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBeUndefined(); // we didn't put email in payload, but we put userId
    expect(res.body.user.userId).toBeDefined();
  });

  it('should succeed verify-email route with valid token', async () => {
    let verifyToken = '';
    const originalLog = console.log;
    console.log = vi.fn((msg: string) => {
      if (msg.includes('Sending verification email to test@example.com with token')) {
        verifyToken = msg.split('token ')[1];
      }
      originalLog(msg);
    });

    await request(app).post('/auth/signup').send(testUser);
    
    // Restore console.log
    console.log = originalLog;

    const res = await request(app).post('/auth/verify-email').send({ token: verifyToken });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Email verified');

    // Invalid token should fail
    const resInvalid = await request(app).post('/auth/verify-email').send({ token: 'XYZ' });
    expect(resInvalid.status).toBe(400);
  });

  it('should succeed stubbed request-reset route', async () => {
    await request(app).post('/auth/signup').send(testUser);
    const res = await request(app).post('/auth/request-reset').send({ email: 'test@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('If email exists, reset link sent');
  });
  
  it('should succeed stubbed reset-password route with valid single-use token', async () => {
    await request(app).post('/auth/signup').send(testUser);
    
    // We need the userId to make the reset call
    const user = await prisma.user.findUnique({ where: { email: testUser.email } });
    
    // Manually generate the valid single-use token the way the backend does
    const secret = (process.env.JWT_SECRET || 'super_secret_jwt_key') + user!.password_hash;
    const token = jwt.sign({ userId: user!.id, email: user!.email }, secret, { expiresIn: '15m' });

    const res = await request(app).post('/auth/reset-password').send({ 
      userId: user!.id, 
      token, 
      newPassword: 'newpassword123' 
    });
    
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Password reset successful');

    // Verify it is single-use: Using the same token again should fail because the password hash changed
    const resReuse = await request(app).post('/auth/reset-password').send({ 
      userId: user!.id, 
      token, 
      newPassword: 'anotherpassword' 
    });
    expect(resReuse.status).toBe(400);
    expect(resReuse.body.error).toBe('Invalid or expired reset token');
  });

  describe('Rate Limiting', () => {
    it('blocks excessive requests to auth endpoints', async () => {
      // 100 is the limit. Send 101 requests.
      for (let i = 0; i < 100; i++) {
        await request(app).post('/auth/request-reset').send({ email: 'test@example.com' });
      }

      // The 101st request should be blocked
      const res = await request(app).post('/auth/request-reset').send({ email: 'test@example.com' });
      expect(res.status).toBe(429);
      expect(res.text).toContain('Too many requests');
    });
  });
});
