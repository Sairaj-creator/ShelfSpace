import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/tenant';
import { PrismaClient } from '@prisma/client';

export const ordersRouter = Router();

ordersRouter.use(requireAuth);

// Global prisma client for transactions (unscoped, but we manually scope inside the transaction)
// Alternatively, since transaction clients are their own object, we can't easily use scopedPrisma within a $transaction block out-of-the-box unless we recreate it.
// We'll use the raw prisma client but rigidly enforce req.orgId.
import { prisma } from '../db';
import { createAuditEntry } from '../services/audit';
import { formatRowToCsv } from '../utils/csv';

// GET /orders
ordersRouter.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const pageParam = req.query.page as string;
    const limitParam = req.query.limit as string;
    const statusParam = req.query.status as string;

    if (!pageParam && !limitParam && !statusParam) {
      const orders = await db.order.findMany({
        orderBy: { created_at: 'desc' },
        include: { 
          items: {
            include: { product: true }
          }
        }
      });
      return res.json({ orders });
    }

    const page = Math.max(1, parseInt(pageParam || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(limitParam || '20', 10)));
    const skip = (page - 1) * limit;

    const where: any = statusParam ? { status: statusParam } : {};

    const [orders, total] = await Promise.all([
      db.order.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: { 
          items: {
            include: { product: true }
          }
        }
      }),
      db.order.count({ where }),
    ]);

    return res.json({
      orders,
      total,
      page,
      limit,
      total_pages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /orders/export (OWASP-sanitized denormalized line-item CSV export)
ordersRouter.get('/export', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const orders = await db.order.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        items: {
          include: { product: true }
        }
      }
    });

    const header = ['Order ID', 'Customer Name', 'Order Status', 'Order Date', 'Product SKU', 'Product Name', 'Quantity', 'Unit Price ($)', 'Line Total ($)'];
    const rows: Array<any> = [];

    for (const o of orders) {
      for (const item of o.items) {
        rows.push([
          o.id,
          o.customer_name,
          o.status,
          o.created_at.toISOString(),
          item.product?.sku || item.product_id,
          item.product?.name || 'Unknown Product',
          item.qty,
          (item.unit_price / 100).toFixed(2),
          ((item.qty * item.unit_price) / 100).toFixed(2),
        ]);
      }
    }

    const csvContent = [formatRowToCsv(header), ...rows.map(formatRowToCsv)].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="orders_manifest.csv"');
    return res.status(200).send(csvContent);
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
      include: { 
        items: {
          include: { product: true }
        }
      }
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

        // Decrement stock atomically, catching race conditions
        try {
          await tx.product.update({
            where: { id: product.id, stock_qty: { gte: item.qty } },
            data: { stock_qty: { decrement: item.qty } }
          });
        } catch (e: any) {
          if (e.code === 'P2025') {
            throw new Error(`Insufficient stock for product ${product.name} due to concurrent update`);
          }
          throw e;
        }

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

// PATCH /orders/:id/status
ordersRouter.patch('/:id/status', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const { status } = req.body;
    
    if (!['pending', 'fulfilled', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be pending, fulfilled, or cancelled' });
    }

    const existing = await db.order.findUnique({ 
      where: { id: req.params.id },
      include: { items: true }
    });
    if (!existing) return res.status(404).json({ error: 'Order not found' });

    if (existing.status === 'cancelled') {
      return res.status(400).json({ error: 'Cannot modify a cancelled order' });
    }
    if (existing.status === 'fulfilled' && status === 'pending') {
      return res.status(400).json({ error: 'Cannot change a fulfilled order back to pending' });
    }

    const currentUser = (req as any).user;
    const orgId = (req as any).orgId;

    if (status === 'cancelled' && existing.status !== 'cancelled') {
      const updated = await prisma.$transaction(async (tx) => {
        // Restock items
        for (const item of existing.items) {
          await tx.product.update({
            where: { id: item.product_id },
            data: { stock_qty: { increment: item.qty } }
          });
        }

        const resOrder = await tx.order.update({
          where: { id: req.params.id },
          data: { status }
        });

        await createAuditEntry(tx, {
          orgId,
          actorId: currentUser.userId,
          action: 'ORDER_CANCELLED',
          targetId: req.params.id,
          details: { restocked_items_count: existing.items.length }
        });

        return resOrder;
      });
      return res.json({ order: updated });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const resOrder = await tx.order.update({
        where: { id: req.params.id },
        data: { status }
      });
      return resOrder;
    });

    return res.json({ order: updated });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
