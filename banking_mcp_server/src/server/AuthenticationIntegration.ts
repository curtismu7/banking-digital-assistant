/**
 * Authentication Integration
 * Integrates agent token validation and authorization challenge responses into MCP message processing
 */

import { MCPResponse, ToolCallResponse, AuthorizationRequest } from '../interfaces/mcp';
import { BankingAuthenticationManager } from '../auth/BankingAuthenticationManager';
import { BankingSessionManager, BankingSession } from '../storage/BankingSessionManager';
import { AuthenticationError, AuthErrorCodes, AgentTokenInfo } from '../interfaces/auth';

export interface AuthenticationResult {
  success: boolean;
  session?: BankingSession;
  error?: string;
  authChallenge?: AuthorizationRequest;
}

export interface AuthorizationChallengeResponse {
  authorizationUrl: string;
  state: string;
  scope: string;
  sessionId: string;
  instructions: string;
}

export class AuthenticationIntegration {
  constructor(
    private authManager: BankingAuthenticationManager,
    private sessionManager: BankingSessionManager
  ) {}

  /**
   * Validate agent token and create/retrieve session
   */
  async validateAgentAuthentication(agentToken: string): Promise<AuthenticationResult> {
    try {
      // Validate agent token with PingOne
      const agentTokenInfo = await this.authManager.validateAgentToken(agentToken);
      
      if (!agentTokenInfo.isValid) {
        return {
          success: false,
          error: 'Invalid agent token'
        };
      }

      // Get or create session
      let session = await this.sessionManager.getSessionByAgentToken(agentToken);
      if (!session) {
        session = await this.sessionManager.createSession(agentToken);
        console.log(`[AuthenticationIntegration] Created session ${session.sessionId} for agent token`);
      }

      return {
        success: true,
        session
      };

    } catch (error) {
      console.error('[AuthenticationIntegration] Agent authentication failed:', error);
      
      if (error instanceof AuthenticationError) {
        return {
          success: false,
          error: error.message,
          authChallenge: error.authorizationUrl ? {
            authorizationUrl: error.authorizationUrl,
            state: 'agent-auth-required',
            scope: 'banking:agent',
            sessionId: 'pending',
            expiresAt: new Date(Date.now() + 300000) // 5 minutes
          } : undefined
        };
      }

      return {
        success: false,
        error: 'Authentication service unavailable'
      };
    }
  }

  /**
   * Check if user authorization is required for banking operations
   */
  async checkUserAuthorization(session: BankingSession, requiredScopes: string[]): Promise<AuthenticationResult> {
    try {
      // Validate session
      const validation = await this.sessionManager.validateSession(session.sessionId);
      
      if (!validation.isValid) {
        return {
          success: false,
          error: validation.error || 'Session invalid'
        };
      }

      // First, check if user tokens exist and validate them
      if (session.userTokens && session.userTokens.length > 0) {
        console.log(`[AuthenticationIntegration] Session has user tokens, validating scopes and expiration`);
        
        // Clean up any expired tokens first
        await this.sessionManager.cleanupExpiredTokens(session.sessionId);
        
        // Refresh session data after cleanup
        const updatedSession = await this.sessionManager.getSession(session.sessionId);
        if (updatedSession) {
          session = updatedSession;
        }

        // Check if we have valid tokens for the required scopes
        const validTokens = this.sessionManager.findTokensForScopes(session, requiredScopes);
        
        if (validTokens) {
          console.log(`[AuthenticationIntegration] Found valid tokens with required scopes, proceeding`);
          return {
            success: true,
            session
          };
        }

        // Try to refresh expired tokens that might have the required scopes
        let refreshAttempted = false;
        for (const tokens of session.userTokens || []) {
          if (this.authManager.isTokenExpired(tokens)) {
            const tokenScopes = tokens.scope.split(' ');
            const hasRequiredScopes = requiredScopes.every(scope => tokenScopes.includes(scope));
            
            if (hasRequiredScopes && !refreshAttempted) {
              console.log(`[AuthenticationIntegration] Found expired tokens with required scopes, attempting refresh`);
              try {
                const refreshedTokens = await this.authManager.refreshUserToken(tokens.refreshToken);
                await this.sessionManager.associateUserTokens(session.sessionId, refreshedTokens);
                
                // Get updated session
                const refreshedSession = await this.sessionManager.getSession(session.sessionId);
                if (refreshedSession) {
                  session = refreshedSession;
                  console.log(`[AuthenticationIntegration] Successfully refreshed user tokens`);
                  return {
                    success: true,
                    session
                  };
                }
              } catch (refreshError) {
                console.log(`[AuthenticationIntegration] Token refresh failed for expired tokens`);
                refreshAttempted = true; // Don't try to refresh other expired tokens
              }
            }
          }
        }

        // Check if we have any valid scopes at all
        const availableScopes = this.sessionManager.getValidScopes(session);
        console.log(`[AuthenticationIntegration] User tokens scope validation - required: [${requiredScopes.join(', ')}], available: [${availableScopes.join(', ')}], hasScopes: false`);
        
        console.log(`[AuthenticationIntegration] User tokens lack required scopes, requesting additional authorization`);
        // Generate authorization challenge for additional scopes
        const authRequest = this.authManager.generateAuthorizationRequest({
          sessionId: session.sessionId,
          scopes: requiredScopes,
          redirectUri: process.env.OAUTH_REDIRECT_URI || `http://localhost:8080/auth/callback`
        });

        return {
          success: false,
          error: 'Insufficient permissions',
          authChallenge: authRequest
        };
      }

      // No user tokens exist, check if user authorization is required
      if (validation.requiresUserAuth) {
        console.log(`[AuthenticationIntegration] No user tokens found, generating authorization challenge`);
        // Generate authorization challenge
        const authRequest = this.authManager.generateAuthorizationRequest({
          sessionId: session.sessionId,
          scopes: requiredScopes,
          redirectUri: process.env.OAUTH_REDIRECT_URI || `http://localhost:8080/auth/callback` // Point to our callback endpoint
        });

        return {
          success: false,
          error: 'User authorization required',
          authChallenge: authRequest
        };
      }

      // If we reach here, session is valid but has no user tokens and doesn't require user auth
      // This should only happen for tools that don't require user authentication
      console.log(`[AuthenticationIntegration] Session valid, no user tokens, but user auth not required`);
      return {
        success: true,
        session
      };

      return {
        success: true,
        session: validation.session || session
      };

    } catch (error) {
      console.error('[AuthenticationIntegration] User authorization check failed:', error);
      return {
        success: false,
        error: 'Authorization check failed'
      };
    }
  }

