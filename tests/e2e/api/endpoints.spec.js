import { test, expect, request } from '@playwright/test';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

test.describe('API endpoints', () => {
  let api;

  test.beforeAll(async () => {
    api = await request.newContext({ baseURL: BACKEND_URL });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('dashboard summary returns live counters', async () => {
    const res = await api.get('/api/dashboard/summary');
    expect(res.ok()).toBeTruthy();

    const summary = await res.json();
    for (const key of [
      'projects_total',
      'inspections_total',
      'inspections_attention',
      'materials_total',
      'observations_total',
      'total_budget',
      'total_spent',
      'budget_at_risk_count',
    ]) {
      expect(summary, `summary missing key: ${key}`).toHaveProperty(key);
    }
  });

  test('search returns the record envelope', async () => {
    const res = await api.get('/api/search', { params: { q: 'concrete' } });
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(body.query).toBe('concrete');
    for (const key of ['projects', 'inspections', 'materials', 'observations']) {
      expect(body, `search missing key: ${key}`).toHaveProperty(key);
    }
  });

  test('missing project returns 404 on read and update', async () => {
    expect((await api.get('/api/projects/999999')).status()).toBe(404);
    expect(
      (await api.put('/api/projects/999999', { data: { progress: 10 } })).status(),
    ).toBe(404);
  });

  test('vision model-status reports an engine without loading weights', async () => {
    const res = await api.get('/api/vision/model-status');
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(['yolo', 'legacy', 'unavailable']).toContain(body.engine);
  });

  test('genai query answers from stored records', async () => {
    // Writes one row to genai_queries on the dev database.
    const res = await api.post('/api/genai/query', {
      data: { query_text: 'E2E smoke: what are the material requirements?' },
    });
    expect(res.ok()).toBeTruthy();

    const body = await res.json();
    expect(typeof body.answer).toBe('string');
    expect(body.answer.length).toBeGreaterThan(0);
  });
});
