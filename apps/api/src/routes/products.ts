import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/tenant';
import { Role } from '@prisma/client';
import { prisma } from '../db';

export const productsRouter = Router();

productsRouter.use(requireAuth);

import { requireRole } from '../middleware/role';

// GET /products
productsRouter.get('/', async (req: Request, res: Response): Promise<any> => {
  try {
    const db = (req as any).db;
    const products = await db.product.findMany({
      orderBy: { created_at: 'desc' }
    });
    return res.json({ products });
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
        sku,
        price,
        stock_qty: stock_qty || 0,
        low_stock_threshold: low_stock_threshold !== undefined ? low_stock_threshold : 5,
      }
    });

    return res.status(201).json({ product });
  } catch (error) {
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

    const product = await db.product.update({
      where: { id: req.params.id },
      data: {
        name: name !== undefined ? name : existing.name,
        sku: sku !== undefined ? sku : existing.sku,
        price: price !== undefined ? price : existing.price,
        stock_qty: stock_qty !== undefined ? stock_qty : existing.stock_qty,
        low_stock_threshold: low_stock_threshold !== undefined ? low_stock_threshold : existing.low_stock_threshold,
      }
    });

    return res.json({ product });
  } catch (error) {
    console.error(error);
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
