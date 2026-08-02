import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/tenant';
import { requireRole } from '../middleware/role';
import { Role } from '@prisma/client';

export const auditRouter = Router();

auditRouter.use(requireAuth);
auditRouter.use(requireRole(Role.owner));

// GET /audit-logs
auditRouter.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '15', 10)));
    const skip = (page - 1) * limit;

    const [auditLogs, total] = await Promise.all([
      db.auditLog.findMany({
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      db.auditLog.count(),
    ]);

    return res.json({
      audit_logs: auditLogs,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    console.error('Failed to fetch audit logs', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
