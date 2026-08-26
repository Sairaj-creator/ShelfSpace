import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/tenant';
import { requireRole } from '../middleware/role';
import { Role } from '@prisma/client';
import jwt from 'jsonwebtoken';
import { prisma } from '../db';
import { createAuditEntry } from '../services/audit';
import { enqueueJob } from '../lib/queue';

export const usersRouter = Router();

usersRouter.use(requireAuth);

import { getJwtSecret } from '../middleware/tenant';

// GET /users (list users in org)
usersRouter.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const users = await db.user.findMany({
      select: { id: true, email: true, role: true, created_at: true },
      orderBy: { created_at: 'asc' }
    });
    return res.json({ users });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /users/invite (Admin only)
usersRouter.post('/invite', requireRole(Role.admin), async (req: Request, res: Response): Promise<any> => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const orgId = (req as any).orgId;
    const db = (req as any).db;

    const existingMember = await db.user.findFirst({ where: { email } });
    if (existingMember) {
      return res.status(400).json({ error: 'User is already a member of this organization' });
    }
    
    // Create an invite token
    const token = jwt.sign(
      { email, orgId, role: Role.staff, isInvite: true },
      getJwtSecret(),
      { expiresIn: '24h' }
    );

    const currentUser = (req as any).user;

    await db.$transaction(async (tx: any) => {
      await createAuditEntry(tx, {
        orgId,
        actorId: currentUser.userId,
        action: 'USER_INVITED',
        details: { invited_email: email }
      });
    });

    await enqueueJob('sendEmail', { to: email, subject: 'You have been invited to ShelfSpace', template: 'invite', token });

    return res.json({ message: 'Invite sent successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /users/:id (Owner only, cannot delete self)
usersRouter.delete('/:id', requireRole(Role.owner), async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const userId = req.params.id;
    const currentUser = (req as any).user;

    if (userId === currentUser.userId) {
      return res.status(400).json({ error: 'Cannot delete yourself' });
    }

    const userToDelete = await db.user.findUnique({ where: { id: userId } });
    if (!userToDelete) {
      return res.status(404).json({ error: 'User not found' });
    }

    const orgId = (req as any).orgId;

    await db.$transaction(async (tx: any) => {
      await tx.user.delete({ where: { id: userId } });
      await createAuditEntry(tx, {
        orgId,
        actorId: currentUser.userId,
        action: 'USER_REMOVED',
        targetId: userId,
        details: { removed_email: userToDelete.email }
      });
    });

    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
