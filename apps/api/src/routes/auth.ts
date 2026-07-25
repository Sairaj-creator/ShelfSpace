import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { Role } from '@prisma/client';
import { requireAuth, getJwtSecret } from '../middleware/tenant';
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
      return res.status(409).json({ error: 'Email already exists' });
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
        }
      },
      include: {
        users: true
      }
    });

    const user = org.users[0];
    
    // Generate secure email verification token
    const verifySecret = getJwtSecret() + 'email-verify';
    const verifyToken = jwt.sign({ userId: user.id, email: user.email }, verifySecret, { expiresIn: '24h' });
    console.log(`[Email Shortcut] Sending verification email to ${email} with token ${verifyToken}`);

    const accessToken = jwt.sign(
      { userId: user.id, orgId: user.org_id, role: user.role },
      getJwtSecret(),
      { expiresIn: '15m' }
    );
    const refreshToken = jwt.sign(
      { userId: user.id, type: 'refresh' },
      getJwtSecret(),
      { expiresIn: '7d' }
    );

    res.cookie('refreshToken', refreshToken, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    return res.status(201).json({ accessToken });
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

    const accessToken = jwt.sign(
      { userId: user.id, orgId: user.org_id, role: user.role },
      getJwtSecret(),
      { expiresIn: '15m' }
    );
    const refreshToken = jwt.sign(
      { userId: user.id, type: 'refresh' },
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

    if (payload.type !== 'refresh') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const accessToken = jwt.sign(
      { userId: user.id, orgId: user.org_id, role: user.role },
      getJwtSecret(),
      { expiresIn: '15m' }
    );
    return res.json({ accessToken });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
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

    const verifySecret = getJwtSecret() + 'email-verify';
    try {
      jwt.verify(token, verifySecret);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid or expired verification token' });
    }

    // Usually we would update `email_verified: true` in the DB here, 
    // but since it's not in the schema, we just acknowledge the token is valid.
    console.log(`[Email Shortcut] Received valid verification for user ${user.id}`);
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

    console.log(`[Email Shortcut] Sending password reset link to ${email} with token ${token}`);
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

    console.log(`[Email Shortcut] User accepted invite: ${user.email}`);
    
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

    console.log(`[Email Shortcut] Password reset completed for user ${userId}`);
    return res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
