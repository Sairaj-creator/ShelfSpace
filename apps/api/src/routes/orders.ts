import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/tenant';
import { enqueueJob } from '../lib/queue';
import { redisConnection } from '../lib/redis';
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
    const db = (req as any).db;
    const { customer_name, items } = req.body;
    
    if (!customer_name || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Missing customer_name or items array' });
    }

    const idempotencyKey = req.header('Idempotency-Key');

    // We must do this in a transaction to prevent race conditions and partial failures
    const order = await db.$transaction(async (tx: any) => {
        if (idempotencyKey) {
          await tx.idempotencyRecord.create({
            data: {
              key: idempotencyKey,
              org_id: orgId,
              response: {},
              expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
            }
          });
        }
        let computedTotal = 0;
      const orderItemsData = [];
      const lowStockAlerts: string[] = [];

      for (const item of items) {
        if (item.qty <= 0) {
          throw new Error('Quantity must be greater than zero');
        }

        // Fetch product scoped to this org
        const product = await tx.product.findFirst({
          where: { id: item.product_id, org_id: orgId }
        });

        if (!product) {
          throw new Error(`Product not found or unauthorized (ID: ${item.product_id})`);
        }

        // Find a location with sufficient stock
        const inventory = await tx.inventoryLevel.findFirst({
          where: { product_id: product.id, stock_qty: { gte: item.qty } },
          orderBy: { stock_qty: 'desc' } // Auto-allocate from location with most stock
        });

        if (!inventory) {
          throw new Error(`Insufficient stock at any single location for product ${product.name}`);
        }

        try {
          const updatedInventory = await tx.inventoryLevel.update({
            where: { id: inventory.id, stock_qty: { gte: item.qty } },
            data: { stock_qty: { decrement: item.qty } }
          });
          
          if (updatedInventory.stock_qty <= updatedInventory.low_stock_threshold) {
            lowStockAlerts.push(product.id);
          }
        } catch (e: any) {
          if (e.code === 'P2025') {
            throw new Error(`Insufficient stock at any single location for product ${product.name} due to concurrent update`);
          }
          throw e;
        }

        const lineTotal = product.price * item.qty;
        computedTotal += lineTotal;

        orderItemsData.push({
          product_id: product.id,
          location_id: inventory.location_id,
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

      if (idempotencyKey) {
        await tx.idempotencyRecord.update({
          where: { org_id_key: { org_id: orgId, key: idempotencyKey } },
          data: { response: newOrder }
        });
      }

      return { order: newOrder, lowStockAlerts };
    });

    // Enqueue alerts outside the transaction so they don't fire on rollback
    for (const productId of order.lowStockAlerts) {
      await enqueueJob('lowStockAlert', { productId });
    }

    return res.status(201).json({ order: order.order });
  } catch (error: any) {
    const idempotencyKey = req.header('Idempotency-Key');
    const orgId = (req as any).orgId;
    if (error.code === 'P2002') {
      const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : String(error.meta?.target || '');
      if (idempotencyKey && (target.includes('key') || target.includes('PRIMARY'))) {
        const db = (req as any).db;
        const record = await db.idempotencyRecord.findUnique({ where: { org_id_key: { org_id: orgId, key: idempotencyKey } } });
        return res.status(201).json({ order: record.response });
      }
    }
    if ((error.code === 'P2024' || error.code === 'P2010') && idempotencyKey) {
      return res.status(409).json({ error: 'Request currently processing' });
    }
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
      try {
        const updated = await db.$transaction(async (tx: any) => {
          // Serialize access to prevent race conditions with DELETE
          const rows = await tx.$queryRaw`SELECT status, deleted_at FROM orders WHERE id = ${req.params.id} AND org_id = ${orgId} FOR UPDATE`;
          if (rows.length === 0 || rows[0].deleted_at !== null) {
            throw new Error('Order not found or already deleted');
          }
          if (rows[0].status === 'cancelled') {
            throw new Error('Order already cancelled');
          }

          await tx.order.update({
            where: { id: req.params.id },
            data: { status }
          });

          // Restock items
          for (const item of existing.items) {
            await tx.inventoryLevel.update({
              where: { product_id_location_id: { product_id: item.product_id, location_id: item.location_id } },
              data: { stock_qty: { increment: item.qty } }
            });
          }

          const resOrder = await tx.order.findUnique({ where: { id: req.params.id }, include: { items: true } });

          await createAuditEntry(tx, {
            orgId,
            actorId: currentUser.userId,
            action: 'ORDER_CANCELLED',
            targetId: req.params.id,
            details: { restocked_items_count: existing.items.length }
          });

          return resOrder;
        });

        if (redisConnection) {
          redisConnection.publish(
            `org_events:${orgId}`,
            JSON.stringify({ type: 'order_status', orderId: updated.id, status: updated.status })
          ).catch(err => console.error('[Orders] Redis publish error:', err));
        }

        return res.json({ order: updated });
      } catch (e: any) {
        return res.status(400).json({ error: e.message });
      }
    }

    const updated = await db.$transaction(async (tx: any) => {
      const resOrder = await tx.order.update({
        where: { id: req.params.id },
        data: { status }
      });
      return resOrder;
    });

    if (redisConnection) {
      redisConnection.publish(
        `org_events:${orgId}`,
        JSON.stringify({ type: 'order_status', orderId: updated.id, status: updated.status })
      ).catch(err => console.error('[Orders] Redis publish error:', err));
    }

    return res.json({ order: updated });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /orders/:id
ordersRouter.delete('/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const currentUser = (req as any).user;
    const orgId = (req as any).orgId;

    const existing = await db.order.findUnique({ 
      where: { id: req.params.id },
      include: { items: true }
    });
    if (!existing) return res.status(404).json({ error: 'Order not found' });

    await db.$transaction(async (tx: any) => {
      // Serialize access to prevent race conditions with PATCH /status
      const rows = await tx.$queryRaw`SELECT status, deleted_at FROM orders WHERE id = ${req.params.id} AND org_id = ${orgId} FOR UPDATE`;
      if (rows.length === 0 || rows[0].deleted_at !== null) {
        throw new Error('Order already deleted or not found');
      }

      await tx.order.update({
        where: { id: req.params.id },
        data: { deleted_at: new Date() }
      });

      // Restock items only if it wasn't ALREADY cancelled
      const currentStatus = rows[0].status;
      if (currentStatus !== 'cancelled') {
        for (const item of existing.items) {
          await tx.inventoryLevel.update({
            where: { product_id_location_id: { product_id: item.product_id, location_id: item.location_id } },
            data: { stock_qty: { increment: item.qty } }
          });
        }
      }

      await createAuditEntry(tx, {
        orgId,
        actorId: currentUser.userId,
        action: 'ORDER_DELETED',
        targetId: req.params.id,
        details: { restocked_items_count: currentStatus !== 'cancelled' ? existing.items.length : 0 }
      });
    });

    return res.status(200).json({ success: true });
  } catch (error: any) {
    console.error(error);
    return res.status(400).json({ error: error.message || 'Error deleting order' });
  }
});

