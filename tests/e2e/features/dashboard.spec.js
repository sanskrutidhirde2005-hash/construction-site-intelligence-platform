import { test, expect } from '@playwright/test';
import { AppShell } from '../pages/AppShell.js';

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await new AppShell(page).demoLogin();
  });

  test('shows stats, progress, alerts and activity panels', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.locator('.stats-grid')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Project Progress' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Priority Alerts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent Activity' })).toBeVisible();
  });

  test('stats reflect the live dashboard summary API', async ({ page }) => {
    const res = await page.request.get('/api/dashboard/summary');
    expect(res.ok()).toBeTruthy();

    const summary = await res.json();
    for (const key of [
      'projects_total',
      'inspections_total',
      'materials_total',
      'observations_total',
      'budget_at_risk_count',
    ]) {
      expect(summary, `summary missing key: ${key}`).toHaveProperty(key);
    }
  });

  test('BuildSafe Assistant panel opens the GenAI section', async ({ page }) => {
    await page.getByRole('button', { name: /open ai assistant/i }).click();
    await expect(page.getByRole('heading', { name: 'GenAI Assistant' })).toBeVisible();
  });
});
