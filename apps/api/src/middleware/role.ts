import { Request, Response, NextFunction } from 'express';
import { Role } from '@prisma/client';
import { prisma } from '../db';

const ROLE_WEIGHT: Record<Role, number> = {
  owner: 3,
  // admin: 2 (if added later)
  staff: 1
};

export const requireRole = (minimumRole: Role) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = (req as any).user;
      if (!payload || !payload.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Fresh lookup to catch instant demotions/promotions
      const user = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { role: true }
      });

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      const userWeight = ROLE_WEIGHT[user.role] || 0;
      const minWeight = ROLE_WEIGHT[minimumRole] || 0;

      if (userWeight < minWeight) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      // Optionally update req.user.role with fresh role for downstream
      (req as any).user.role = user.role;
      next();
    } catch (err) {
      console.error('Role check error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
};
