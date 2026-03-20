/**
 * @file authorize-gate.test.js
 * @description Regression tests for the PingOne Authorize gate in POST /api/transactions.
 *
 * The gate fires when:
 *   - authorizeEnabled is true  (runtime setting)
 *   - authorizePolicyId is a non-empty string  (runtime setting)
 *   - The user is NOT an admin
 *
 * The gate calls pingOneAuthorizeService.evaluateTransaction() and:
 *   - DENY  → 403 transaction_denied
 *   - PERMIT | INDETERMINATE → allowed through
 *   - Service error → fail-open (allowed through, warning logged)
 *
 * step-up MFA is disabled for all tests in this file to keep them focused.
 */

const request = require('supertest');

// ─── Mock auth before server load ─────────────────────────────────────────────
jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    const h = req.headers['x-test-user'];
    if (!h) {
      return res.status(401).json({ error: 'authentication_required', error_description: 'Access token is required' });
    }
    try {
      req.user = JSON.parse(h);
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid_token' });
    }
  },
  requireScopes: (requiredScopes) => (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required', error_description: 'Access token is required' });
    if (req.user.role === 'admin') return next();
    const userScopes = req.user.scopes || [];
    const arr = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
    const ok = arr.some((s) => userScopes.includes(s)) || userScopes.includes('banking:admin');
    if (!ok) return res.status(403).json({ error: 'insufficient_scope' });
    return next();
  },
  requireAdmin: (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required', error_description: 'Access token is required' });
    if (req.user.role === 'admin') return next();
    return res.status(403).json({ error: 'insufficient_scope', error_description: 'Admin role required' });
  },
  hasRequiredScopes: (userScopes, required) => required.some((s) => userScopes.includes(s)),
  parseTokenScopes: () => [],
  requireAIAgent: (_req, _res, next) => next(),
  requireOwnershipOrAdmin: (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required' });
    if (req.user.role === 'admin') return next();
    const paramId = req.params.userId || req.params.id;
    if (paramId && req.user.id !== paramId) return res.status(403).json({ error: 'insufficient_scope' });
    return next();
  },
  hashPassword: (p) => p,
}));

// ─── Mock data store ──────────────────────────────────────────────────────────
jest.mock('../../data/store', () => ({
  getUserById: jest.fn((id) =>
    id === 'test-user-id'
      ? { id: 'test-user-id', firstName: 'Test', lastName: 'User', email: 'test@bank.com' }
      : null
  ),
  getAccountById: jest.fn((id) =>
    id === 'test-account-id'
      ? {
          id: 'test-account-id',
          userId: 'test-user-id',
          accountType: 'Checking',
          accountNumber: '****1234',
          balance: 10000,
        }
      : null
  ),
  createTransaction: jest.fn((data) => ({
    ...data,
    id: 'tx-' + Date.now(),
    createdAt: new Date().toISOString(),
    status: 'completed',
  })),
  updateAccountBalance: jest.fn(),
  getTransactionsByUserId: jest.fn(() => []),
  getAllTransactions: jest.fn(() => []),
  getTransactionById: jest.fn(() => null),
}));

// ─── Mock PingOne Authorize service ───────────────────────────────────────────
// Default decision is PERMIT. Tests can set global.__authorizeGateMockDecision
// to control the fallback when no mockResolvedValueOnce has been queued.
jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn(() =>
    Promise.resolve({ decision: global.__authorizeGateMockDecision || 'PERMIT', raw: {} })
  ),
}));

const app = require('../../server');
const runtimeSettings = require('../../config/runtimeSettings');
const { evaluateTransaction } = require('../../services/pingOneAuthorizeService');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const customerUser = (overrides = {}) =>
  JSON.stringify({
    id: 'test-user-id',
    username: 'customer',
    email: 'customer@bank.com',
    role: 'user',
    scopes: ['banking:transactions:write', 'banking:accounts:read'],
    acr: 'Multi_factor', // satisfy step-up gate so it doesn't interfere
    ...overrides,
  });

const adminUser = () =>
  JSON.stringify({
    id: 'admin-user-id',
    username: 'admin',
    email: 'admin@bank.com',
    role: 'admin',
    scopes: ['banking:admin'],
    acr: 'Multi_factor',
  });

const withdrawalBody = {
  fromAccountId: 'test-account-id',
  amount: 500,
  type: 'withdrawal',
  description: 'Test withdrawal',
};

// ─── Settings management ──────────────────────────────────────────────────────
let originalSettings;

beforeAll(() => {
  originalSettings = runtimeSettings.getAll();
  // Disable step-up so it doesn't block before authorize gate
  runtimeSettings.update({
    stepUpEnabled: false,
    authorizeEnabled: false,
    authorizePolicyId: '',
  }, 'test-setup');
});

afterEach(() => {
  runtimeSettings.update({
    stepUpEnabled: false,
    authorizeEnabled: false,
    authorizePolicyId: '',
  }, 'test-cleanup');
  jest.clearAllMocks();
});

