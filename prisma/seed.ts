import { PrismaClient, Plan, Role, OrderStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Clean DB
  await prisma.orderItem.deleteMany();
  await prisma.order.deleteMany();
  await prisma.product.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  const passwordHash = await bcrypt.hash('password123', 12);

  // --- Org 1: The Artisan Shop (Pro Plan) ---
  const org1 = await prisma.organization.create({
    data: {
      name: 'The Artisan Shop',
      plan: Plan.pro,
      subscription_status: 'active',
      users: {
        create: [
          { email: 'owner@artisan.com', password_hash: passwordHash, role: Role.owner },
          { email: 'staff@artisan.com', password_hash: passwordHash, role: Role.staff },
        ],
      },
      products: {
        create: [
          { name: 'Handmade Mug', sku: 'MUG-001', price: 1500, stock_qty: 20 },
          { name: 'Woven Basket', sku: 'BSK-002', price: 4500, stock_qty: 5 },
        ],
      },
    },
    include: { products: true, users: true },
  });

  // Create an order for Org 1
  await prisma.order.create({
    data: {
      org_id: org1.id,
      customer_name: 'Alice Johnson',
      status: OrderStatus.fulfilled,
      total: 1500,
      items: {
        create: [
          {
            product_id: org1.products[0].id,
            qty: 1,
            unit_price: 1500,
          },
        ],
      },
    },
  });

  // --- Org 2: Digital Prints (Free Plan) ---
  const org2 = await prisma.organization.create({
    data: {
      name: 'Digital Prints',
      plan: Plan.free,
      users: {
        create: [
          { email: 'owner@digitalprints.com', password_hash: passwordHash, role: Role.owner },
        ],
      },
      products: {
        create: [
          { name: 'Print A', sku: 'PRT-A', price: 500, stock_qty: 100 },
          { name: 'Print B', sku: 'PRT-B', price: 500, stock_qty: 100 },
        ],
      },
    },
    include: { products: true },
  });

  // Create an order for Org 2
  await prisma.order.create({
    data: {
      org_id: org2.id,
      customer_name: 'Bob Smith',
      status: OrderStatus.pending,
      total: 1000,
      items: {
        create: [
          {
            product_id: org2.products[0].id,
            qty: 1,
            unit_price: 500,
          },
          {
            product_id: org2.products[1].id,
            qty: 1,
            unit_price: 500,
          },
        ],
      },
    },
  });

  console.log('Seed execution completed successfully.');
  console.log(`Org 1 (${org1.name}) ID: ${org1.id}`);
  console.log(`Org 2 (${org2.name}) ID: ${org2.id}`);

  // --- Isolation Verification Check ---
  console.log('\nVerifying data isolation...');
  const org1Products = await prisma.product.findMany({ where: { org_id: org1.id } });
  const org2Products = await prisma.product.findMany({ where: { org_id: org2.id } });
  
  if (org1Products.some(p => p.org_id === org2.id) || org2Products.some(p => p.org_id === org1.id)) {
    throw new Error('CROSS-TENANT LEAK DETECTED IN SEED DATA!');
  }
  
  const org1Count = await prisma.product.count({ where: { org_id: org1.id } });
  if (org1Count !== 2) throw new Error('Org 1 product count mismatch');
  
  console.log('Isolation verification passed: no cross-contamination between orgs.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
