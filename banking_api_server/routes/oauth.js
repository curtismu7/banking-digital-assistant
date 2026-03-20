const express = require('express');
const router = express.Router();
const oauthService = require('../services/oauthService');
const dataStore = require('../data/store');
const { determineClientType } = require('../middleware/auth');

/**
 * Initiate OAuth login for admin users
 * Redirects to P1AIC authorization endpoint
 */
router.get('/login', (req, res) => {
  try {
    // Generate state parameter for CSRF protection
    const state = oauthService.generateState();

    // Generate PKCE code_verifier and store in session
    const codeVerifier = oauthService.generateCodeVerifier();
    req.session.oauthState = state;
    req.session.oauthCodeVerifier = codeVerifier;

    // Generate authorization URL (includes code_challenge derived from verifier)
    const authUrl = oauthService.generateAuthorizationUrl(state, codeVerifier);

    // Redirect to PingOne
    res.redirect(authUrl);
  } catch (error) {
    console.error('OAuth login error:', error);
    res.status(500).json({ error: 'Failed to initiate OAuth login' });
  }
});

/**
 * OAuth callback handler
 * Receives authorization code from P1AIC and exchanges it for tokens
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    // Check for OAuth errors
    if (error) {
      console.error('OAuth error:', error);
      const frontendUrl = process.env.REACT_APP_CLIENT_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/login?error=oauth_error`);
    }

    // Validate state parameter
    if (!state || state !== req.session.oauthState) {
      console.error('Invalid state parameter');
      const frontendUrl = process.env.REACT_APP_CLIENT_URL || 'http://localhost:3000';
      return res.redirect(`${frontendUrl}/login?error=invalid_state`);
    }

    // Clear state and code_verifier from session
    const codeVerifier = req.session.oauthCodeVerifier;
    delete req.session.oauthState;
    delete req.session.oauthCodeVerifier;

    // Exchange authorization code for access token (with PKCE verifier)
    const tokenData = await oauthService.exchangeCodeForToken(code, codeVerifier);
    
    // Get user information from P1AIC
    const userInfo = await oauthService.getUserInfo(tokenData.access_token);
    console.log('User info from P1AIC:', JSON.stringify(userInfo, null, 2));
    
    // Create user object from OAuth data
    const oauthUser = oauthService.createUserFromOAuth(userInfo);
    
    // Check if user already exists in our system
    let user = dataStore.getUserByUsername(oauthUser.username);
    console.log('Looking for existing user:', oauthUser.username);
    console.log('Found user:', user);
    
    if (!user) {
      // For OAuth users, we'll create them as admin by default
      // In production, you might want to check a whitelist or specific P1AIC attributes
      console.log('Creating new OAuth user as admin:', oauthUser.username);
      oauthUser.role = 'admin'; // Make OAuth users admin by default
    } else {
      console.log('Found existing user:', user.username, 'with role:', user.role);
      // Preserve the existing role (especially admin role)
      oauthUser.role = user.role;
    }
    
    if (!user) {
      // Create new user from OAuth data
      console.log('Creating new user with data:', oauthUser);
      user = await dataStore.createUser({
        ...oauthUser,
        password: null // OAuth users don't have passwords
      });
      console.log('Created user:', user);
    } else {
      // Update existing user with OAuth data
      console.log('Updating existing user with data:', {
        email: oauthUser.email,
        firstName: oauthUser.firstName,
        lastName: oauthUser.lastName,
        role: oauthUser.role,
        oauthProvider: oauthUser.oauthProvider,
        oauthId: oauthUser.oauthId
      });
      user = await dataStore.updateUser(user.id, {
        email: oauthUser.email,
        firstName: oauthUser.firstName,
        lastName: oauthUser.lastName,
        role: oauthUser.role,
        oauthProvider: oauthUser.oauthProvider,
        oauthId: oauthUser.oauthId
      });
      console.log('Updated user:', user);
    }

    // Store OAuth tokens directly in session (no JWT generation)
    req.session.oauthTokens = {
      accessToken: tokenData.access_token,
      idToken: tokenData.id_token || null,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + (tokenData.expires_in * 1000),
      tokenType: tokenData.token_type || 'Bearer'
    };

    // Determine client type from the original OAuth token
    const clientType = determineClientType(tokenData.access_token);
    
    // Store user and client type in session (no JWT token generation)
    req.session.user = user;
    req.session.clientType = clientType;

    // Save session before redirect to prevent race condition where status
    // endpoint runs before session is persisted to the store
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('Session save error:', saveErr);
        const frontendUrl = process.env.REACT_APP_CLIENT_URL || 'http://localhost:3000';
        return res.redirect(`${frontendUrl}/login?error=session_error`);
      }
      const adminUrl = process.env.FRONTEND_ADMIN_URL || 'http://localhost:3001/admin';
      res.redirect(`${adminUrl}?oauth=success`);
    });
  } catch (error) {
    console.error('OAuth callback error:', error);
    const frontendUrl = process.env.REACT_APP_CLIENT_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/login?error=callback_failed`);
  }
});

/**
 * Logout - clear local session and end PingOne SSO session
 */
router.get('/logout', (req, res) => {
  const idToken = req.session.oauthTokens?.idToken || null;
  const frontendUrl = process.env.REACT_APP_CLIENT_URL || 'http://localhost:3000';
  const postLogoutUri = `${frontendUrl}/login`;

  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
    }

    // Redirect to PingOne RP-Initiated Logout so the SSO session is cleared.
    // PingOne signoff endpoint: /as/signoff
    const envId = process.env.PINGONE_ENVIRONMENT_ID;
    const region = process.env.PINGONE_REGION || 'com';
    const pingoneSignoff = `https://auth.pingone.${region}/${envId}/as/signoff`;

    const params = new URLSearchParams({
      post_logout_redirect_uri: postLogoutUri
    });
    // Include id_token_hint if available (PingOne uses it to identify the session)
    if (idToken) {
      params.set('id_token_hint', idToken);
    }

    res.redirect(`${pingoneSignoff}?${params.toString()}`);
  });
});

/**
 * Get current OAuth session status
 */
router.get('/status', (req, res) => {
  const isAuthenticated = req.session.user && req.session.oauthTokens?.accessToken;
  
  res.json({
    authenticated: isAuthenticated,
    user: isAuthenticated ? {
      id: req.session.user.id,
      username: req.session.user.username,
      email: req.session.user.email,
      firstName: req.session.user.firstName,
      lastName: req.session.user.lastName,
      role: req.session.user.role
    } : null,
    oauthProvider: isAuthenticated ? req.session.user.oauthProvider : null,
    accessToken: isAuthenticated ? req.session.oauthTokens.accessToken : null,
    tokenType: isAuthenticated ? req.session.oauthTokens.tokenType : null,
    expiresAt: isAuthenticated ? req.session.oauthTokens.expiresAt : null,
    clientType: isAuthenticated ? req.session.clientType : null
  });
});

/**
 * Refresh OAuth tokens if needed
 */
router.post('/refresh', async (req, res) => {
  try {
    if (!req.session.oauthTokens?.refreshToken) {
      return res.status(401).json({ error: 'No refresh token available' });
    }

    // Check if token is expired or about to expire (within 5 minutes)
    const expiresAt = req.session.oauthTokens.expiresAt;
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    if (expiresAt - now > fiveMinutes) {
      return res.json({ message: 'Token is still valid' });
    }

    // TODO: Implement token refresh logic
    // This would require implementing the refresh token flow with P1AIC
    
    res.json({ message: 'Token refresh not yet implemented' });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(500).json({ error: 'Failed to refresh token' });
  }
});

module.exports = router;
