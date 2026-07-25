import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { scopedPrisma } from '../db';

export const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
};

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid token' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const payload = jwt.verify(token, getJwtSecret());
    (req as any).user = payload;
    
    // Inject scoped prisma based on JWT payload for tenant isolation
    if ((payload as any).orgId) {
      (req as any).db = scopedPrisma((payload as any).orgId);
      (req as any).orgId = (payload as any).orgId;
    }
    
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};
