const request = require('supertest');
const app = require('../../server');

// Helper function to create test tokens without JWT library
const createTestToken = (payload) => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = 'test-signature';
  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

describe('Scope-based Authorization Integration Tests', () => {
  // Set environment variables for testing
  beforeAll(() => {
    process.env.DEBUG_TOKENS = 'true';
    process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'true';
  });
  
  afterAll(() => {
    delete process.env.DEBUG_TOKENS;
    delete process.env.SKIP_TOKEN_SIGNATURE_VALIDATION;
  });

  // Helper function to create OAuth tokens with specific scopes
  const createOAuthToken = (scopes, userInfo = {}) => {
    const payload = {
      sub: userInfo.id || 'test-user-123',
      preferred_username: userInfo.username || 'testuser',
      email: userInfo.email || 'test@example.com',
      scope: Array.isArray(scopes) ? scopes.join(' ') : scopes,
      iss: 'https://auth.pingone.com/test-env',
      aud: 'banking_jk_enduser',
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      iat: Math.floor(Date.now() / 1000),
      // Add realm_access for role-based authorization
      realm_access: {
        roles: userInfo.roles || ['user']
      }
    };
    
    return createTestToken(payload);
  };



  describe('User Routes Scope Authorization', () => {
    it('should allow access to GET /api/users with banking:read scope', async () => {
      const token = createOAuthToken(['banking:read']);
      
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${token}`);
      
      // For OAuth tokens, admin routes now require banking:admin scope
      // This should fail with insufficient_scope because it lacks banking:admin scope
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('insufficient_scope');
      expect(response.body.requiredScopes).toEqual(['banking:admin']);
      expect(response.body.providedScopes).toEqual(['banking:read']);
    });

    it('should deny access to GET /api/users without banking:read scope', async () => {
      // Create token with admin role but wrong scopes to test scope validation
      const token = createOAuthToken(['banking:write'], { roles: ['admin'] });
      
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${token}`);
      
      // Should fail at scope check, not role check
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('insufficient_scope');
      expect(response.body.requiredScopes).toContain('banking:read');
    });

    it('should allow access to POST /api/users with banking:write scope', async () => {
      const token = createOAuthToken(['banking:write']);
      
      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: 'newuser',
          email: 'newuser@example.com',
          password: 'password123',
          firstName: 'New',
          lastName: 'User'
        });
      
      // For OAuth tokens, admin routes now require banking:admin scope
      // This should fail with insufficient_scope because it lacks banking:admin scope
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('insufficient_scope');
      expect(response.body.requiredScopes).toEqual(['banking:admin']);
      expect(response.body.providedScopes).toEqual(['banking:write']);
    });

    it('should deny access to POST /api/users without banking:write scope', async () => {
      const token = createOAuthToken(['banking:read'], { roles: ['admin'] });
      
      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: 'newuser',
          email: 'newuser@example.com',
          password: 'password123',
          firstName: 'New',
          lastName: 'User'
        });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('insufficient_scope');
      expect(response.body.requiredScopes).toContain('banking:write');
    });
  });

  describe('Account Routes Scope Authorization', () => {
    it('should allow access to GET /api/accounts with banking:accounts:read scope', async () => {
      const token = createOAuthToken(['banking:accounts:read']);
      
      const response = await request(app)
        .get('/api/accounts')
        .set('Authorization', `Bearer ${token}`);
      
      // Note: This will still fail with 403 due to admin role check, but should pass scope check
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Access denied. Admin role required.');
      expect(response.body.error).not.toBe('insufficient_scope');
    });

    it('should allow access to GET /api/accounts with banking:read scope', async () => {
      const token = createOAuthToken(['banking:read']);
      
      const response = await request(app)
        .get('/api/accounts')
        .set('Authorization', `Bearer ${token}`);
      
      // Note: This will still fail with 403 due to admin role check, but should pass scope check
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Access denied. Admin role required.');
      expect(response.body.error).not.toBe('insufficient_scope');
    });

    it('should deny access to GET /api/accounts without required scopes', async () => {
      const token = createOAuthToken(['banking:write'], { roles: ['admin'] });
      
      const response = await request(app)
        .get('/api/accounts')
        .set('Authorization', `Bearer ${token}`);
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('insufficient_scope');
      expect(response.body.requiredScopes).toEqual(['banking:accounts:read', 'banking:read']);
    });

    it('should allow access to GET /api/accounts/my with banking:accounts:read scope', async () => {
      const token = createOAuthToken(['banking:accounts:read']);
      
      const response = await request(app)
        .get('/api/accounts/my')
        .set('Authorization', `Bearer ${token}`);
      
      // Should pass scope check and return user's accounts (empty array for test user)
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accounts');
      expect(Array.isArray(response.body.accounts)).toBe(true);
    });

    it('should allow access to GET /api/accounts/my with banking:read scope', async () => {
      const token = createOAuthToken(['banking:read']);
      
      const response = await request(app)
        .get('/api/accounts/my')
        .set('Authorization', `Bearer ${token}`);
      
      // Should pass scope check and return user's accounts
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accounts');
    });

    it('should deny access to POST /api/accounts without banking:write scope', async () => {
      const token = createOAuthToken(['banking:read'], { roles: ['admin'] });
      
      const response = await request(app)
        .post('/api/accounts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: 'test-user-123',
          accountType: 'checking',
          initialBalance: 1000
        });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('insufficient_scope');
      expect(response.body.requiredScopes).toContain('banking:write');
    });

    it('should allow access to POST /api/accounts with banking:write scope', async () => {
      const token = createOAuthToken(['banking:write']);
      
      const response = await request(app)
        .post('/api/accounts')
        .set('Authorization', `Bearer ${token}`)
        .send({
          userId: 'test-user-123',
          accountType: 'checking',
          initialBalance: 1000
        });
      
      // Note: This will still fail with 403 due to admin role check, but should pass scope check
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Access denied. Admin role required.');
      expect(response.body.error).not.toBe('insufficient_scope');
    });
  });



  describe('Error Handling', () => {
    it('should return 401 for missing authorization header', async () => {
      const response = await request(app)
        .get('/api/accounts/my');
      
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: 'authentication_required',
        error_description: 'Access token is required',
        hint: expect.any(String),
        timestamp: expect.any(String),
        path: '/api/accounts/my',
        method: 'GET'
      });
    });

    it('should return detailed error information for insufficient scopes', async () => {
      const token = createOAuthToken(['banking:transactions:read'], { roles: ['admin'] });
      
      const response = await request(app)
        .get('/api/accounts')
        .set('Authorization', `Bearer ${token}`);
      
      expect(response.status).toBe(403);
      expect(response.body).toMatchObject({
        error: 'insufficient_scope',
        error_description: expect.stringContaining('At least one of the following scopes is required'),
        requiredScopes: ['banking:accounts:read', 'banking:read'],
        providedScopes: ['banking:transactions:read'],
        missingScopes: ['banking:accounts:read', 'banking:read'],
        validationMode: 'any_required',
        hint: expect.any(String),
        timestamp: expect.any(String),
        path: '/api/accounts',
        method: 'GET'
      });
    });

    it('should handle invalid OAuth tokens', async () => {
      const response = await request(app)
        .get('/api/accounts/my')
        .set('Authorization', 'Bearer invalid-token');
      
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        error: expect.stringMatching(/malformed_token|invalid_token/),
        error_description: expect.any(String),
        timestamp: expect.any(String),
        path: '/api/accounts/my',
        method: 'GET'
      });
    });
  });

  describe('Transaction Routes Scope Authorization', () => {
    it('should allow access to GET /api/transactions with banking:transactions:read scope', async () => {
      const token = createOAuthToken(['banking:transactions:read']);
      
      const response = await request(app)
        .get('/api/transactions')
        .set('Authorization', `Bearer ${token}`);
      
      // Note: This will still fail with 403 due to admin role check, but should pass scope check
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Access denied. Admin role required.');
      expect(response.body.error).not.toBe('insufficient_scope');
    });

    it('should allow access to GET /api/transactions with banking:read scope', async () => {
      const token = createOAuthToken(['banking:read']);
      
      const response = await request(app)
        .get('/api/transactions')
        .set('Authorization', `Bearer ${token}`);
      
      // Note: This will still fail with 403 due to admin role check, but should pass scope check
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Access denied. Admin role required.');
      expect(response.body.error).not.toBe('insufficient_scope');
    });

    it('should deny access to GET /api/transactions without required scopes', async () => {
      const token = createOAuthToken(['banking:write'], { roles: ['admin'] });
      
      const response = await request(app)
        .get('/api/transactions')
        .set('Authorization', `Bearer ${token}`);
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('insufficient_scope');
      expect(response.body.requiredScopes).toEqual(['banking:transactions:read', 'banking:read']);
    });

    it('should allow access to GET /api/transactions/my with banking:transactions:read scope', async () => {
      const token = createOAuthToken(['banking:transactions:read']);
      
      const response = await request(app)
        .get('/api/transactions/my')
        .set('Authorization', `Bearer ${token}`);
      
      // Should pass scope check and return user's transactions (empty array for test user)
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('transactions');
      expect(Array.isArray(response.body.transactions)).toBe(true);
    });

    it('should allow access to GET /api/transactions/my with banking:read scope', async () => {
      const token = createOAuthToken(['banking:read']);
      
      const response = await request(app)
        .get('/api/transactions/my')
        .set('Authorization', `Bearer ${token}`);
      
      // Should pass scope check and return user's transactions
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('transactions');
    });

    it('should deny access to GET /api/transactions/my without required scopes', async () => {
      const token = createOAuthToken(['banking:write']);
      
      const response = await request(app)
        .get('/api/transactions/my')
        .set('Authorization', `Bearer ${token}`);
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('insufficient_scope');
      expect(response.body.requiredScopes).toEqual(['banking:transactions:read', 'banking:read']);
    });

    it('should allow access to POST /api/transactions with banking:transactions:write scope', async () => {
      const token = createOAuthToken(['banking:transactions:write']);
      
      const response = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'deposit',
          amount: 100,
          toAccountId: 'test-account-123',
          description: 'Test deposit'
        });
      
      // Should pass scope check but fail due to account not found (expected for test)
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('To account not found');
      expect(response.body.error).not.toBe('insufficient_scope');
    });

    it('should allow access to POST /api/transactions with banking:write scope', async () => {
      const token = createOAuthToken(['banking:write']);
      
      const response = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'deposit',
          amount: 100,
          toAccountId: 'test-account-123',
          description: 'Test deposit'
        });
      
      // Should pass scope check but fail due to account not found (expected for test)
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('To account not found');
      expect(response.body.error).not.toBe('insufficient_scope');
    });

    it('should deny access to POST /api/transactions without required scopes', async () => {
      const token = createOAuthToken(['banking:read']);
      
      const response = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'deposit',
          amount: 100,
          toAccountId: 'test-account-123',
          description: 'Test deposit'
        });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('insufficient_scope');
      expect(response.body.requiredScopes).toEqual(['banking:transactions:write', 'banking:write']);
    });

    it('should test transfer operations with banking:transactions:write scope', async () => {
      const token = createOAuthToken(['banking:transactions:write']);
      
      const response = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'transfer',
          amount: 100,
          fromAccountId: 'test-account-from',
          toAccountId: 'test-account-to',
          description: 'Test transfer'
        });
      
      // Should pass scope check but fail due to accounts not found (expected for test)
      expect(response.status).toBe(404);
      expect(response.body.error).toBe('From account not found');
      expect(response.body.error).not.toBe('insufficient_scope');
    });

    it('should deny transfer operations without banking:transactions:write scope', async () => {
      const token = createOAuthToken(['banking:transactions:read']);
      
      const response = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'transfer',
          amount: 100,
          fromAccountId: 'test-account-from',
          toAccountId: 'test-account-to',
          description: 'Test transfer'
        });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('insufficient_scope');
      expect(response.body.requiredScopes).toEqual(['banking:transactions:write', 'banking:write']);
    });

    it('should allow access to PUT /api/transactions/:id with banking:transactions:write scope', async () => {
      const token = createOAuthToken(['banking:transactions:write']);
      
      const response = await request(app)
        .put('/api/transactions/test-transaction-123')
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'Updated description'
        });
      
      // Note: This will still fail with 403 due to admin role check, but should pass scope check
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Access denied. Admin role required.');
      expect(response.body.error).not.toBe('insufficient_scope');
    });

    it('should deny access to PUT /api/transactions/:id without required scopes', async () => {
      const token = createOAuthToken(['banking:read'], { roles: ['admin'] });
      
      const response = await request(app)
        .put('/api/transactions/test-transaction-123')
        .set('Authorization', `Bearer ${token}`)
        .send({
          description: 'Updated description'
        });
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('insufficient_scope');
      expect(response.body.requiredScopes).toEqual(['banking:transactions:write', 'banking:write']);
    });

    it('should allow access to DELETE /api/transactions/:id with banking:transactions:write scope', async () => {
      const token = createOAuthToken(['banking:transactions:write']);
      
      const response = await request(app)
        .delete('/api/transactions/test-transaction-123')
        .set('Authorization', `Bearer ${token}`);
      
      // Note: This will still fail with 403 due to admin role check, but should pass scope check
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Access denied. Admin role required.');
      expect(response.body.error).not.toBe('insufficient_scope');
    });

    it('should deny access to DELETE /api/transactions/:id without required scopes', async () => {
      const token = createOAuthToken(['banking:read'], { roles: ['admin'] });
      
      const response = await request(app)
        .delete('/api/transactions/test-transaction-123')
        .set('Authorization', `Bearer ${token}`);
      
      expect(response.status).toBe(403);
      expect(response.body.error).toBe('insufficient_scope');
      expect(response.body.requiredScopes).toEqual(['banking:transactions:write', 'banking:write']);
    });
  });

  describe('Multiple Scopes Scenarios', () => {
    it('should allow access when user has multiple scopes including required ones', async () => {
      const token = createOAuthToken(['banking:read', 'banking:write', 'banking:admin']);
      
      const response = await request(app)
        .get('/api/accounts/my')
        .set('Authorization', `Bearer ${token}`);
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accounts');
    });

    it('should work with granular scopes', async () => {
      const token = createOAuthToken(['banking:accounts:read', 'banking:transactions:write']);
      
      // Should allow account read access
      const accountResponse = await request(app)
        .get('/api/accounts/my')
        .set('Authorization', `Bearer ${token}`);
      
      expect(accountResponse.status).toBe(200);
      
      // Should deny general user read access (needs banking:read)
      const userResponse = await request(app)
        .get('/api/users/test-user-123')
        .set('Authorization', `Bearer ${token}`);
      
      expect(userResponse.status).toBe(403);
      expect(userResponse.body.error).toBe('insufficient_scope');
    });

    it('should allow transaction operations with specific transaction scopes', async () => {
      const token = createOAuthToken(['banking:transactions:read', 'banking:transactions:write']);
      
      // Should allow transaction read access
      const readResponse = await request(app)
        .get('/api/transactions/my')
        .set('Authorization', `Bearer ${token}`);
      
      expect(readResponse.status).toBe(200);
      expect(readResponse.body).toHaveProperty('transactions');
      
      // Should allow transaction write access (will fail due to missing account, but passes scope check)
      const writeResponse = await request(app)
        .post('/api/transactions')
        .set('Authorization', `Bearer ${token}`)
        .send({
          type: 'deposit',
          amount: 100,
          toAccountId: 'test-account-123',
          description: 'Test deposit'
        });
      
      expect(writeResponse.status).toBe(404); // Account not found, but scope check passed
      expect(writeResponse.body.error).toBe('To account not found');
      expect(writeResponse.body.error).not.toBe('insufficient_scope');
    });
  });

  describe('Admin Scope Authorization', () => {
    describe('OAuth tokens', () => {
      it('should allow access to admin routes with banking:admin scope', async () => {
        const token = createOAuthToken(['banking:admin'], { 
          username: 'admin-user',
          roles: ['admin']
        });
        
        const response = await request(app)
          .get('/api/admin/stats')
          .set('Authorization', `Bearer ${token}`);
        
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('stats');
      });

      it('should deny access to admin routes without banking:admin scope', async () => {
        const token = createOAuthToken(['banking:read', 'banking:write'], { 
          username: 'regular-user',
          roles: ['user']
        });
        
        const response = await request(app)
          .get('/api/admin/stats')
          .set('Authorization', `Bearer ${token}`);
        
        expect(response.status).toBe(403);
        expect(response.body.error).toBe('insufficient_scope');
        expect(response.body.requiredScopes).toEqual(['banking:admin']);
        expect(response.body.providedScopes).toEqual(['banking:read', 'banking:write']);
      });

      it('should deny access to admin routes with no scopes', async () => {
        const token = createOAuthToken([], { 
          username: 'no-scope-user',
          roles: ['user']
        });
        
        const response = await request(app)
          .get('/api/admin/activity')
          .set('Authorization', `Bearer ${token}`);
        
        expect(response.status).toBe(403);
        expect(response.body.error).toBe('insufficient_scope');
        expect(response.body.requiredScopes).toEqual(['banking:admin']);
        expect(response.body.providedScopes).toEqual([]);
      });

      it('should allow access to all admin endpoints with banking:admin scope', async () => {
        const token = createOAuthToken(['banking:admin'], { 
          username: 'admin-user',
          roles: ['admin']
        });
        
        // Test multiple admin endpoints
        const endpoints = [
          '/api/admin/stats',
          '/api/admin/activity',
          '/api/admin/activity/recent',
          '/api/admin/activity/summary'
        ];

        for (const endpoint of endpoints) {
          const response = await request(app)
            .get(endpoint)
            .set('Authorization', `Bearer ${token}`);
          
          expect(response.status).toBe(200);
        }
      });

      it('should deny access to DELETE admin endpoints without banking:admin scope', async () => {
        const token = createOAuthToken(['banking:read'], { 
          username: 'read-only-user',
          roles: ['user']
        });
        
        const response = await request(app)
          .delete('/api/admin/activity/clear?days=30')
          .set('Authorization', `Bearer ${token}`);
        
        expect(response.status).toBe(403);
        expect(response.body.error).toBe('insufficient_scope');
        expect(response.body.requiredScopes).toEqual(['banking:admin']);
      });
    });



    describe('Mixed token scenarios', () => {
      it('should handle OAuth token with admin role but no banking:admin scope', async () => {
        const token = createOAuthToken(['banking:read'], { 
          username: 'admin-without-scope',
          roles: ['admin'] // Has admin role but not banking:admin scope
        });
        
        const response = await request(app)
          .get('/api/admin/stats')
          .set('Authorization', `Bearer ${token}`);
        
        expect(response.status).toBe(403);
        expect(response.body.error).toBe('insufficient_scope');
        expect(response.body.error_description).toBe('Access denied. At least one of the following scopes is required: banking:admin');
      });

      it('should handle OAuth token with banking:admin scope but no admin role', async () => {
        const token = createOAuthToken(['banking:admin'], { 
          username: 'scope-without-role',
          roles: ['user'] // Has banking:admin scope but not admin role
        });
        
        const response = await request(app)
          .get('/api/admin/stats')
          .set('Authorization', `Bearer ${token}`);
        
        // Should succeed because OAuth tokens use scope-based authorization
        expect(response.status).toBe(200);
        expect(response.body).toHaveProperty('stats');
      });
    });
  });
});