  /**
   * Create authentication error response for MCP protocol
   */
  createAuthenticationErrorResponse(messageId: string, error: string, authChallenge?: AuthorizationRequest): MCPResponse {
    const errorData: any = {
      type: 'authentication_error',
      message: error,
      challenge_type: 'oauth_authorization_code', // Add the challenge type your client expects
      authorization_url: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize',
      scope: 'banking:accounts:read banking:transactions:read banking:transactions:write'
    };

    if (authChallenge) {
      errorData.authorizationChallenge = this.formatAuthorizationChallenge(authChallenge);
      errorData.authorization_url = authChallenge.authorizationUrl;
      errorData.scope = authChallenge.scope;
    }

    return {
      id: messageId,
      error: {
        code: -32001, // Custom authentication error code
        message: 'Authentication required',
        data: errorData
      }
    };
  }

  /**
   * Create authorization challenge response for tool calls
   */
  createAuthorizationChallengeResponse(messageId: string, authChallenge: AuthorizationRequest): ToolCallResponse {
    const challengeResponse = this.formatAuthorizationChallenge(authChallenge);
    
    // Create the response content with extended authChallenge information
    const responseContent = {
      type: 'text' as const,
      text: challengeResponse.instructions,
      authChallenge: {
        method: "redirect_popup",
        authorizationUrl: authChallenge.authorizationUrl,
        state: authChallenge.state,
        scope: authChallenge.scope,
        sessionId: authChallenge.sessionId,
        expiresAt: authChallenge.expiresAt.toISOString(),
        postMessageOrigin: "*", // Allow any origin for popup communication
        statusEndpoint: `http://localhost:8080/auth/status?sessionId=${authChallenge.sessionId}`,
        uiHints: {
          popupWidth: 500,
          popupHeight: 650,
          popupTitle: "Sign in with PingOne AIC"
        }
      }
    };
    
    return {
      id: messageId,
      result: {
        content: [responseContent as any], // Cast to allow extended format
        isError: false
      }
    };
  }

  /**
   * Format authorization challenge for user-friendly display
   */
  private formatAuthorizationChallenge(authChallenge: AuthorizationRequest): AuthorizationChallengeResponse {
    const instructions = [
      'User authorization is required to access banking data.',
      '',
      'Please follow these steps:',
      '1. Open the following URL in your browser:',
      `   ${authChallenge.authorizationUrl}`,
      '',
      '2. Complete the login and authorization process',
      '',
      '3. Copy the authorization code from the response',
      '',
      '4. Provide the authorization code back to continue',
      '',
      `Session ID: ${authChallenge.sessionId}`,
      `State: ${authChallenge.state}`,
      `Required Scopes: ${authChallenge.scope}`,
      `Expires: ${authChallenge.expiresAt.toISOString()}`
    ].join('\n');

    return {
      authorizationUrl: authChallenge.authorizationUrl,
      state: authChallenge.state,
      scope: authChallenge.scope,
      sessionId: authChallenge.sessionId,
      instructions
    };
  }

