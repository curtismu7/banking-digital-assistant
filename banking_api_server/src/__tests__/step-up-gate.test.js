/**
 * @file step-up-gate.test.js
 * @description Regression tests for the Step-Up MFA gate in POST /api/transactions.
 *
 * The gate fires when:
 *   - stepUpEnabled is true
 *   - The transaction type is in stepUpTransactionTypes (default: ['transfer','withdrawal'])
 *   - The amount >= stepUpAmountThreshold (default: $250)
 *   - The user's ACR value doesn't match stepUpAcrValue (default: 'Multi_factor')
 *   - The user is NOT an admin
 *
 * Expected behaviour under each condition is documented in each test case.
 * Settings are changed via runtimeSettings.update() and restored after each test.
 */

const request = require('supertest');

// ─── Mock the auth middleware BEFORE requiring the server ──────────────────────
jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, res, next) => {
    const userHeader = req.headers['x-test-user'];
    if (!userHeader) {
      return res.status(401).json({
        error: 'authentication_required',
        error_description: 'Access token is required',
      });
    }
    try {
      req.user = JSON.parse(userHeader);
      return next();
    } catch {
      return res.status(401).json({ error: 'invalid_token' });
    }
  },
  requireScopes: (requiredScopes) => (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'authentication_required',
        error_description: 'Access token is required',
      });
    }
    if (req.user.role === 'admin') return next();
    const userScopes = req.user.scopes || [];
    const scopeArr = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];
    const ok = scopeArr.some((s) => userScopes.includes(s)) || userScopes.includes('banking:admin');
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

// ─── Mock the data store with a test user + account ───────────────────────────
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

// ─── Also mock PingOne Authorize so it doesn't interfere ─────────────────────
jest.mock('../../services/pingOneAuthorizeService', () => ({
  evaluateTransaction: jest.fn().mockResolvedValue({ decision: 'PERMIT', raw: {} }),
}));

