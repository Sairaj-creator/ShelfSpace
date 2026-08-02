import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/tenant';
import { prisma } from '../db';

export const dashboardRouter = Router();

dashboardRouter.get('/metrics', requireAuth, async (req: Request, res: Response) => {
  const orgId = req.orgId!;
  const db = (req as any).db;
  
  // 1. Fetch Org details for banner
  const org = await db.organization.findUnique({
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
  // Fetch all products for the org and filter in JS because Prisma cannot compare two columns directly
  const allProducts = await db.product.findMany({
    select: {
      id: true,
      name: true,
      sku: true,
      stock_qty: true,
      low_stock_threshold: true,
    }
  });

  const lowStockProducts = allProducts
    .filter(p => p.stock_qty < p.low_stock_threshold)
    .sort((a, b) => a.stock_qty - b.stock_qty);

  // 3. Aggregate Revenue for current month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const revenueAggregate = await db.order.aggregate({
    where: {
      org_id: orgId,
      created_at: { gte: startOfMonth },
      status: { in: ['pending', 'fulfilled'] }
    },
    _sum: { total: true }
  });

  const revenueCents = revenueAggregate._sum.total || 0;

  // 4. Daily Revenue for last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  thirtyDaysAgo.setHours(0, 0, 0, 0);

  const rawDailyRevenue = await db.$queryRaw<
    Array<{ date: Date; revenue_cents: bigint }>
  >`
    SELECT date_trunc('day', created_at) as date, SUM(total) as revenue_cents
    FROM orders
    WHERE org_id = ${orgId}
      AND created_at >= ${thirtyDaysAgo}
      AND status IN ('pending', 'fulfilled')
    GROUP BY date
    ORDER BY date ASC
  `;

  // Zero-fill the 30-day series
  const daily_revenue = [];
  const rawDataMap = new Map(
    rawDailyRevenue.map(row => [
      row.date.toISOString().split('T')[0],
      Number(row.revenue_cents) // Critical: convert bigint to number for JSON serialization
    ])
  );

  for (let i = 0; i < 30; i++) {
    const d = new Date(thirtyDaysAgo);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    
    daily_revenue.push({
      date: dateStr,
      revenue_cents: rawDataMap.get(dateStr) || 0
    });
  }

  res.json({
    plan: org.plan,
    subscription_status: org.subscription_status,
    low_stock_products: lowStockProducts,
    revenue_cents: revenueCents,
    daily_revenue
  });
});
