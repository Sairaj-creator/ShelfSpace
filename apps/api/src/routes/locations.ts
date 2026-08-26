import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/tenant';
import { requireRole } from '../middleware/role';
import { Role } from '@prisma/client';

export const locationsRouter = Router();

locationsRouter.use(requireAuth);

// GET /locations
locationsRouter.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const orgId = (req as any).orgId;
    const locations = await db.location.findMany({
      where: { org_id: orgId },
      orderBy: { created_at: 'asc' }
    });
    return res.json({ locations });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /locations
locationsRouter.post('/', requireRole(Role.admin), async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const orgId = (req as any).orgId;
    const { name, address } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Missing required field: name' });
    }

    const location = await db.location.create({
      data: {
        org_id: orgId,
        name,
        address
      }
    });

    return res.status(201).json({ location });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
