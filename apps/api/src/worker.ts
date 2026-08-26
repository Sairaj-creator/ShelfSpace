import { Worker, Job } from 'bullmq';
import { redisConnection } from './lib/redis';
import { prisma } from './db';
import { createAuditEntry } from './services/audit';
import Stripe from 'stripe';

export async function processJobInline(name: string, data: any) {
  switch (name) {
    case 'sendEmail': {
      // Simulate sending email
      console.log(`[Worker] Sending email to ${data.to}: ${data.subject}`);
      break;
    }
    case 'stripeWebhook': {
      // Handle stripe webhook logic here
      const event = data.event;
      try {
        switch (event.type) {
          case 'checkout.session.completed': {
            const session = event.data.object as Stripe.Checkout.Session;
            const orgId = session.client_reference_id;
            const customerId = session.customer as string;

            if (orgId) {
              // Idempotent update
              await prisma.organization.update({
                where: { id: orgId },
                data: {
                  stripe_customer_id: customerId,
                  plan: 'pro',
                  subscription_status: 'active',
                },
              });
            }
            break;
          }

          case 'invoice.paid': {
            const invoice = event.data.object as Stripe.Invoice;
            const customerId = invoice.customer as string;

            const org = await prisma.organization.findFirst({ where: { stripe_customer_id: customerId } });
            if (org) {
              await prisma.organization.update({
                where: { id: org.id },
                data: { subscription_status: 'active' },
              });
            }
            break;
          }

          case 'invoice.payment_failed': {
            const invoice = event.data.object as Stripe.Invoice;
            const customerId = invoice.customer as string;

            const org = await prisma.organization.findFirst({ where: { stripe_customer_id: customerId } });
            if (org) {
              await prisma.organization.update({
                where: { id: org.id },
                data: { subscription_status: 'past_due' },
              });
            }
            break;
          }

          case 'customer.subscription.deleted': {
            const subscription = event.data.object as Stripe.Subscription;
            const customerId = subscription.customer as string;

            const org = await prisma.organization.findFirst({ where: { stripe_customer_id: customerId } });
            if (org) {
              await prisma.organization.update({
                where: { id: org.id },
                data: { plan: 'free', subscription_status: 'canceled' },
              });
            }
            break;
          }
        }
      } catch (err) {
        console.error('[Worker] Stripe Webhook error:', err);
        throw err;
      }
      break;
    }
    case 'lowStockAlert': {
      const { productId } = data;
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          inventory_levels: true,
          organization: {
            include: {
              users: {
                where: { role: { in: ['owner', 'admin'] } },
              }
            }
          }
        }
      });
      if (product) {
        const lowStockLevels = product.inventory_levels.filter((il: any) => il.stock_qty <= il.low_stock_threshold);
        if (lowStockLevels.length > 0) {
          for (const user of product.organization.users) {
            console.log(`[Worker] Low stock alert for ${product.name} (SKU: ${product.sku}) sent to ${user.email}`);
          }
          // Publish real-time SSE event for the organization
          if (redisConnection) {
            redisConnection.publish(
              `org_events:${product.org_id}`,
              JSON.stringify({ type: 'low_stock', productId: product.id, name: product.name, sku: product.sku })
            ).catch(err => console.error('[Worker] Redis publish error:', err));
          }
        }
      }
      break;
    }
    case 'csvImport': {
      const { orgId, userId, idempotencyKey, products } = data;
      try {
        const org = await prisma.organization.findUnique({ where: { id: orgId } });
        
        const createdProducts = await prisma.$transaction(async (tx: any) => {
          if (org?.plan === 'free') {
            await tx.$executeRaw`SELECT id FROM organizations WHERE id = ${orgId} FOR UPDATE`;
            const currentCount = await tx.product.count({ where: { org_id: orgId } });
            if (currentCount + products.length > 25) {
              const allowed = Math.max(0, 25 - currentCount);
              throw new Error(`FREE_PLAN_BULK_LIMIT|${allowed}|${currentCount}|${products.length}`);
            }
          }

          const inserted = [];
          for (let i = 0; i < products.length; i++) {
            const item = products[i];
            const location = await tx.location.findFirst({
              where: { org_id: orgId },
              orderBy: { created_at: 'asc' }
            });

            const p = await tx.product.create({
              data: {
                org_id: orgId,
                name: item.name,
                sku: String(item.sku).trim().toUpperCase(),
                price: Number(item.price),
                inventory_levels: location ? {
                  create: {
                    location_id: location.id,
                    stock_qty: item.stock_qty !== undefined ? Number(item.stock_qty) : 0,
                    low_stock_threshold: item.low_stock_threshold !== undefined ? Number(item.low_stock_threshold) : 5,
                  }
                } : undefined
              }
            });
            inserted.push(p);

            if (redisConnection && ((i + 1) % 10 === 0 || i === products.length - 1)) {
              redisConnection.publish(
                `org_events:${orgId}`,
                JSON.stringify({ type: 'bulk_import_progress', progress: Math.round(((i + 1) / products.length) * 100) })
              ).catch(err => console.error(err));
            }
          }

          await createAuditEntry(tx, {
            orgId,
            actorId: userId,
            action: 'BULK_PRODUCTS_IMPORTED',
            details: { count: inserted.length },
          });

          if (idempotencyKey) {
            await tx.idempotencyRecord.update({
              where: { org_id_key: { org_id: orgId, key: idempotencyKey } },
              data: { response: { status: 'completed', created_count: inserted.length, products: inserted } }
            });
          }

          return inserted;
        });

        if (redisConnection) {
          redisConnection.publish(
            `org_events:${orgId}`,
            JSON.stringify({ type: 'bulk_import_completed', count: createdProducts.length })
          ).catch(err => console.error(err));
        }
      } catch (error: any) {
        console.error('[Worker] CSV Import failed:', error);
        
        let errorMessage = error.message;
        if (error.code === 'P2002') {
          errorMessage = 'One or more SKUs already exist in your product catalog';
        } else if (errorMessage?.startsWith('FREE_PLAN_BULK_LIMIT')) {
          const [_, allowed, current, length] = errorMessage.split('|');
          errorMessage = `Bulk import of ${length} products exceeds free plan limit of 25 products (currently at ${current}). You can only add ${allowed} more product(s). Upgrade to Pro for unlimited products.`;
        }

        if (idempotencyKey) {
          try {
            await prisma.idempotencyRecord.update({
              where: { org_id_key: { org_id: orgId, key: idempotencyKey } },
              data: { response: { status: 'failed', error: errorMessage } }
            });
          } catch (updateErr) {
            console.error('[Worker] Failed to update idempotency record on error', updateErr);
          }
        }
        
        if (redisConnection) {
          redisConnection.publish(
            `org_events:${orgId}`,
            JSON.stringify({ type: 'bulk_import_failed', error: errorMessage })
          ).catch(err => console.error(err));
        }
      }
      break;
    }
    default:
      console.warn(`[Worker] Unknown job type: ${name}`);
  }
}

// Don't initialize BullMQ worker during tests to avoid connecting to redis
export let worker: Worker | null = null;

if (process.env.NODE_ENV !== 'test') {
  worker = new Worker(
    'jobsQueue',
    async (job: Job) => {
      console.log(`[Worker] Processing job ${job.id} of type ${job.name}`);
      await processJobInline(job.name, job.data);
    },
    {
      connection: redisConnection,
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed successfully`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err);
  });
}