  /**
   * Handle authorization code exchange
   */
  async handleAuthorizationCodeExchange(
    sessionId: string,
    authorizationCode: string,
    state: string
  ): Promise<AuthenticationResult> {
    try {
      // Validate authorization state
      const authRequest = this.authManager.validateAuthorizationState(state);
      if (!authRequest) {
        return {
          success: false,
          error: 'Invalid or expired authorization state'
        };
      }

      if (authRequest.sessionId !== sessionId) {
        return {
          success: false,
          error: 'Authorization state does not match session'
        };
      }

      // Exchange authorization code for tokens (must use same redirect URI and code verifier as authorization request)
      const redirectUri = process.env.OAUTH_REDIRECT_URI || `http://localhost:8080/auth/callback`;
      const codeVerifier = authRequest.codeVerifier;
      console.log(`[AuthenticationIntegration] Exchanging code for tokens with verifier: ${codeVerifier ? 'present' : 'missing'}`);
      
      const userTokens = await this.authManager.exchangeAuthorizationCode(authorizationCode, redirectUri, codeVerifier);
      console.log(`[AuthenticationIntegration] Received user tokens for session ${sessionId}`);
      
      // Associate tokens with session
      await this.sessionManager.associateUserTokens(sessionId, userTokens);
      console.log(`[AuthenticationIntegration] Successfully associated user tokens with session ${sessionId}`);
      
      // Complete authorization request
      this.authManager.completeAuthorizationRequest(state);
      
      // Get updated session
      const session = await this.sessionManager.getSession(sessionId);
      
      console.log(`[AuthenticationIntegration] Authorization code exchange completed successfully`);
      console.log(`[AuthenticationIntegration] Session ${sessionId} now has user tokens: ${session?.userTokens ? 'YES' : 'NO'}`);
      
      return {
        success: true,
        session: session || undefined
      };

    } catch (error) {
      console.error('[AuthenticationIntegration] Authorization code exchange failed:', error);
      
      if (error instanceof AuthenticationError) {
        return {
          success: false,
          error: error.message
        };
      }

      return {
        success: false,
        error: 'Authorization code exchange failed'
      };
    }
  }

  /**
   * Validate authentication for specific tool execution
   */
  async validateToolAuthentication(
    session: BankingSession | undefined,
    agentToken: string | undefined,
    requiredScopes: string[]
  ): Promise<AuthenticationResult> {
    // First validate agent authentication
    if (!session && agentToken) {
      const agentAuth = await this.validateAgentAuthentication(agentToken);
      if (!agentAuth.success) {
        // Agent token is invalid - return error so agent can get a new token
        console.log(`[AuthenticationIntegration] Agent token validation failed - returning error`);
        return agentAuth;
      }
      session = agentAuth.session;
    }

    if (!session) {
      return {
        success: false,
        error: 'No valid session found'
      };
    }

    // If no scopes are required, skip user authorization check
    if (!requiredScopes || requiredScopes.length === 0) {
      console.log(`[AuthenticationIntegration] No scopes required - skipping user authorization check`);
      return {
        success: true,
        session
      };
    }

    // Then check user authorization for banking operations
    return await this.checkUserAuthorization(session, requiredScopes);
  }

  /**
   * Get authentication status for a session
   */
  async getAuthenticationStatus(sessionId: string): Promise<{
    hasValidSession: boolean;
    hasUserTokens: boolean;
    tokenExpired: boolean;
    availableScopes: string[];
    tokenExpiresIn?: number;
  }> {
    try {
      const session = await this.sessionManager.getSession(sessionId);
      
      if (!session) {
        return {
          hasValidSession: false,
          hasUserTokens: false,
          tokenExpired: false,
          availableScopes: []
        };
      }

      const validation = await this.sessionManager.validateSession(sessionId);
      
      if (!validation.isValid) {
        return {
          hasValidSession: false,
          hasUserTokens: false,
          tokenExpired: false,
          availableScopes: []
        };
      }

      if (!session.userTokens || session.userTokens.length === 0) {
        return {
          hasValidSession: true,
          hasUserTokens: false,
          tokenExpired: false,
          availableScopes: []
        };
      }

      // Check if any tokens are valid (not expired)
      const validTokens = session.userTokens.filter(tokens => !this.authManager.isTokenExpired(tokens));
      const tokenExpired = validTokens.length === 0;
      
      // Get the earliest expiration time from valid tokens
      let tokenExpiresIn = 0;
      if (validTokens.length > 0) {
        const earliestExpiry = Math.min(...validTokens.map(tokens => this.authManager.getTokenLifetime(tokens)));
        tokenExpiresIn = earliestExpiry;
      }
      
      // Get all available scopes from valid tokens
      const availableScopes = this.sessionManager.getValidScopes(session);

      return {
        hasValidSession: true,
        hasUserTokens: true,
        tokenExpired,
        availableScopes,
        tokenExpiresIn
      };

    } catch (error) {
      console.error('[AuthenticationIntegration] Error getting authentication status:', error);
      return {
        hasValidSession: false,
        hasUserTokens: false,
        tokenExpired: false,
        availableScopes: []
      };
    }
  }
}