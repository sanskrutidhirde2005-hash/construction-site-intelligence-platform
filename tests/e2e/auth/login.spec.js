import { test, expect } from '@playwright/test';
import { AppShell } from '../pages/AppShell.js';

test.describe('Login', () => {
  test('renders the sign-in form with demo entry', async ({ page }) => {
    const app = new AppShell(page);
    await app.goto();

    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.getByPlaceholder('Enter your email')).toBeVisible();
    await expect(page.getByPlaceholder('Enter your password')).toBeVisible();
    await expect(page.getByRole('button', { name: /explore demo/i })).toBeVisible();
  });

  test('empty credentials stay on the login page', async ({ page }) => {
    const app = new AppShell(page);
    await app.goto();

    await page.getByRole('button', { name: /^sign in/i }).click();

    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
    await expect(page.locator('aside.sidebar')).toHaveCount(0);
  });

  test('demo login lands on the dashboard', async ({ page }) => {
    const app = new AppShell(page);
    await app.demoLogin();

    await expect(page.locator('aside.sidebar')).toBeVisible();
    await expect(page.locator('.stats-grid')).toBeVisible();
  });

  test('logout returns to the login page', async ({ page }) => {
    const app = new AppShell(page);
    await app.demoLogin();
    await app.logout();
  });
});
