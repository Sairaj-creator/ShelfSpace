import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/tenant';
import { prisma } from '../db';

export const dashboardRouter = Router();

const LOW_STOCK_THRESHOLD = 5; // Products with stock below this threshold trigger alerts

dashboardRouter.get('/metrics', requireAuth, async (req: Request, res: Response) => {
  const orgId = req.orgId!;
  
  // 1. Fetch Org details for banner
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: {
      plan: true,
      subscription_status: true,
    }
  });

  if (!org) {
    return res.status(404).json({ error: 'Organization not found' });
  }

  // 2. Fetch Low Stock Products
  const lowStockProducts = await prisma.product.findMany({
    where: {
      org_id: orgId,
      stock_qty: {
        lt: LOW_STOCK_THRESHOLD
      }
    },
    select: {
      id: true,
      name: true,
      sku: true,
      stock_qty: true
    },
    orderBy: {
      stock_qty: 'asc'
    }
  });

  // 3. Aggregate Revenue for current month
  // We only count orders that are pending or fulfilled, explicitly excluding cancelled ones.
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const revenueAggregate = await prisma.order.aggregate({
    where: {
      org_id: orgId,
      created_at: {
        gte: startOfMonth
      },
      status: {
        in: ['pending', 'fulfilled']
      }
    },
    _sum: {
      total: true
    }
  });

  const revenueCents = revenueAggregate._sum.total || 0;

  res.json({
    plan: org.plan,
    subscription_status: org.subscription_status,
    low_stock_products: lowStockProducts,
    revenue_cents: revenueCents
  });
});
