import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/tenant';
import { Role } from '@prisma/client';
import { prisma } from '../db';
import { createAuditEntry } from '../services/audit';
import { formatRowToCsv, sanitizeCsvCell } from '../utils/csv';
import { enqueueJob } from '../lib/queue';

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
      const rawProducts = await db.product.findMany({
        orderBy: { created_at: 'desc' },
        include: { inventory_levels: true }
      });
      const products = rawProducts.map((p: any) => {
        p.stock_qty = p.inventory_levels.reduce((sum: number, il: any) => sum + il.stock_qty, 0);
        return p;
      });
      return res.json({ products });
    }

    const page = Math.max(1, parseInt(pageParam || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(limitParam || '20', 10)));
    const skip = (page - 1) * limit;

    const where: any = {};

    if (search && search.trim()) {
      const terms = search.trim().replace(/[^\w\s-]/g, '').split(/\s+/).filter(Boolean);
      const formattedSearch = terms.map(t => `${t}:*`).join(' | ');

      if (formattedSearch) {
        const matchingProducts: any[] = await prisma.$queryRaw`
          SELECT id FROM products 
          WHERE org_id = ${(req as any).user.orgId} 
            AND deleted_at IS NULL 
            AND search_vector @@ to_tsquery('english', ${formattedSearch})
        `;
        const matchingIds = matchingProducts.map((p: any) => p.id);
        where.id = { in: matchingIds };
      }
    }

    const [products, total] = await Promise.all([
      db.product.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: { inventory_levels: true }
      }),
      db.product.count({ where }),
    ]);

    const mappedProducts = products.map((p: any) => {
      p.stock_qty = p.inventory_levels.reduce((sum: number, il: any) => sum + il.stock_qty, 0);
      return p;
    });

    return res.json({
      products: mappedProducts,
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

// GET /products/export (OWASP-sanitized CSV export, chunked streaming)
productsRouter.get('/export', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="products_inventory.csv"');

    const header = ['ID', 'Name', 'SKU', 'Price ($)', 'Stock Qty', 'Low Stock Threshold', 'Created At'];
    res.write(formatRowToCsv(header) + '\n');

    let cursor = undefined;
    while (true) {
      const chunk: any[] = await db.product.findMany({
        take: 1000,
        skip: cursor ? 1 : 0,
        ...(cursor ? { cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        include: { inventory_levels: true }
      });
      
      if (chunk.length === 0) break;

      for (const p of chunk) {
        const row = [
          p.id,
          p.name,
          p.sku,
          (p.price / 100).toFixed(2),
          p.inventory_levels.reduce((sum: number, il: any) => sum + il.stock_qty, 0),
          p.inventory_levels.length > 0 ? Math.max(...p.inventory_levels.map((il: any) => il.low_stock_threshold)) : 0,
          p.created_at.toISOString(),
        ];
        res.write(formatRowToCsv(row) + '\n');
      }
      
      cursor = chunk[chunk.length - 1].id;
    }
    
    res.end();
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /products/:id
productsRouter.get('/:id', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const product: any = await db.product.findUnique({
      where: { id: req.params.id },
      include: { inventory_levels: true }
    });

    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }

    product.stock_qty = product.inventory_levels.reduce((sum: number, il: any) => sum + il.stock_qty, 0);
    product.low_stock_threshold = product.inventory_levels.length > 0 ? Math.max(...product.inventory_levels.map((il: any) => il.low_stock_threshold)) : 0;

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

    const product = await db.$transaction(async (tx: any) => {
      if (org?.plan === 'free') {
        await tx.$executeRaw`SELECT id FROM organizations WHERE id = ${orgId} FOR UPDATE`;
        const productCount = await tx.product.count();
        if (productCount >= 25) {
          throw new Error('FREE_PLAN_LIMIT');
        }
      }

      const location = await tx.location.findFirst({
        where: { org_id: orgId },
        orderBy: { created_at: 'asc' }
      });

      return await tx.product.create({
        data: {
          name,
          sku: String(sku).trim().toUpperCase(),
          price,
          inventory_levels: location ? {
            create: {
              location_id: location.id,
              stock_qty: stock_qty || 0,
              low_stock_threshold: low_stock_threshold !== undefined ? low_stock_threshold : 5,
            }
          } : undefined
        },
        include: { inventory_levels: true }
      });
    });

    return res.status(201).json({ 
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        price: product.price,
        stock_qty: product.inventory_levels.reduce((sum: number, il: any) => sum + il.stock_qty, 0),
        low_stock_threshold: product.inventory_levels.length > 0 ? Math.max(...product.inventory_levels.map((il: any) => il.low_stock_threshold)) : 0,
        created_at: product.created_at,
        deleted_at: product.deleted_at
      }
    });
  } catch (error: any) {
    console.error(error);
    if (error.message === 'FREE_PLAN_LIMIT') {
      return res.status(403).json({ error: 'Free plan limit reached. Please upgrade to Pro.' });
    }
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

    const idempotencyKey = req.header('Idempotency-Key');
    const jobId = 'job_' + Date.now() + Math.random().toString(36).substring(7);
    const initialResponse = { status: 'accepted', jobId, message: 'Import queued successfully' };

    if (idempotencyKey) {
      try {
        await db.idempotencyRecord.create({
          data: {
            key: idempotencyKey,
            org_id: orgId,
            response: initialResponse,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
          }
        });
      } catch (error: any) {
        if (error.code === 'P2002') {
          // It already exists. Just fetch and return the cached 202 response.
          const record = await db.idempotencyRecord.findUnique({
            where: { org_id_key: { org_id: orgId, key: idempotencyKey } }
          });
          return res.status(202).json(record?.response || initialResponse);
        }
        throw error;
      }
    }

    // Now we enqueue the job
    await enqueueJob('csvImport', {
      orgId,
      userId: currentUser.userId,
      idempotencyKey,
      products
    }, { jobId });

    return res.status(202).json(initialResponse);
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
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

    const isStockEdited = stock_qty !== undefined;

    const product = await db.$transaction(async (tx: any) => {
      const updatedProduct = await tx.product.update({
        where: { id: req.params.id },
        data: {
          name: name !== undefined ? name : existing.name,
          sku: sku !== undefined ? String(sku).trim().toUpperCase() : existing.sku,
          price: price !== undefined ? price : existing.price,
        },
        include: { inventory_levels: true }
      });

      // For Tier 2, stock adjustments should be done via Inventory routes.
      // But for backwards compatibility, if stock_qty is passed, update the first location.
      if (isStockEdited || low_stock_threshold !== undefined) {
        const firstInventory = await tx.inventoryLevel.findFirst({
          where: { product_id: req.params.id },
          orderBy: { location: { created_at: 'asc' } }
        });

        if (firstInventory) {
          const oldStock = firstInventory.stock_qty;
          const actualStockEdited = isStockEdited && stock_qty !== oldStock;

          await tx.inventoryLevel.update({
            where: { id: firstInventory.id },
            data: {
              stock_qty: stock_qty !== undefined ? stock_qty : firstInventory.stock_qty,
              low_stock_threshold: low_stock_threshold !== undefined ? low_stock_threshold : firstInventory.low_stock_threshold
            }
          });
          
          // Re-fetch with updated inventory levels
          const finalProduct = await tx.product.findUnique({
            where: { id: req.params.id },
            include: { inventory_levels: true }
          });
          Object.assign(updatedProduct, finalProduct);

          if (actualStockEdited) {
            await createAuditEntry(tx, {
              orgId,
              actorId: currentUser.userId,
              action: 'STOCK_UPDATED',
              targetId: updatedProduct.id,
              details: { old_stock: oldStock, new_stock: stock_qty }
            });
          }
        }
      }

      return updatedProduct;
    });

    return res.json({ 
      product: {
        id: product.id,
        name: product.name,
        sku: product.sku,
        price: product.price,
        stock_qty: product.inventory_levels.reduce((sum: number, il: any) => sum + il.stock_qty, 0),
        low_stock_threshold: product.inventory_levels.length > 0 ? Math.max(...product.inventory_levels.map((il: any) => il.low_stock_threshold)) : 0,
        created_at: product.created_at,
        deleted_at: product.deleted_at
      }
    });
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
    
    const updateCount = await db.product.updateMany({
      where: { id: req.params.id, deleted_at: null },
      data: { deleted_at: new Date() }
    });

    if (updateCount.count === 0) {
      return res.status(404).json({ error: 'Product not found or already deleted' });
    }

    return res.json({ success: true });
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
