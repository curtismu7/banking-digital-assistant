// PingOne OAuth Configuration — Admin client
// Authorization Code flow for admin/staff users

const ENV_ID = process.env.PINGONE_ENVIRONMENT_ID || 'your-environment-id';
const PINGONE_REGION = process.env.PINGONE_REGION || 'com'; // com | eu | ca | asia | com.au
const PINGONE_BASE = `https://auth.pingone.${PINGONE_REGION}/${ENV_ID}/as`;

const config = {
  environmentId: ENV_ID,

  // OAuth2 endpoints
  authorizationEndpoint: `${PINGONE_BASE}/authorize`,
  tokenEndpoint:         `${PINGONE_BASE}/token`,
  userInfoEndpoint:      `${PINGONE_BASE}/userinfo`,
  jwksEndpoint:          `${PINGONE_BASE}/jwks`,
  issuer:                PINGONE_BASE,

  // Admin OAuth2 client (Web application in PingOne)
  clientId:     process.env.PINGONE_ADMIN_CLIENT_ID     || process.env.VITE_PINGONE_CLIENT_ID || 'your-admin-client-id',
  clientSecret: process.env.PINGONE_ADMIN_CLIENT_SECRET || process.env.VITE_PINGONE_CLIENT_SECRET || 'your-admin-client-secret',

  // Redirect URI (must match what\'s configured in PingOne application)
  redirectUri: process.env.PINGONE_ADMIN_REDIRECT_URI || 'http://localhost:3001/api/auth/oauth/callback',

  // Scopes — use standard OIDC scopes only; custom banking:* scopes must first be
  // created as Resource/Scopes in PingOne before they can be requested here.
  scopes: ['openid', 'profile', 'email'],

  // Session configuration
  sessionSecret: process.env.SESSION_SECRET || 'change-this-in-production',

  // Role configuration
  adminRole: process.env.ADMIN_ROLE || 'admin',
};

module.exports = config;

