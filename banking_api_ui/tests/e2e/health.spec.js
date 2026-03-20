/**
 * @file health.spec.js
 * @description Regression tests for API health and status endpoints.
 *
 * These tests call the banking_api_server directly (port 3001) without
 * going through the React app, making them fast and useful as smoke tests
 * to confirm the backend is alive before running more complex UI tests.
 *
 * Prerequisites:
 *   - banking_api_server must be running on http://localhost:3001
 *
 * Run with:
 *   cd banking_api_ui && npm run test:e2e -- tests/e2e/health.spec.js
 */

const { test, expect } = require('@playwright/test');

const API_BASE = 'http://localhost:3001';

test.describe('Banking API — Health & Status Endpoints', () => {
  test('GET /api/healthz returns 200 with status ok', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/healthz`);
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  test('GET /health returns 200 or 503 with a structured health payload', async ({ request }) => {
    const res = await request.get(`${API_BASE}/health`);
    // Healthy → 200; degraded → 200; unhealthy → 503
    expect([200, 503]).toContain(res.status());

    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(['healthy', 'degraded', 'unhealthy']).toContain(body.status);
    expect(body).toHaveProperty('components');
  });

  test('GET /api/auth/oauth/status returns a structured response', async ({ request }) => {
    // This endpoint always responds (never 500), but will return authenticated: false
    // in a test environment with no active session.
    const res = await request.get(`${API_BASE}/api/auth/oauth/status`);
    expect([200, 401]).toContain(res.status());

    const body = await res.json();
    expect(body).toHaveProperty('authenticated');
    expect(typeof body.authenticated).toBe('boolean');
  });

  test('GET /api/admin/settings returns 401 without a token', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/admin/settings`);
    expect(res.status()).toBe(401);
  });

  test('POST /api/transactions returns 401 without a token', async ({ request }) => {
    const res = await request.post(`${API_BASE}/api/transactions`, {
      data: { toAccountId: 'any', amount: 100, type: 'deposit' },
    });
    expect(res.status()).toBe(401);
  });
});
