import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/tenant';
import { Role } from '@prisma/client';
import { prisma } from '../db';
import { createAuditEntry } from '../services/audit';
import { formatRowToCsv, sanitizeCsvCell } from '../utils/csv';

export const productsRouter = Router();

productsRouter.use(requireAuth);

import { requireRole } from '../middleware/role';

// GET /products
productsRouter.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const pageParam = req.query.page as string;
    const limitParam = req.query.limit as string;
    const search = ((req.query.search as string) || '').trim();

    if (!pageParam && !limitParam && !search) {
      const products = await db.product.findMany({
        orderBy: { created_at: 'desc' }
      });
      return res.json({ products });
    }

    const page = Math.max(1, parseInt(pageParam || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(limitParam || '20', 10)));
    const skip = (page - 1) * limit;

    const where: any = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { sku: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [products, total] = await Promise.all([
      db.product.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      db.product.count({ where }),
    ]);

    return res.json({
      products,
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

// GET /products/export (OWASP-sanitized CSV export)
productsRouter.get('/export', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const products = await db.product.findMany({
      orderBy: { created_at: 'desc' },
    });

    const header = ['ID', 'Name', 'SKU', 'Price ($)', 'Stock Qty', 'Low Stock Threshold', 'Created At'];
    const rows = products.map((p: any) => [
      p.id,
      p.name,
      p.sku,
      (p.price / 100).toFixed(2),
      p.stock_qty,
      p.low_stock_threshold,
      p.created_at.toISOString(),
    ]);

    const csvContent = [formatRowToCsv(header), ...rows.map(formatRowToCsv)].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="products_inventory.csv"');
    return res.status(200).send(csvContent);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /products/:id
productsRouter.get('/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const product = await db.product.findUnique({
      where: { id: req.params.id }
    });
    if (!product) return res.status(404).json({ error: 'Product not found' });
    return res.json({ product });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /products
productsRouter.post('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const { name, sku, price, stock_qty, low_stock_threshold } = req.body;
    
    if (!name || !sku || price === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (stock_qty !== undefined && stock_qty < 0) {
      return res.status(400).json({ error: 'Stock quantity cannot be negative' });
    }

    const orgId = (req as any).orgId;
    const org = await prisma.organization.findUnique({ where: { id: orgId } });

    if (org?.plan === 'free') {
      const productCount = await db.product.count();
      if (productCount >= 25) {
        return res.status(403).json({ error: 'Free plan limit reached. Please upgrade to Pro.' });
      }
    }

    const product = await db.product.create({
      data: {
        name,
        sku: String(sku).trim().toUpperCase(),
        price,
        stock_qty: stock_qty || 0,
        low_stock_threshold: low_stock_threshold !== undefined ? low_stock_threshold : 5,
      }
    });

    return res.status(201).json({ product });
  } catch (error: any) {
    console.error(error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'A product with this SKU already exists' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /products/bulk (Bulk import CSV payload)
productsRouter.post('/bulk', async (req: Request, res: Response): Promise<any> => {
  try {
    const orgId = (req as any).orgId;
    const db = (req as any).db;
    const currentUser = (req as any).user;
    const { products } = req.body;

    if (!products || !Array.isArray(products) || products.length === 0) {
      return res.status(400).json({ error: 'Missing or empty products array' });
    }

    if (products.length > 1000) {
      return res.status(400).json({ error: 'Bulk upload exceeds maximum batch limit of 1,000 products' });
    }

    // 1. In-file duplicate SKU pre-validation
    const skuMap = new Map<string, number>();
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      if (!p.name || !p.sku || p.price === undefined || p.price < 0) {
        return res.status(400).json({ error: `Invalid product data at row ${i + 1}. Name, SKU, and positive Price are required.` });
      }
      const normalizedSku = String(p.sku).trim().toUpperCase();
      if (skuMap.has(normalizedSku)) {
        const firstRow = skuMap.get(normalizedSku)!;
        return res.status(400).json({
          error: `Duplicate SKU '${p.sku}' found in CSV at row ${firstRow + 1} and row ${i + 1}. SKUs must be unique within the file.`,
        });
      }
      skuMap.set(normalizedSku, i);
    }

    // 2. Free plan cap pre-validation
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    const currentCount = await prisma.product.count({ where: { org_id: orgId } });

    if (org?.plan === 'free' && currentCount + products.length > 25) {
      const allowed = Math.max(0, 25 - currentCount);
      return res.status(400).json({
        error: `Bulk import of ${products.length} products exceeds free plan limit of 25 products (currently at ${currentCount}). You can only add ${allowed} more product(s). Upgrade to Pro for unlimited products.`,
      });
    }

    // 3. Atomic batch insert & audit logging
    const createdProducts = await db.$transaction(async (tx: any) => {
      const inserted = [];
      for (const item of products) {
        const p = await tx.product.create({
          data: {
            org_id: orgId,
            name: String(item.name).trim(),
            sku: String(item.sku).trim().toUpperCase(),
            price: Math.round(Number(item.price)),
            stock_qty: item.stock_qty !== undefined ? Number(item.stock_qty) : 0,
            low_stock_threshold: item.low_stock_threshold !== undefined ? Number(item.low_stock_threshold) : 5,
          } as any,
        });
        inserted.push(p);
      }

      await createAuditEntry(tx, {
        orgId,
        actorId: currentUser.userId,
        action: 'BULK_PRODUCTS_IMPORTED',
        details: { count: inserted.length },
      });

      return inserted;
    });

    return res.status(201).json({ created_count: createdProducts.length, products: createdProducts });
  } catch (error: any) {
    console.error(error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'One or more SKUs already exist in your product catalog' });
    }
    return res.status(500).json({ error: error.message || 'Internal server error during bulk import' });
  }
});

// PUT /products/:id
productsRouter.put('/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const { name, sku, price, stock_qty, low_stock_threshold } = req.body;
    
    // verify exists
    const existing = await db.product.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    if (stock_qty !== undefined && stock_qty < 0) {
      return res.status(400).json({ error: 'Stock quantity cannot be negative' });
    }

    const currentUser = (req as any).user;
    const orgId = (req as any).orgId;

    const isStockEdited = stock_qty !== undefined && stock_qty !== existing.stock_qty;

    const product = await db.$transaction(async (tx: any) => {
      const updated = await tx.product.update({
        where: { id: req.params.id },
        data: {
          name: name !== undefined ? name : existing.name,
          sku: sku !== undefined ? String(sku).trim().toUpperCase() : existing.sku,
          price: price !== undefined ? price : existing.price,
          stock_qty: stock_qty !== undefined ? stock_qty : existing.stock_qty,
          low_stock_threshold: low_stock_threshold !== undefined ? low_stock_threshold : existing.low_stock_threshold,
        } as any
      });

      if (isStockEdited) {
        await createAuditEntry(tx, {
          orgId,
          actorId: currentUser.userId,
          action: 'STOCK_UPDATED',
          targetId: req.params.id,
          details: { old_stock: existing.stock_qty, new_stock: stock_qty }
        });
      }

      return updated;
    });

    return res.json({ product });
  } catch (error: any) {
    console.error(error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'A product with this SKU already exists' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /products/:id
productsRouter.delete('/:id', requireRole(Role.owner), async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const existing = await db.product.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: 'Product not found' });

    await db.product.delete({
      where: { id: req.params.id }
    });

    return res.json({ success: true });
  } catch (error: any) {
    console.error(error);
    if (error.code === 'P2003') {
      return res.status(400).json({ error: 'Cannot delete product because it has existing orders' });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
});
