// PingOne OAuth Configuration — End-user client
// Authorization Code + PKCE flow for banking customers

const ENV_ID = process.env.PINGONE_ENVIRONMENT_ID || 'your-environment-id';
const PINGONE_REGION = process.env.PINGONE_REGION || 'com';
const PINGONE_BASE = `https://auth.pingone.${PINGONE_REGION}/${ENV_ID}/as`;

const config = {
  environmentId: ENV_ID,

  // OAuth2 endpoints (same AS, different client)
  authorizationEndpoint: `${PINGONE_BASE}/authorize`,
  tokenEndpoint:         `${PINGONE_BASE}/token`,
  userInfoEndpoint:      `${PINGONE_BASE}/userinfo`,
  jwksEndpoint:          `${PINGONE_BASE}/jwks`,
  issuer:                PINGONE_BASE,

  // End-user Web application client in PingOne
  clientId:     process.env.PINGONE_USER_CLIENT_ID     || process.env.VITE_PINGONE_CLIENT_ID || 'your-user-client-id',
  clientSecret: process.env.PINGONE_USER_CLIENT_SECRET || process.env.VITE_PINGONE_CLIENT_SECRET || 'your-user-client-secret',

  redirectUri: process.env.PINGONE_USER_REDIRECT_URI || 'http://localhost:3001/api/auth/oauth/user/callback',

  // Scopes — use standard OIDC scopes only; custom banking:* scopes must first be
  // created as Resource/Scopes in PingOne before they can be requested here.
  scopes: ['openid', 'profile', 'email'],

  sessionSecret: process.env.SESSION_SECRET || 'change-this-in-production',
  userRole: process.env.USER_ROLE || 'customer',
};

module.exports = config;

