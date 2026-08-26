import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/tenant';
import { requireRole } from '../middleware/role';
import { Role } from '@prisma/client';
import { createAuditEntry } from '../services/audit';

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);

// GET /inventory/:productId
inventoryRouter.get('/:productId', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const orgId = (req as any).orgId;
    const productId = req.params.productId;

    const product = await db.product.findUnique({
      where: { id: productId }
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const inventoryLevels = await db.inventoryLevel.findMany({
      where: { product_id: productId },
      include: { location: true },
      orderBy: { location: { created_at: 'asc' } }
    });

    return res.json({ inventoryLevels });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /inventory/adjust
inventoryRouter.post('/adjust', requireRole(Role.staff), async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const orgId = (req as any).orgId;
    const currentUser = (req as any).user;
    const { product_id, location_id, qty_change } = req.body;

    if (!product_id || !location_id || typeof qty_change !== 'number') {
      return res.status(400).json({ error: 'Missing required fields: product_id, location_id, qty_change' });
    }

    const updated = await db.$transaction(async (tx: any) => {
      const product = await tx.product.findFirst({ where: { id: product_id, org_id: orgId } });
      if (!product) throw new Error('Product not found');

      const location = await tx.location.findUnique({ where: { id: location_id, org_id: orgId } });
      if (!location) throw new Error('Location not found or unauthorized');

      let inventory = await tx.inventoryLevel.findUnique({
        where: { product_id_location_id: { product_id, location_id } }
      });

      let oldStock = 0;
      let newStock = qty_change;

      if (!inventory) {
        if (qty_change < 0) throw new Error('Cannot reduce stock below zero');
        inventory = await tx.inventoryLevel.create({
          data: {
            product_id,
            location_id,
            stock_qty: qty_change,
            low_stock_threshold: 5
          }
        });
      } else {
        oldStock = inventory.stock_qty;
        newStock = oldStock + qty_change;
        if (newStock < 0) throw new Error('Cannot reduce stock below zero');
        inventory = await tx.inventoryLevel.update({
          where: { id: inventory.id },
          data: { stock_qty: newStock }
        });
      }

      await createAuditEntry(tx, {
        orgId,
        actorId: currentUser.userId,
        action: 'STOCK_UPDATED',
        targetId: inventory.id,
        details: { old_stock: oldStock, new_stock: newStock, location_id }
      });

      return inventory;
    });

    return res.json({ inventoryLevel: updated });
  } catch (error: any) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Internal server error' });
  }
});
