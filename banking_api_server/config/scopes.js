// OAuth Scope Configuration for Banking API
// This file defines scope mappings for different environments and user types

const BANKING_SCOPES = {
  // Read scopes
  ACCOUNTS_READ: 'banking:accounts:read',
  TRANSACTIONS_READ: 'banking:transactions:read',
  BANKING_READ: 'banking:read',
  
  // Write scopes
  TRANSACTIONS_WRITE: 'banking:transactions:write',
  BANKING_WRITE: 'banking:write',
  
  // Administrative scopes
  ADMIN: 'banking:admin',
  
  // AI Agent scope
  AI_AGENT: 'ai_agent'
};

// User type to scope mappings
const USER_TYPE_SCOPES = {
  // Admin users get full access
  admin: [
    BANKING_SCOPES.ADMIN,
    BANKING_SCOPES.BANKING_READ,
    BANKING_SCOPES.BANKING_WRITE,
    BANKING_SCOPES.ACCOUNTS_READ,
    BANKING_SCOPES.TRANSACTIONS_READ,
    BANKING_SCOPES.TRANSACTIONS_WRITE
  ],
  
  // Customer users get read/write access but no admin
  customer: [
    BANKING_SCOPES.BANKING_READ,
    BANKING_SCOPES.BANKING_WRITE,
    BANKING_SCOPES.ACCOUNTS_READ,
    BANKING_SCOPES.TRANSACTIONS_READ,
    BANKING_SCOPES.TRANSACTIONS_WRITE
  ],
  
  // Read-only users get only read access
  readonly: [
    BANKING_SCOPES.BANKING_READ,
    BANKING_SCOPES.ACCOUNTS_READ,
    BANKING_SCOPES.TRANSACTIONS_READ
  ],
  
  // AI agents get full access including AI agent scope
  ai_agent: [
    BANKING_SCOPES.AI_AGENT,
    BANKING_SCOPES.BANKING_READ,
    BANKING_SCOPES.BANKING_WRITE,
    BANKING_SCOPES.ACCOUNTS_READ,
    BANKING_SCOPES.TRANSACTIONS_READ,
    BANKING_SCOPES.TRANSACTIONS_WRITE
  ]
};

// Environment-specific scope configurations
const ENVIRONMENT_CONFIGS = {
  development: {
    // Development allows all scopes for testing
    allowedScopes: Object.values(BANKING_SCOPES),
    strictValidation: false,
    debugScopes: true,
    defaultUserType: 'customer',
    scopeValidationTimeout: 5000, // 5 seconds
    cacheTokenValidation: false
  },
  
  test: {
    // Test environment with relaxed validation
    allowedScopes: Object.values(BANKING_SCOPES),
    strictValidation: false,
    debugScopes: true,
    defaultUserType: 'customer',
    scopeValidationTimeout: 1000, // 1 second for fast tests
    cacheTokenValidation: false,
    skipTokenSignatureValidation: true
  },
  
  staging: {
    // Staging environment with production-like settings
    allowedScopes: Object.values(BANKING_SCOPES),
    strictValidation: true,
    debugScopes: false,
    defaultUserType: 'readonly',
    scopeValidationTimeout: 10000, // 10 seconds
    cacheTokenValidation: true,
    cacheTTL: 300 // 5 minutes
  },
  
  production: {
    // Production environment with strict validation
    allowedScopes: Object.values(BANKING_SCOPES),
    strictValidation: true,
    debugScopes: false,
    defaultUserType: 'readonly',
    scopeValidationTimeout: 10000, // 10 seconds
    cacheTokenValidation: true,
    cacheTTL: 600 // 10 minutes
  }
};

