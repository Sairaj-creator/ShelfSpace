import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { prisma, scopedPrisma } from '../db';
import { Role } from '@prisma/client';

describe('Tenant Isolation Middleware (Layer 3)', () => {
  let orgAId: string;
  let orgBId: string;

  beforeEach(async () => {
    // Clean up all tables
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.user.deleteMany();
    await prisma.organization.deleteMany();

    const orgA = await prisma.organization.create({
      data: { name: 'Org A' }
    });
    orgAId = orgA.id;

    const orgB = await prisma.organization.create({
      data: { name: 'Org B' }
    });
    orgBId = orgB.id;

    // Seed some products
    await prisma.product.create({
      data: { name: 'Product A1', sku: 'A1', price: 1000, org_id: orgAId }
    });
    await prisma.product.create({
      data: { name: 'Product B1', sku: 'B1', price: 2000, org_id: orgBId }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('scopedPrisma should automatically inject org_id on create', async () => {
    const db = scopedPrisma(orgAId);
    
    // We intentionally omit org_id here. The type system might complain, 
    // but at runtime the extension injects it. To bypass typescript, we cast.
    const newProduct = await db.product.create({
      data: { name: 'Product A2', sku: 'A2', price: 1500 } as any
    });

    expect(newProduct.org_id).toBe(orgAId);
  });

  it('scopedPrisma should only return records for the scoped org', async () => {
    const dbA = scopedPrisma(orgAId);
    const dbB = scopedPrisma(orgBId);

    const productsA = await dbA.product.findMany();
    expect(productsA.length).toBe(1);
    expect(productsA[0].name).toBe('Product A1');

    const productsB = await dbB.product.findMany();
    expect(productsB.length).toBe(1);
    expect(productsB[0].name).toBe('Product B1');
  });

  it('scopedPrisma should overwrite a forged org_id on create', async () => {
    const dbA = scopedPrisma(orgAId);
    
    // Attempt to forge org_id to Org B
    const newProduct = await dbA.product.create({
      data: { name: 'Product A3', sku: 'A3', price: 1500, org_id: orgBId } as any
    });

    // It should have been overwritten to Org A
    expect(newProduct.org_id).toBe(orgAId);
    
    // Verify it actually saved to Org A in DB
    const dbProduct = await prisma.product.findUnique({ where: { id: newProduct.id } });
    expect(dbProduct!.org_id).toBe(orgAId);
  });

  it('scopedPrisma should prevent fetching a record from another org by ID', async () => {
    const dbA = scopedPrisma(orgAId);
    const productB = await prisma.product.findFirst({ where: { org_id: orgBId } });

    // When injecting org_id into findUnique, Prisma respects it and returns null
    // since the combination of id + org_id doesn't match the record.
    const fetched = await dbA.product.findUnique({ where: { id: productB!.id } });
    expect(fetched).toBeNull();
  });

  it('scopedPrisma should prevent updating a record from another org', async () => {
    const dbA = scopedPrisma(orgAId);
    const productB = await prisma.product.findFirst({ where: { org_id: orgBId } });

    await expect(
      dbA.product.update({
        where: { id: productB!.id },
        data: { price: 9999 }
      })
    ).rejects.toThrow();
  });

  it('scopedPrisma should prevent deleting a record from another org', async () => {
    const dbA = scopedPrisma(orgAId);
    const productB = await prisma.product.findFirst({ where: { org_id: orgBId } });

    await expect(
      dbA.product.delete({
        where: { id: productB!.id }
      })
    ).rejects.toThrow();
  });

  it('scopedPrisma should protect OrderItem operations via parent Order', async () => {
    // Setup orders for Org A and Org B
    const orderA = await prisma.order.create({ data: { customer_name: 'Customer A', total: 1000, org_id: orgAId } });
    const orderB = await prisma.order.create({ data: { customer_name: 'Customer B', total: 2000, org_id: orgBId } });

    const productB = await prisma.product.findFirst({ where: { org_id: orgBId } });
    const itemB = await prisma.orderItem.create({
      data: { order_id: orderB.id, product_id: productB!.id, qty: 1, unit_price: 2000 }
    });

    const dbA = scopedPrisma(orgAId);

    // 1. Fetching OrderItems should only return Org A's items
    const items = await dbA.orderItem.findMany();
    expect(items.length).toBe(0); // Org A has no items yet

    // 2. Fetching Org B's OrderItem directly by ID should be blocked (throw error)
    await expect(
      dbA.orderItem.findUnique({ where: { id: itemB.id } })
    ).rejects.toThrow('Unauthorized cross-tenant access to OrderItem');

    // 3. Trying to create an OrderItem under Org B's order using Org A's scopedPrisma
    await expect(
      dbA.orderItem.create({
        data: { order_id: orderB.id, product_id: productB!.id, qty: 5, unit_price: 100 }
      })
    ).rejects.toThrow('Unauthorized cross-tenant access to Order');

    // 4. Forged order_id: Attempting to sneak an OrderItem into Org B's order
    // This confirms the failure mode is a rejection/throw, not a silent failure.
    await expect(
      dbA.orderItem.create({
        data: { order_id: orderB.id, product_id: productB!.id, qty: 1, unit_price: 100 }
      })
    ).rejects.toThrow('Unauthorized cross-tenant access to Order');
  });
});
