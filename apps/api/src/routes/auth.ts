import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../db';
import { Role } from '@prisma/client';
import { requireAuth, getJwtSecret } from '../middleware/tenant';
import { enqueueJob } from '../lib/queue';
import rateLimit from 'express-rate-limit';

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per window
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRouter = Router();

// Apply rate limiting to all auth endpoints
authRouter.use(authLimiter);

authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json({ user: (req as any).user });
});

authRouter.post('/signup', async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password, orgName } = req.body;
    if (!email || !password || !orgName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      // Send an email letting them know they already have an account (simulated)
      await enqueueJob('sendEmail', { to: email, subject: 'Account already exists', template: 'account_exists' });
      return res.status(201).json({ message: 'If successful, a verification email has been sent.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const org = await prisma.organization.create({
      data: {
        name: orgName,
        users: {
          create: {
            email,
            password_hash: passwordHash,
            role: Role.owner,
          }
        },
        locations: {
          create: {
            name: 'Main Warehouse'
          }
        }
      },
      include: {
        users: true
      }
    });

    const user = org.users[0];
    
    // Generate secure email verification token using password_hash as secret
    const verifySecret = getJwtSecret() + user.password_hash;
    const verifyToken = jwt.sign({ userId: user.id, email: user.email }, verifySecret, { expiresIn: '24h' });
    await enqueueJob('sendEmail', { to: email, subject: 'Verify your email', template: 'verify_email', token: verifyToken });

    // Do NOT return the accessToken immediately since they need to verify email.
    // Or we return it and let them use the app, but with a generic success message
    // Actually the previous response was 201 with accessToken. To avoid enumeration via timing/response shape, 
    // we should just return a generic message and make them login, or always return an empty token. 
    // To minimize breaking changes, let's just return a success message.
    return res.status(201).json({ message: 'If successful, a verification email has been sent.' });

  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

authRouter.post('/login', async (req: Request, res: Response): Promise<any> => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Missing credentials' });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.email_verified) {
      return res.status(403).json({ error: 'Please verify your email before logging in.' });
    }

    const accessToken = jwt.sign(
      { userId: user.id, orgId: user.org_id, role: user.role },
      getJwtSecret(),
      { expiresIn: '15m' }
    );
    
    const jti = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.refreshToken.create({
      data: {
        jti,
        user_id: user.id,
        expires_at: expiresAt,
      }
    });

    const refreshToken = jwt.sign(
      { userId: user.id, jti, type: 'refresh' },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    res.cookie('refreshToken', refreshToken, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    return res.json({ accessToken });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

authRouter.post('/refresh', async (req: Request, res: Response): Promise<any> => {
  try {
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!refreshToken) {
      return res.status(401).json({ error: 'No refresh token provided' });
    }

    let payload: any;
    try {
      payload = jwt.verify(refreshToken, getJwtSecret());
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    if (payload.type !== 'refresh' || !payload.jti) {
      return res.status(401).json({ error: 'Invalid token type or missing jti' });
    }

    const result = await prisma.refreshToken.updateMany({
      where: { jti: payload.jti, revoked_at: null },
      data: { revoked_at: new Date() }
    });

    if (result.count === 0) {
      // The token wasn't found or was already revoked.
      const existing = await prisma.refreshToken.findUnique({ where: { jti: payload.jti } });
      if (existing && existing.revoked_at) {
        // Breach detection: Token was reused! Revoke ALL tokens for this user.
        await prisma.refreshToken.updateMany({
          where: { user_id: existing.user_id },
          data: { revoked_at: new Date() }
        });
        console.warn(`[Auth] BREACH DETECTED: Refresh token reuse for user ${existing.user_id}`);
      }
      return res.status(401).json({ error: 'Token revoked or invalid' });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const newJti = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await prisma.refreshToken.create({
      data: {
        jti: newJti,
        user_id: user.id,
        expires_at: expiresAt,
      }
    });

    const accessToken = jwt.sign(
      { userId: user.id, orgId: user.org_id, role: user.role },
      getJwtSecret(),
      { expiresIn: '15m' }
    );
    
    const newRefreshToken = jwt.sign(
      { userId: user.id, jti: newJti, type: 'refresh' },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    res.cookie('refreshToken', newRefreshToken, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    return res.json({ accessToken });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

authRouter.post('/logout', async (req: Request, res: Response): Promise<any> => {
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
  
  if (refreshToken) {
    try {
      const payload: any = jwt.verify(refreshToken, getJwtSecret(), { ignoreExpiration: true });
      if (payload.jti) {
        await prisma.refreshToken.updateMany({
          where: { jti: payload.jti, revoked_at: null },
          data: { revoked_at: new Date() }
        });
      }
    } catch (e) {
      // Ignore token verification errors on logout
    }
  }

  res.clearCookie('refreshToken', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return res.json({ message: 'Logged out successfully' });
});

authRouter.post('/verify-email', async (req: Request, res: Response): Promise<any> => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    // The signature uses a static suffix for email verification,
    // so we can blindly decode to get the userId, then verify it.
    const decoded = jwt.decode(token) as any;
    if (!decoded || !decoded.userId) {
      return res.status(400).json({ error: 'Invalid token payload' });
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.userId } });
    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    const verifySecret = getJwtSecret() + user.password_hash;
    try {
      jwt.verify(token, verifySecret);
    } catch (e: any) {
      console.error('JWT Verify Error:', e);
      return res.status(400).json({ error: 'Invalid or expired verification token', details: e.message });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { email_verified: true }
    });

    await enqueueJob('sendEmail', { to: user.email, subject: 'Email verified', template: 'email_verified' });
    return res.json({ message: 'Email verified' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

authRouter.post('/request-reset', async (req: Request, res: Response): Promise<any> => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });
    
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Don't leak if user exists or not
      return res.json({ message: 'If email exists, reset link sent' });
    }

    // Create a single-use token by appending the user's current password hash to the secret
    const secret = getJwtSecret() + user.password_hash;
    const token = jwt.sign({ userId: user.id, email: user.email }, secret, { expiresIn: '15m' });

    await enqueueJob('sendEmail', { to: email, subject: 'Password Reset', template: 'password_reset', token });
    return res.json({ message: 'If email exists, reset link sent' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

authRouter.post('/accept-invite', async (req: Request, res: Response): Promise<any> => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Missing fields' });

    let payload: any;
    try {
      payload = jwt.verify(token, getJwtSecret());
    } catch (e) {
      return res.status(400).json({ error: 'Invalid or expired invite token' });
    }

    if (!payload.isInvite) {
      return res.status(400).json({ error: 'Invalid token type' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email: payload.email } });
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    
    const user = await prisma.user.create({
      data: {
        email: payload.email,
        password_hash: passwordHash,
        org_id: payload.orgId,
        role: Role.staff, // Hardcoded to staff, never read from client input or token
      }
    });

    await enqueueJob('sendEmail', { to: user.email, subject: 'Welcome to ShelfSpace', template: 'invite_accepted' });
    
    return res.status(201).json({ message: 'User created' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

authRouter.post('/reset-password', async (req: Request, res: Response): Promise<any> => {
  try {
    const { userId, token, newPassword } = req.body;
    if (!userId || !token || !newPassword) return res.status(400).json({ error: 'Missing fields' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(400).json({ error: 'Invalid reset payload' });

    const secret = getJwtSecret() + user.password_hash;
    try {
      jwt.verify(token, secret);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { password_hash: passwordHash }
    });

    await enqueueJob('sendEmail', { to: user.email, subject: 'Password Reset Successful', template: 'password_reset_success' });
    return res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
