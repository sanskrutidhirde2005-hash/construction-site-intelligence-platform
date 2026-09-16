import { test, expect } from '@playwright/test';
import { AppShell } from '../pages/AppShell.js';

test.describe('Sidebar navigation (Project Manager)', () => {
  test.beforeEach(async ({ page }) => {
    await new AppShell(page).demoLogin();
  });

  const sections = [
    { nav: 'Projects', probe: (page) => page.getByPlaceholder('Search projects...') },
    { nav: 'Daily Updates', probe: (page) => page.getByRole('heading', { name: 'Daily Updates' }) },
    {
      nav: 'Past Projects & Maintenance',
      probe: (page) => page.getByRole('heading', { name: 'Past Projects & Maintenance' }),
    },
    { nav: 'SiteVision AI', probe: (page) => page.getByRole('heading', { name: 'SiteVision AI' }) },
    { nav: 'Risk & Alerts', probe: (page) => page.getByRole('heading', { name: 'Risk & Alerts' }) },
    { nav: 'GenAI Assistant', probe: (page) => page.getByRole('heading', { name: 'GenAI Assistant' }) },
  ];

  for (const { nav, probe } of sections) {
    test(`navigates to ${nav}`, async ({ page }) => {
      await new AppShell(page).navigate(nav);
      await expect(probe(page).first()).toBeVisible();
    });
  }
});

test.describe('Role gating (Client / Owner)', () => {
  test('restricted intelligence sections are hidden', async ({ page }) => {
    const app = new AppShell(page);
    await app.loginAs({
      email: 'owner@example.com',
      password: 'owner123',
      role: 'Client / Owner',
    });

    const sidebar = page.locator('aside.sidebar');
    await expect(sidebar.getByRole('button', { name: 'Projects' })).toBeVisible();
    await expect(sidebar.getByRole('button', { name: 'GenAI Assistant' })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'SiteVision AI' })).toHaveCount(0);
    await expect(sidebar.getByRole('button', { name: 'Risk & Alerts' })).toHaveCount(0);
  });
});
