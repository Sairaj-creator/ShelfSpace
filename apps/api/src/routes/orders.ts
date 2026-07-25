import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/tenant';
import { PrismaClient } from '@prisma/client';

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

// Global prisma client for transactions (unscoped, but we manually scope inside the transaction)
// Alternatively, since transaction clients are their own object, we can't easily use scopedPrisma within a $transaction block out-of-the-box unless we recreate it.
// We'll use the raw prisma client but rigidly enforce req.orgId.
import { prisma } from '../db';

// GET /orders
ordersRouter.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const orders = await db.order.findMany({
      orderBy: { created_at: 'desc' },
      include: { items: true }
    });
    return res.json({ orders });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /orders/:id
ordersRouter.get('/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const order = await db.order.findUnique({
      where: { id: req.params.id },
      include: { items: true }
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    return res.json({ order });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /orders
ordersRouter.post('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const orgId = (req as any).orgId;
    const { customer_name, items } = req.body;
    
    if (!customer_name || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Missing customer_name or items array' });
    }

    // We must do this in a transaction to prevent race conditions and partial failures
    const order = await prisma.$transaction(async (tx) => {
      let computedTotal = 0;
      const orderItemsData = [];

      for (const item of items) {
        if (item.qty <= 0) {
          throw new Error('Quantity must be greater than zero');
        }

        // Fetch product scoped to this org to prevent cross-tenant ordering
        const product = await tx.product.findFirst({
          where: { id: item.product_id, org_id: orgId }
        });

        if (!product) {
          throw new Error(`Product not found or unauthorized (ID: ${item.product_id})`);
        }

        if (product.stock_qty < item.qty) {
          throw new Error(`Insufficient stock for product ${product.name}`);
        }

        // Decrement stock
        await tx.product.update({
          where: { id: product.id },
          data: { stock_qty: product.stock_qty - item.qty }
        });

        const lineTotal = product.price * item.qty;
        computedTotal += lineTotal;

        orderItemsData.push({
          product_id: product.id,
          qty: item.qty,
          unit_price: product.price
        });
      }

      // Create the order and items
      const newOrder = await tx.order.create({
        data: {
          org_id: orgId,
          customer_name,
          status: 'pending',
          total: computedTotal,
          items: {
            create: orderItemsData
          }
        },
        include: { items: true }
      });

      return newOrder;
    });

    return res.status(201).json({ order });
  } catch (error: any) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Error creating order' });
  }
});