// Route-to-scope mapping (enhanced from existing middleware)
const ROUTE_SCOPE_MAP = {
  // Account routes
  'GET /api/accounts': [BANKING_SCOPES.ACCOUNTS_READ, BANKING_SCOPES.BANKING_READ],
  'GET /api/accounts/my': [BANKING_SCOPES.ACCOUNTS_READ, BANKING_SCOPES.BANKING_READ],
  'GET /api/accounts/:id': [BANKING_SCOPES.ACCOUNTS_READ, BANKING_SCOPES.BANKING_READ],
  'GET /api/accounts/:id/balance': [BANKING_SCOPES.ACCOUNTS_READ, BANKING_SCOPES.BANKING_READ],
  'POST /api/accounts': [BANKING_SCOPES.BANKING_WRITE],
  'PUT /api/accounts/:id': [BANKING_SCOPES.BANKING_WRITE],
  'DELETE /api/accounts/:id': [BANKING_SCOPES.BANKING_WRITE],
  
  // Transaction routes
  'GET /api/transactions': [BANKING_SCOPES.TRANSACTIONS_READ, BANKING_SCOPES.BANKING_READ],
  'GET /api/transactions/my': [BANKING_SCOPES.TRANSACTIONS_READ, BANKING_SCOPES.BANKING_READ],
  'GET /api/transactions/:id': [BANKING_SCOPES.TRANSACTIONS_READ, BANKING_SCOPES.BANKING_READ],
  'POST /api/transactions': [BANKING_SCOPES.TRANSACTIONS_WRITE, BANKING_SCOPES.BANKING_WRITE],
  'POST /api/transactions/deposit': [BANKING_SCOPES.TRANSACTIONS_WRITE, BANKING_SCOPES.BANKING_WRITE],
  'POST /api/transactions/withdraw': [BANKING_SCOPES.TRANSACTIONS_WRITE, BANKING_SCOPES.BANKING_WRITE],
  'POST /api/transactions/transfer': [BANKING_SCOPES.TRANSACTIONS_WRITE, BANKING_SCOPES.BANKING_WRITE],
  'PUT /api/transactions/:id': [BANKING_SCOPES.TRANSACTIONS_WRITE, BANKING_SCOPES.BANKING_WRITE],
  'DELETE /api/transactions/:id': [BANKING_SCOPES.TRANSACTIONS_WRITE, BANKING_SCOPES.BANKING_WRITE],
  
  // Admin routes
  'GET /api/admin/*': [BANKING_SCOPES.ADMIN],
  'POST /api/admin/*': [BANKING_SCOPES.ADMIN],
  'PUT /api/admin/*': [BANKING_SCOPES.ADMIN],
  'DELETE /api/admin/*': [BANKING_SCOPES.ADMIN],
  
  // User routes (general banking read access)
  'GET /api/users': [BANKING_SCOPES.BANKING_READ],
  'GET /api/users/me': [BANKING_SCOPES.BANKING_READ],
  'GET /api/users/:id': [BANKING_SCOPES.BANKING_READ],
  'POST /api/users': [BANKING_SCOPES.BANKING_WRITE],
  'PUT /api/users/:id': [BANKING_SCOPES.BANKING_WRITE],
  'DELETE /api/users/:id': [BANKING_SCOPES.BANKING_WRITE]
};

// OAuth provider scope configuration templates
const OAUTH_PROVIDER_SCOPE_CONFIGS = {
  // P1AIC (PingOne Advanced Identity Cloud) scope configuration
  p1aic: {
    // Admin client scopes
    adminClient: {
      defaultScopes: ['openid', 'profile', 'email'],
      bankingScopes: [
        BANKING_SCOPES.ADMIN,
        BANKING_SCOPES.BANKING_READ,
        BANKING_SCOPES.BANKING_WRITE,
        BANKING_SCOPES.ACCOUNTS_READ,
        BANKING_SCOPES.TRANSACTIONS_READ,
        BANKING_SCOPES.TRANSACTIONS_WRITE
      ]
    },
    
    // End user client scopes
    endUserClient: {
      defaultScopes: ['openid', 'profile', 'email'],
      bankingScopes: [
        BANKING_SCOPES.BANKING_READ,
        BANKING_SCOPES.BANKING_WRITE,
        BANKING_SCOPES.ACCOUNTS_READ,
        BANKING_SCOPES.TRANSACTIONS_READ,
        BANKING_SCOPES.TRANSACTIONS_WRITE
      ]
    },
    
    // AI agent client scopes
    aiAgentClient: {
      defaultScopes: ['openid', 'profile'],
      bankingScopes: [
        BANKING_SCOPES.AI_AGENT,
        BANKING_SCOPES.BANKING_READ,
        BANKING_SCOPES.BANKING_WRITE,
        BANKING_SCOPES.ACCOUNTS_READ,
        BANKING_SCOPES.TRANSACTIONS_READ,
        BANKING_SCOPES.TRANSACTIONS_WRITE
      ]
    }
  }
};

// Get configuration for current environment
const getCurrentEnvironmentConfig = () => {
  const env = process.env.NODE_ENV || 'development';
  return ENVIRONMENT_CONFIGS[env] || ENVIRONMENT_CONFIGS.development;
};

// Get scopes for user type
const getScopesForUserType = (userType) => {
  return USER_TYPE_SCOPES[userType] || USER_TYPE_SCOPES.readonly;
};

// Validate scope against environment configuration
const isValidScope = (scope) => {
  const config = getCurrentEnvironmentConfig();
  return config.allowedScopes.includes(scope);
};

// Get OAuth provider configuration
const getOAuthProviderConfig = (provider = 'p1aic') => {
  return OAUTH_PROVIDER_SCOPE_CONFIGS[provider] || OAUTH_PROVIDER_SCOPE_CONFIGS.p1aic;
};

module.exports = {
  BANKING_SCOPES,
  USER_TYPE_SCOPES,
  ENVIRONMENT_CONFIGS,
  ROUTE_SCOPE_MAP,
  OAUTH_PROVIDER_SCOPE_CONFIGS,
  getCurrentEnvironmentConfig,
  getScopesForUserType,
  isValidScope,
  getOAuthProviderConfig
};