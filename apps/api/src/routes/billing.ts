import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/tenant';
import { requireRole } from '../middleware/role';
import { Role } from '@prisma/client';
import { prisma } from '../db';
import { stripe } from '../lib/stripe';
import Stripe from 'stripe';

export const billingRouter = Router();

// Webhook endpoint MUST bypass requireAuth
billingRouter.post('/webhook', async (req: Request, res: Response): Promise<any> => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET environment variable is missing');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  let event;
  try {
    // req.body is a Buffer because of express.raw() in app.ts
    event = stripe.webhooks.constructEvent(req.body, sig as string, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.client_reference_id;
        const customerId = session.customer as string;

        if (orgId) {
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
        if (!org) {
          console.warn(`Webhook: Unknown customer ${customerId} for invoice.paid`);
          break;
        }

        await prisma.organization.update({
          where: { id: org.id },
          data: { subscription_status: 'active' },
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        const org = await prisma.organization.findFirst({ where: { stripe_customer_id: customerId } });
        if (!org) {
          console.warn(`Webhook: Unknown customer ${customerId} for invoice.payment_failed`);
          break;
        }

        await prisma.organization.update({
          where: { id: org.id },
          data: { subscription_status: 'past_due' },
        });
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        const org = await prisma.organization.findFirst({ where: { stripe_customer_id: customerId } });
        if (!org) {
          console.warn(`Webhook: Unknown customer ${customerId} for customer.subscription.deleted`);
          break;
        }

        await prisma.organization.update({
          where: { id: org.id },
          data: { plan: 'free', subscription_status: 'canceled' },
        });
        break;
      }
    }

    // Return a 200 response to acknowledge receipt of the event
    return res.json({ received: true });
  } catch (error) {
    console.error(`Webhook processing error:`, error);
    // Return 200 even on processing errors if they shouldn't trigger endless retries.
    // In production, we might want a dead-letter queue.
    return res.status(200).json({ error: 'Processing failed, but acknowledged' });
  }
});

billingRouter.use(requireAuth);
billingRouter.use(requireRole(Role.owner));

// POST /billing/create-checkout-session
billingRouter.post('/create-checkout-session', async (req: Request, res: Response): Promise<any> => {
  try {
    const orgId = (req as any).orgId;
    const priceId = process.env.STRIPE_PRO_PRICE_ID;
    if (!priceId) {
      console.error('STRIPE_PRO_PRICE_ID is missing');
      return res.status(500).json({ error: 'STRIPE_PRO_PRICE_ID is not configured' });
    }
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${frontendUrl}/dashboard?success=true`,
      cancel_url: `${frontendUrl}/dashboard?canceled=true`,
      client_reference_id: orgId, // CRITICAL: This links the checkout to our org
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// GET /billing/subscription
billingRouter.get('/subscription', async (req: Request, res: Response): Promise<any> => {
  try {
    const orgId = (req as any).orgId;
    
    // Unscoped raw query to fetch org subscription details
    const org = await prisma.organization.findUnique({ where: { id: orgId } });
    
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    return res.json({ 
      plan: org.plan, 
      status: org.subscription_status 
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
