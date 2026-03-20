/**
 * Authentication Integration Tests
 * Unit tests for authentication integration into MCP message processing
 */

import { AuthenticationIntegration } from '../../src/server/AuthenticationIntegration';
import { BankingAuthenticationManager } from '../../src/auth/BankingAuthenticationManager';
import { BankingSessionManager, BankingSession, UserTokens } from '../../src/storage/BankingSessionManager';
import { PingOneConfig, AgentTokenInfo, AuthenticationError, AuthErrorCodes } from '../../src/interfaces/auth';
import { AuthorizationRequest } from '../../src/interfaces/mcp';

// Mock dependencies
jest.mock('../../src/auth/BankingAuthenticationManager');
jest.mock('../../src/storage/BankingSessionManager');

describe('AuthenticationIntegration', () => {
  let authIntegration: AuthenticationIntegration;
  let mockAuthManager: jest.Mocked<BankingAuthenticationManager>;
  let mockSessionManager: jest.Mocked<BankingSessionManager>;

  beforeEach(() => {
    const mockPingOneConfig: PingOneConfig = {
      baseUrl: 'https://openam-dna.forgeblocks.com:443',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      tokenIntrospectionEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/introspect',
      authorizationEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize',
      tokenEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/access_token'
    };

    mockAuthManager = new BankingAuthenticationManager(mockPingOneConfig) as jest.Mocked<BankingAuthenticationManager>;
    mockSessionManager = new BankingSessionManager('test-path', 'test-key') as jest.Mocked<BankingSessionManager>;

    // Set up default mocks
    mockAuthManager.validateAgentToken = jest.fn();
    mockAuthManager.generateAuthorizationRequest = jest.fn();
    mockAuthManager.validateBankingScopes = jest.fn();
    mockAuthManager.isTokenExpired = jest.fn();
    mockAuthManager.refreshUserToken = jest.fn();
    mockAuthManager.validateAuthorizationState = jest.fn();
    mockAuthManager.exchangeAuthorizationCode = jest.fn();
    mockAuthManager.completeAuthorizationRequest = jest.fn();
    mockAuthManager.getTokenLifetime = jest.fn();

    mockSessionManager.getSessionByAgentToken = jest.fn();
    mockSessionManager.createSession = jest.fn();
    mockSessionManager.validateSession = jest.fn();
    mockSessionManager.associateUserTokens = jest.fn();
    mockSessionManager.getSession = jest.fn();

    authIntegration = new AuthenticationIntegration(mockAuthManager, mockSessionManager);
  });

  describe('Agent Authentication', () => {
    it('should validate agent token and create session', async () => {
      const mockAgentTokenInfo: AgentTokenInfo = {
        tokenHash: 'test-hash',
        clientId: 'test-client',
        scopes: ['banking:agent'],
        expiresAt: new Date(Date.now() + 3600000),
        isValid: true
      };

      const mockSession: BankingSession = {
        sessionId: 'test-session-1',
        agentTokenHash: 'test-hash',
        createdAt: new Date(),
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + 3600000)
      };

      mockAuthManager.validateAgentToken.mockResolvedValue(mockAgentTokenInfo);
      mockSessionManager.getSessionByAgentToken.mockResolvedValue(null);
      mockSessionManager.createSession.mockResolvedValue(mockSession);

      const result = await authIntegration.validateAgentAuthentication('test-agent-token');

      expect(result.success).toBe(true);
      expect(result.session).toBe(mockSession);
      expect(mockAuthManager.validateAgentToken).toHaveBeenCalledWith('test-agent-token');
      expect(mockSessionManager.createSession).toHaveBeenCalledWith('test-agent-token');
    });

    it('should use existing session if available', async () => {
      const mockAgentTokenInfo: AgentTokenInfo = {
        tokenHash: 'test-hash',
        clientId: 'test-client',
        scopes: ['banking:agent'],
        expiresAt: new Date(Date.now() + 3600000),
        isValid: true
      };

      const mockSession: BankingSession = {
        sessionId: 'existing-session',
        agentTokenHash: 'test-hash',
        createdAt: new Date(),
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + 3600000)
      };

      mockAuthManager.validateAgentToken.mockResolvedValue(mockAgentTokenInfo);
      mockSessionManager.getSessionByAgentToken.mockResolvedValue(mockSession);

      const result = await authIntegration.validateAgentAuthentication('test-agent-token');

      expect(result.success).toBe(true);
      expect(result.session).toBe(mockSession);
      expect(mockSessionManager.createSession).not.toHaveBeenCalled();
    });

    it('should handle invalid agent token', async () => {
      const mockAgentTokenInfo: AgentTokenInfo = {
        tokenHash: 'test-hash',
        clientId: 'test-client',
        scopes: [],
        expiresAt: new Date(),
        isValid: false
      };

      mockAuthManager.validateAgentToken.mockResolvedValue(mockAgentTokenInfo);

      const result = await authIntegration.validateAgentAuthentication('invalid-token');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid agent token');
    });

    it('should handle authentication service errors', async () => {
      mockAuthManager.validateAgentToken.mockRejectedValue(new Error('Service unavailable'));

      const result = await authIntegration.validateAgentAuthentication('test-token');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authentication service unavailable');
    });
  });

  describe('User Authorization', () => {
    let mockSession: BankingSession;

    beforeEach(() => {
      mockSession = {
        sessionId: 'test-session-1',
        agentTokenHash: 'test-hash',
        createdAt: new Date(),
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + 3600000)
      };
    });

    it('should pass when user tokens are valid and have required scopes', async () => {
      const mockUserTokens: UserTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'banking:accounts:read banking:transactions:read',
        issuedAt: new Date()
      };

      mockSession.userTokens = mockUserTokens;

      mockSessionManager.validateSession.mockResolvedValue({
        isValid: true,
        requiresUserAuth: false,
        session: mockSession
      });

      mockAuthManager.validateBankingScopes.mockReturnValue(true);
      mockAuthManager.isTokenExpired.mockReturnValue(false);

      const result = await authIntegration.checkUserAuthorization(mockSession, ['banking:accounts:read']);

      expect(result.success).toBe(true);
      expect(result.session).toBe(mockSession);
    });

    it('should generate authorization challenge when user auth required', async () => {
      mockSessionManager.validateSession.mockResolvedValue({
        isValid: true,
        requiresUserAuth: true,
        session: mockSession
      });

      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize?client_id=test',
        state: 'test-state',
        scope: 'banking:accounts:read',
        sessionId: 'test-session-1',
        expiresAt: new Date(Date.now() + 300000)
      };

      mockAuthManager.generateAuthorizationRequest.mockReturnValue(mockAuthRequest);

      const result = await authIntegration.checkUserAuthorization(mockSession, ['banking:accounts:read']);

      expect(result.success).toBe(false);
      expect(result.error).toBe('User authorization required');
      expect(result.authChallenge).toBe(mockAuthRequest);
    });

    it('should refresh expired tokens', async () => {
      const mockUserTokens: UserTokens = {
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'banking:accounts:read',
        issuedAt: new Date(Date.now() - 7200000) // 2 hours ago
      };

      const mockRefreshedTokens: UserTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'banking:accounts:read',
        issuedAt: new Date()
      };

      mockSession.userTokens = mockUserTokens;

      mockSessionManager.validateSession.mockResolvedValue({
        isValid: true,
        requiresUserAuth: false,
        session: mockSession
      });

      mockAuthManager.validateBankingScopes.mockReturnValue(true);
      mockAuthManager.isTokenExpired.mockReturnValue(true);
      mockAuthManager.refreshUserToken.mockResolvedValue(mockRefreshedTokens);
      mockSessionManager.associateUserTokens.mockResolvedValue();

      const result = await authIntegration.checkUserAuthorization(mockSession, ['banking:accounts:read']);

      expect(result.success).toBe(true);
      expect(result.session?.userTokens).toBe(mockRefreshedTokens);
      expect(mockAuthManager.refreshUserToken).toHaveBeenCalledWith('refresh-token');
      expect(mockSessionManager.associateUserTokens).toHaveBeenCalledWith('test-session-1', mockRefreshedTokens);
    });

    it('should handle token refresh failure', async () => {
      const mockUserTokens: UserTokens = {
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'banking:accounts:read',
        issuedAt: new Date(Date.now() - 7200000)
      };

      mockSession.userTokens = mockUserTokens;

      mockSessionManager.validateSession.mockResolvedValue({
        isValid: true,
        requiresUserAuth: false,
        session: mockSession
      });

      mockAuthManager.validateBankingScopes.mockReturnValue(true);
      mockAuthManager.isTokenExpired.mockReturnValue(true);
      mockAuthManager.refreshUserToken.mockRejectedValue(new Error('Refresh failed'));

      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://test.pingone.com/authorize?client_id=test',
        state: 'test-state',
        scope: 'banking:accounts:read',
        sessionId: 'test-session-1',
        expiresAt: new Date(Date.now() + 300000)
      };

      mockAuthManager.generateAuthorizationRequest.mockReturnValue(mockAuthRequest);

      const result = await authIntegration.checkUserAuthorization(mockSession, ['banking:accounts:read']);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Token expired and refresh failed');
      expect(result.authChallenge).toBe(mockAuthRequest);
    });

    it('should handle insufficient scopes', async () => {
      const mockUserTokens: UserTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'banking:accounts:read',
        issuedAt: new Date()
      };

      mockSession.userTokens = mockUserTokens;

      mockSessionManager.validateSession.mockResolvedValue({
        isValid: true,
        requiresUserAuth: false,
        session: mockSession
      });

      mockAuthManager.validateBankingScopes.mockReturnValue(false);
      mockAuthManager.isTokenExpired.mockReturnValue(false);

      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://test.pingone.com/authorize?client_id=test',
        state: 'test-state',
        scope: 'banking:transactions:write',
        sessionId: 'test-session-1',
        expiresAt: new Date(Date.now() + 300000)
      };

      mockAuthManager.generateAuthorizationRequest.mockReturnValue(mockAuthRequest);

      const result = await authIntegration.checkUserAuthorization(mockSession, ['banking:transactions:write']);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient permissions');
      expect(result.authChallenge).toBe(mockAuthRequest);
    });
  });

  describe('Authorization Code Exchange', () => {
    it('should exchange authorization code successfully', async () => {
      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://test.pingone.com/authorize',
        state: 'test-state',
        scope: 'banking:accounts:read',
        sessionId: 'test-session-1',
        expiresAt: new Date(Date.now() + 300000)
      };

      const mockUserTokens: UserTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'banking:accounts:read',
        issuedAt: new Date()
      };

      const mockSession: BankingSession = {
        sessionId: 'test-session-1',
        agentTokenHash: 'test-hash',
        userTokens: mockUserTokens,
        createdAt: new Date(),
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + 3600000)
      };

      mockAuthManager.validateAuthorizationState.mockReturnValue(mockAuthRequest);
      mockAuthManager.exchangeAuthorizationCode.mockResolvedValue(mockUserTokens);
      mockSessionManager.associateUserTokens.mockResolvedValue();
      mockAuthManager.completeAuthorizationRequest.mockReturnValue(true);
      mockSessionManager.getSession.mockResolvedValue(mockSession);

      const result = await authIntegration.handleAuthorizationCodeExchange(
        'test-session-1',
        'auth-code-123',
        'test-state'
      );

      expect(result.success).toBe(true);
      expect(result.session).toBe(mockSession);
      expect(mockAuthManager.exchangeAuthorizationCode).toHaveBeenCalledWith('auth-code-123');
      expect(mockSessionManager.associateUserTokens).toHaveBeenCalledWith('test-session-1', mockUserTokens);
      expect(mockAuthManager.completeAuthorizationRequest).toHaveBeenCalledWith('test-state');
    });

    it('should handle invalid authorization state', async () => {
      mockAuthManager.validateAuthorizationState.mockReturnValue(null);

      const result = await authIntegration.handleAuthorizationCodeExchange(
        'test-session-1',
        'auth-code-123',
        'invalid-state'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid or expired authorization state');
    });

    it('should handle session mismatch', async () => {
      const mockAuthRequest: AuthorizationRequest = {
        authorizationUrl: 'https://test.pingone.com/authorize',
        state: 'test-state',
        scope: 'banking:accounts:read',
        sessionId: 'different-session',
        expiresAt: new Date(Date.now() + 300000)
      };

      mockAuthManager.validateAuthorizationState.mockReturnValue(mockAuthRequest);

      const result = await authIntegration.handleAuthorizationCodeExchange(
        'test-session-1',
        'auth-code-123',
        'test-state'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Authorization state does not match session');
    });
  });

  describe('Tool Authentication Validation', () => {
    it('should validate complete authentication flow', async () => {
      const mockAgentTokenInfo: AgentTokenInfo = {
        tokenHash: 'test-hash',
        clientId: 'test-client',
        scopes: ['banking:agent'],
        expiresAt: new Date(Date.now() + 3600000),
        isValid: true
      };

      const mockUserTokens: UserTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'banking:accounts:read',
        issuedAt: new Date()
      };

      const mockSession: BankingSession = {
        sessionId: 'test-session-1',
        agentTokenHash: 'test-hash',
        userTokens: mockUserTokens,
        createdAt: new Date(),
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + 3600000)
      };

      // Mock agent authentication
      mockAuthManager.validateAgentToken.mockResolvedValue(mockAgentTokenInfo);
      mockSessionManager.getSessionByAgentToken.mockResolvedValue(mockSession);

      // Mock user authorization
      mockSessionManager.validateSession.mockResolvedValue({
        isValid: true,
        requiresUserAuth: false,
        session: mockSession
      });
      mockAuthManager.validateBankingScopes.mockReturnValue(true);
      mockAuthManager.isTokenExpired.mockReturnValue(false);

      const result = await authIntegration.validateToolAuthentication(
        undefined,
        'test-agent-token',
        ['banking:accounts:read']
      );

      expect(result.success).toBe(true);
      expect(result.session).toBe(mockSession);
    });
  });

  describe('Authentication Status', () => {
    it('should return complete authentication status', async () => {
      const mockUserTokens: UserTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'banking:accounts:read banking:transactions:read',
        issuedAt: new Date()
      };

      const mockSession: BankingSession = {
        sessionId: 'test-session-1',
        agentTokenHash: 'test-hash',
        userTokens: mockUserTokens,
        createdAt: new Date(),
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + 3600000)
      };

      mockSessionManager.getSession.mockResolvedValue(mockSession);
      mockSessionManager.validateSession.mockResolvedValue({
        isValid: true,
        requiresUserAuth: false,
        session: mockSession
      });
      mockAuthManager.isTokenExpired.mockReturnValue(false);
      mockAuthManager.getTokenLifetime.mockReturnValue(3600);

      const status = await authIntegration.getAuthenticationStatus('test-session-1');

      expect(status.hasValidSession).toBe(true);
      expect(status.hasUserTokens).toBe(true);
      expect(status.tokenExpired).toBe(false);
      expect(status.availableScopes).toEqual(['banking:accounts:read', 'banking:transactions:read']);
      expect(status.tokenExpiresIn).toBe(3600);
    });

    it('should handle session not found', async () => {
      mockSessionManager.getSession.mockResolvedValue(null);

      const status = await authIntegration.getAuthenticationStatus('nonexistent-session');

      expect(status.hasValidSession).toBe(false);
      expect(status.hasUserTokens).toBe(false);
      expect(status.tokenExpired).toBe(false);
      expect(status.availableScopes).toEqual([]);
    });
  });
});