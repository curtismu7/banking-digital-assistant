const axios = require('axios');
const crypto = require('crypto');
const config = require('../config/oauthUser');

const DEBUG_TOKENS = process.env.DEBUG_TOKENS === 'true';

// Utility function to decode and log OAuth token information
const logTokenInfo = (token, context = '') => {
  if (!DEBUG_TOKENS) return;
  
  try {
    // Parse JWT without verification (just for reading claims)
    const parts = token.split('.');
    if (parts.length !== 3) {
      console.log(`🔐 [${context}] Invalid token format`);
      return;
    }
    
    const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    
    if (!header || !payload) {
      console.log(`🔐 [${context}] Failed to decode token`);
      return;
    }
    
    console.log(`🔐 [${context}] Token Information:`);
    console.log(`   Algorithm: ${header.alg}`);
    console.log(`   Type: ${header.typ}`);
    if (header.kid) console.log(`   Key ID: ${header.kid}`);
    
    console.log(`   Subject: ${payload.sub || 'N/A'}`);
    console.log(`   Issuer: ${payload.iss || 'N/A'}`);
    console.log(`   Audience: ${Array.isArray(payload.aud) ? payload.aud.join(', ') : payload.aud || 'N/A'}`);
    
    if (payload.exp) {
      const expDate = new Date(payload.exp * 1000);
      const now = new Date();
      const timeUntilExp = expDate.getTime() - now.getTime();
      console.log(`   Expires: ${expDate.toISOString()} (in ${Math.round(timeUntilExp / 1000 / 60)} minutes)`);
    }
    
    if (payload.iat) {
      const iatDate = new Date(payload.iat * 1000);
      console.log(`   Issued At: ${iatDate.toISOString()}`);
    }
    
    if (payload.preferred_username) console.log(`   Username: ${payload.preferred_username}`);
    if (payload.email) console.log(`   Email: ${payload.email}`);
    if (payload.given_name) console.log(`   First Name: ${payload.given_name}`);
    if (payload.family_name) console.log(`   Last Name: ${payload.family_name}`);
    
    // Log roles/permissions
    if (payload.realm_access?.roles) {
      console.log(`   Realm Roles: ${payload.realm_access.roles.join(', ')}`);
    }
    if (payload.resource_access) {
      console.log(`   Resource Access: ${JSON.stringify(payload.resource_access)}`);
    }
    if (payload.scope) {
      console.log(`   Scopes: ${payload.scope}`);
    }
    
  } catch (error) {
    console.log(`🔐 [${context}] Error decoding token: ${error.message}`);
  }
};

class OAuthUserService {
  constructor() {
    this.config = config;
  }

  /**
   * Generate PKCE code verifier (random 64-byte hex string)
   */
  generateCodeVerifier() {
    return crypto.randomBytes(64).toString('hex');
  }

  /**
   * Generate PKCE code challenge (S256 = base64url(sha256(verifier)))
   */
  generateCodeChallenge(codeVerifier) {
    return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  }

  /**
   * Generate authorization URL for end user OAuth flow.
   * Pass acr_values to trigger step-up MFA (e.g. 'Multi_factor' — must match the PingOne Sign-On Policy name).
   */
  generateAuthorizationUrl(state, codeVerifier, options = {}) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      state: state,
      code_challenge: this.generateCodeChallenge(codeVerifier),
      code_challenge_method: 'S256'
    });

    if (options.acr_values) {
      params.set('acr_values', options.acr_values);
    }

    return `${this.config.authorizationEndpoint}?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code, codeVerifier) {
    try {
      const response = await axios.post(this.config.tokenEndpoint, {
        grant_type: 'authorization_code',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code: code,
        redirect_uri: this.config.redirectUri,
        code_verifier: codeVerifier
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });

      // Log the received access token information
      if (response.data.access_token) {
        logTokenInfo(response.data.access_token, 'User OAuth Token Exchange');
      }

      return response.data;
    } catch (error) {
      console.error('Token exchange error:', error.response?.data || error.message);
      throw new Error('Failed to exchange code for token');
    }
  }

  /**
   * Get user information from P1AIC
   */
  async getUserInfo(accessToken) {
    try {
      const response = await axios.get(this.config.userInfoEndpoint, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });

      return response.data;
    } catch (error) {
      console.error('User info error:', error.response?.data || error.message);
      throw new Error('Failed to get user information');
    }
  }

  /**
   * Validate JWT token
   */
  validateToken(token) {
    try {
      const decoded = jwt.verify(token, this.config.tokenValidation.issuer, {
        issuer: this.config.tokenValidation.issuer,
        audience: this.config.tokenValidation.audience
      });
      return decoded;
    } catch (error) {
      console.error('Token validation error:', error.message);
      return null;
    }
  }

  /**
   * Create a user object from P1AIC user info (end users get customer role)
   */
  createUserFromOAuth(userInfo) {
    return {
      id: userInfo.sub || userInfo.id,
      username: userInfo.preferred_username || userInfo.username || userInfo.email,
      email: userInfo.email,
      firstName: userInfo.given_name || userInfo.first_name || userInfo.name?.split(' ')[0] || '',
      lastName: userInfo.family_name || userInfo.last_name || userInfo.name?.split(' ').slice(1).join(' ') || '',
      role: this.config.userRole, // End users get customer role
      isActive: true,
      createdAt: new Date(),
      oauthProvider: 'p1AIC',
      oauthId: userInfo.sub || userInfo.id
    };
  }

  /**
   * Generate random state parameter for CSRF protection
   */
  generateState() {
    return crypto.randomBytes(32).toString('hex');
  }

}

module.exports = new OAuthUserService();
