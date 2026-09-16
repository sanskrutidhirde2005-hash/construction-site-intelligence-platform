import { test, expect } from '@playwright/test';
import { AppShell } from '../pages/AppShell.js';

// NOTE: backend/.env has an LLM key, so answers may come from OpenRouter
// (network, non-deterministic wording). Assertions stay on the round trip:
// HTTP 200 + non-empty answer + the question echoed back into the thread.
test.describe('GenAI Assistant', () => {
  test.beforeEach(async ({ page }) => {
    const app = new AppShell(page);
    await app.demoLogin();
    await app.navigate('GenAI Assistant');
    await expect(page.getByRole('heading', { name: 'GenAI Assistant' })).toBeVisible();
  });

  test('shows the stored-data greeting', async ({ page }) => {
    await expect(
      page.getByText(/answer from your actual stored project data/i),
    ).toBeVisible();
  });

  test('answers a project question end to end', async ({ page }) => {
    const question = 'How many projects are pending?';

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/genai/query') && r.request().method() === 'POST',
        { timeout: 90000 },
      ),
      (async () => {
        await page
          .getByPlaceholder('Ask about projects, risks, safety, materials...')
          .fill(question);
        await page.getByRole('button', { name: 'Send message' }).click();
      })(),
    ]);

    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(typeof body.answer).toBe('string');
    expect(body.answer.length).toBeGreaterThan(0);

    // The question is echoed into the thread once the round trip completes.
    // Scoped to the messages pane: the same text also labels the
    // conversation-switcher <option>, which is never visible.
    await expect(
      page.locator('.genai-messages').getByText(question),
    ).toBeVisible({ timeout: 30000 });
  });
});
