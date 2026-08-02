import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

test.describe('Critical Path: Signup -> Product -> Order -> Dashboard -> Stripe Redirect', () => {
  let uniqueEmail: string;

  test.beforeAll(async () => {
    // Generate a unique email for the test to prevent collisions
    uniqueEmail = `e2e-${Date.now()}@test.com`;
  });

  test.afterAll(async () => {
    // Clean up
    const user = await prisma.user.findUnique({ where: { email: uniqueEmail } });
    if (user) {
      const orgId = user.org_id;
      // Delete in order to satisfy FK constraints
      const orders = await prisma.order.findMany({ where: { org_id: orgId } });
      const orderIds = orders.map(o => o.id);
      await prisma.orderItem.deleteMany({ where: { order_id: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { org_id: orgId } });
      await prisma.product.deleteMany({ where: { org_id: orgId } });
      await prisma.user.deleteMany({ where: { org_id: orgId } });
      await prisma.organization.delete({ where: { id: orgId } });
    }
    await prisma.$disconnect();
  });

  test('completes full critical path', async ({ page }) => {
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    page.on('pageerror', err => console.log('BROWSER ERROR:', err.message));

    // 1. Signup
    await page.goto('/signup');
    await page.fill('input[type="text"]', 'E2E Org');
    await page.fill('input[type="email"]', uniqueEmail);
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    // Should show success message
    await expect(page.locator('.alert-success')).toContainText('Signup successful');

    // Manually verify email in DB to proceed
    await prisma.user.update({
      where: { email: uniqueEmail },
      data: { email_verified: true }
    });

    // 1b. Login
    await page.goto('/login');
    await page.fill('input[type="email"]', uniqueEmail);
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    // Should navigate to dashboard
    await expect(page).toHaveURL(/.*dashboard/);
    await expect(page.locator('h2')).toHaveText('Dashboard');

    // 2. Add Product
    await page.click('text=Products');
    await expect(page).toHaveURL(/.*products/);
    
    await page.click('text=Add Product');
    await page.fill('label:has-text("Name") + input', 'E2E Product');
    await page.fill('label:has-text("SKU") + input', 'E2E-SKU-1');
    await page.fill('label:has-text("Price") + input', '25.00'); // $25.00
    await page.fill('label:has-text("Initial Stock") + input', '10');
    await page.click('button:has-text("Save Product")');

    // Verify product shows up in table
    await expect(page.locator('table')).toContainText('E2E Product');
    await expect(page.locator('table')).toContainText('E2E-SKU-1');

    // 3. Create Order
    await page.click('text=Orders');
    await expect(page).toHaveURL(/.*orders/);

    await page.click('text=Create Order');
    await page.fill('label:has-text("Customer Name") + input', 'E2E Customer');
    // Product should be auto-selected (it's the only one)
    await page.fill('label:has-text("Quantity") + input', '2');
    await page.click('button:has-text("Submit Order")');

    // Verify order shows up
    await expect(page.locator('table')).toContainText('E2E Customer');
    await expect(page.locator('table')).toContainText('$50.00'); // 2 * $25.00

    // 4. Dashboard Check
    await page.click('nav >> text=Dashboard');
    await expect(page).toHaveURL(/.*dashboard/);

    // Verify revenue metric has updated server-side
    await expect(page.locator('.card:has-text("Revenue This Month") p.number-tabular')).toContainText('$50.00');

    // 5. Stripe Redirect (Stubbing API call)
    // Intercept the create-checkout-session call
    await page.route('**/billing/create-checkout-session', async route => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ url: '/dashboard?success=true' })
      });
    });

    await page.click('button:has-text("Upgrade to Pro")');
    // It should navigate to our mocked URL
    await expect(page).toHaveURL(/.*success=true/);
  });
});