const app = require('../../server');
const runtimeSettings = require('../../config/runtimeSettings');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const customerUser = (overrides = {}) =>
  JSON.stringify({
    id: 'test-user-id',
    username: 'customer',
    email: 'customer@bank.com',
    role: 'user',
    scopes: ['banking:transactions:write', 'banking:accounts:read'],
    acr: null,
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

/** Withdrawal body that will trip the step-up gate (amount >= default threshold) */
const highValueWithdrawal = (amount = 500) => ({
  fromAccountId: 'test-account-id',
  amount,
  type: 'withdrawal',
  description: 'Test high-value withdrawal',
});

/** Deposit body — type not in stepUpTransactionTypes by default */
const depositBody = (amount = 500) => ({
  toAccountId: 'test-account-id',
  amount,
  type: 'deposit',
  description: 'Test deposit',
});

// ─── Save + restore settings around each test ─────────────────────────────────
let originalSettings;
beforeAll(() => {
  originalSettings = runtimeSettings.getAll();
  // Ensure authorize gate is off so it doesn't interfere
  runtimeSettings.update({ authorizeEnabled: false });
});

afterEach(() => {
  runtimeSettings.update({
    stepUpEnabled: originalSettings.stepUpEnabled,
    stepUpAmountThreshold: originalSettings.stepUpAmountThreshold,
    stepUpAcrValue: originalSettings.stepUpAcrValue,
    stepUpTransactionTypes: originalSettings.stepUpTransactionTypes,
    authorizeEnabled: false,
  }, 'test-cleanup');
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Step-Up MFA Gate — POST /api/transactions', () => {
  // ── Gate disabled ────────────────────────────────────────────────────────────
  describe('when stepUpEnabled is false', () => {
    it('should allow high-value withdrawal without MFA', async () => {
      runtimeSettings.update({ stepUpEnabled: false }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(highValueWithdrawal(1000));

      expect(res.status).not.toBe(428);
    });
  });

  // ── Transaction type not guarded ─────────────────────────────────────────────
  describe('when transaction type is not in stepUpTransactionTypes', () => {
    it('should allow high-value deposit without MFA', async () => {
      runtimeSettings.update({ stepUpEnabled: true, stepUpTransactionTypes: ['transfer', 'withdrawal'] }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(depositBody(5000));

      expect(res.status).not.toBe(428);
    });
  });

  // ── Amount below threshold ────────────────────────────────────────────────────
  describe('when amount is below the threshold', () => {
    it('should allow a small withdrawal without MFA', async () => {
      runtimeSettings.update({ stepUpEnabled: true, stepUpAmountThreshold: 250 }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser())
        .send(highValueWithdrawal(100));

      expect(res.status).not.toBe(428);
    });
  });

  // ── Gate triggers: no ACR ─────────────────────────────────────────────────────
  describe('when amount meets threshold and user has no ACR', () => {
    it('should return 428 step_up_required', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 250,
        stepUpAcrValue: 'Multi_factor',
        stepUpTransactionTypes: ['transfer', 'withdrawal'],
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(highValueWithdrawal(500));

      expect(res.status).toBe(428);
      expect(res.body.error).toBe('step_up_required');
      expect(res.body.step_up_url).toBeDefined();
      expect(res.body.amount_threshold).toBe(250);
    });
  });

  // ── Gate triggers: wrong ACR ──────────────────────────────────────────────────
  describe('when amount meets threshold and user has wrong ACR', () => {
    it('should return 428 step_up_required', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 250,
        stepUpAcrValue: 'Multi_factor',
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: 'PasswordOnly' }))
        .send(highValueWithdrawal(500));

      expect(res.status).toBe(428);
      expect(res.body.error).toBe('step_up_required');
    });
  });

  // ── Gate passes: correct ACR ──────────────────────────────────────────────────
  describe('when amount meets threshold and user has the required ACR', () => {
    it('should allow the transaction', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 250,
        stepUpAcrValue: 'Multi_factor',
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: 'Multi_factor' }))
        .send(highValueWithdrawal(500));

      expect(res.status).not.toBe(428);
    });
  });

  // ── Admin bypass ──────────────────────────────────────────────────────────────
  describe('when the user is an admin', () => {
    it('should bypass the step-up gate regardless of amount', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 1, // very low threshold
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', adminUser())
        .send(highValueWithdrawal(999999));

      expect(res.status).not.toBe(428);
    });
  });

  // ── Threshold is exact boundary ───────────────────────────────────────────────
  describe('boundary: amount exactly at threshold', () => {
    it('should trigger step-up when amount equals the threshold', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 500,
        stepUpAcrValue: 'Multi_factor',
        stepUpTransactionTypes: ['withdrawal'],
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(highValueWithdrawal(500)); // exactly at threshold

      expect(res.status).toBe(428);
    });

    it('should NOT trigger step-up when amount is one cent below threshold', async () => {
      runtimeSettings.update({
        stepUpEnabled: true,
        stepUpAmountThreshold: 500,
        stepUpAcrValue: 'Multi_factor',
        stepUpTransactionTypes: ['withdrawal'],
      }, 'test');

      const res = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(highValueWithdrawal(499.99));

      expect(res.status).not.toBe(428);
    });
  });

  // ── Runtime threshold change ──────────────────────────────────────────────────
  describe('runtime threshold update takes effect immediately', () => {
    it('should reflect a new threshold without a restart', async () => {
      // First set threshold to $1000 — $500 should pass
      runtimeSettings.update({ stepUpEnabled: true, stepUpAmountThreshold: 1000 }, 'test');

      const pass = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(highValueWithdrawal(500));

      expect(pass.status).not.toBe(428);

      // Lower threshold to $100 — $500 should now be blocked
      runtimeSettings.update({ stepUpAmountThreshold: 100 }, 'test');

      const blocked = await request(app)
        .post('/api/transactions')
        .set('x-test-user', customerUser({ acr: null }))
        .send(highValueWithdrawal(500));

      expect(blocked.status).toBe(428);
    });
  });
});