afterAll(() => {
  runtimeSettings.update({
    stepUpEnabled: originalSettings.stepUpEnabled,
    authorizeEnabled: originalSettings.authorizeEnabled,
    authorizePolicyId: originalSettings.authorizePolicyId,
  }, 'test-teardown');
});

// ─────────────────────────────────────────────────────────────────────────────
describe('PingOne Authorize Gate — POST /api/transactions', () => {
  // ── Gate disabled ─────────────────────────────────────────────────────────────
  describe('when authorizeEnabled is false', () => {
    it('should skip the gate and allow the transaction', async () => {
      runtimeSettings.update({ authorizeEnabled: false, authorizePolicyId: 'a-policy-id' }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(res.status).not.toBe(403);
      expect(evaluateTransaction).not.toHaveBeenCalled();
    });
  });

  // ── Gate enabled but no policy ID ────────────────────────────────────────────
  describe('when authorizeEnabled but authorizePolicyId is empty', () => {
    it('should skip the gate and allow the transaction', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: '' }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(res.status).not.toBe(403);
      expect(evaluateTransaction).not.toHaveBeenCalled();
    });
  });

  // ── Policy returns PERMIT ─────────────────────────────────────────────────────
  describe('when policy decision is PERMIT', () => {
    it('should allow the transaction', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'test');
      evaluateTransaction.mockResolvedValueOnce({ decision: 'PERMIT', raw: {} });

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(evaluateTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          policyId: 'test-policy-id',
          userId: 'test-user-id',
          amount: 500,
          type: 'withdrawal',
        })
      );
      expect(res.status).not.toBe(403);
    });
  });

  // ── Policy returns INDETERMINATE ──────────────────────────────────────────────
  describe('when policy decision is INDETERMINATE', () => {
    it('should allow the transaction (fail-open on ambiguity)', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'test');
      evaluateTransaction.mockResolvedValueOnce({ decision: 'INDETERMINATE', raw: {} });

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(res.status).not.toBe(403);
    });
  });

  // ── Policy returns DENY ───────────────────────────────────────────────────────
  describe('when policy decision is DENY', () => {
    it('should return 403 transaction_denied', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'test');
      evaluateTransaction.mockResolvedValueOnce({ decision: 'DENY', raw: { reason: 'high risk' } });

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(res.status).toBe(403);
      expect(res.body.error).toBe('transaction_denied');
      expect(res.body.authorize_policy_id).toBe('test-policy-id');
    });

    it('should not create the transaction', async () => {
      const { createTransaction } = require('../../data/store');
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'test');
      evaluateTransaction.mockResolvedValueOnce({ decision: 'DENY', raw: {} });

      await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(createTransaction).not.toHaveBeenCalled();
    });
  });

  // ── Service error → fail open ─────────────────────────────────────────────────
  describe('when the Authorize service throws an error', () => {
    it('should fail open and allow the transaction', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'test');
      evaluateTransaction.mockRejectedValueOnce(new Error('PingOne Authorize unreachable'));

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      // Fail-open: error should NOT block the transaction
      expect(res.status).not.toBe(403);
      expect(res.status).not.toBe(500);
    });
  });

  // ── Admin bypass ──────────────────────────────────────────────────────────────
  describe('when the user is an admin', () => {
    it('should bypass the Authorize gate entirely', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'test');
      // Do NOT set a mock return value here — evaluateTransaction must NOT be called
      // (admin bypass skips the gate entirely), and an unconsumed Once value would
      // pollute the specificMockImpls queue for subsequent tests.

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', adminUser())
        .send(withdrawalBody);

      expect(evaluateTransaction).not.toHaveBeenCalled();
      expect(res.status).not.toBe(403);
    });
  });

  // ── ACR passed through to Authorize ──────────────────────────────────────────
  describe('user ACR is forwarded to the Authorize policy', () => {
    it('should include acr in the evaluation context', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'test');
      evaluateTransaction.mockResolvedValueOnce({ decision: 'PERMIT', raw: {} });

      await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: 'Multi_factor' }))
        .send(withdrawalBody);

      expect(evaluateTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ acr: 'Multi_factor' })
      );
    });
  });

  // ── Runtime toggle ────────────────────────────────────────────────────────────
  describe('runtime toggle takes effect immediately', () => {
    it('should deny when gate is enabled and policy returns DENY (toggledOn)', async () => {
      runtimeSettings.update({ authorizeEnabled: true, authorizePolicyId: 'test-policy-id' }, 'toggle-test');
      evaluateTransaction.mockResolvedValueOnce({ decision: 'DENY', raw: {} });

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(evaluateTransaction).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(403);
    });

    it('should allow when gate is disabled (toggledOff)', async () => {
      runtimeSettings.update({ authorizeEnabled: false, authorizePolicyId: '' }, 'toggle-test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(withdrawalBody);

      expect(evaluateTransaction).not.toHaveBeenCalled();
      expect(res.status).toBe(201);
    });
  });
});
