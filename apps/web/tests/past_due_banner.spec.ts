import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

const prisma = new PrismaClient();

test.describe('Dashboard Warning Banner', () => {
  let uniqueEmail: string;

  test.beforeAll(async () => {
    uniqueEmail = `pastdue-${Date.now()}@test.com`;

    // 1. Seed the database directly to place an org in `subscription_status: 'past_due'`
    const org = await prisma.organization.create({
      data: {
        name: 'Past Due Org',
        plan: 'pro',
        subscription_status: 'past_due'
      }
    });

    const passwordHash = await hash('password123', 10);

    await prisma.user.create({
      data: {
        org_id: org.id,
        email: uniqueEmail,
        password_hash: passwordHash,
        role: 'owner'
      }
    });
  });

  test.afterAll(async () => {
    // Clean up
    const user = await prisma.user.findUnique({ where: { email: uniqueEmail } });
    if (user) {
      await prisma.organization.delete({ where: { id: user.org_id } });
    }
    await prisma.$disconnect();
  });

  test('renders the past_due warning banner', async ({ page }) => {
    // 2. Login
    await page.goto('/login');
    await page.fill('input[type="email"]', uniqueEmail);
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    // 3. Navigate to Dashboard and assert warning banner
    await expect(page).toHaveURL(/.*dashboard/);
    await expect(page.locator('.alert-warning')).toContainText('Your subscription is past due');
  });
});
