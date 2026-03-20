/**
 * Unit tests for TokenIntrospector
 */

import axios from 'axios';
import { TokenIntrospector } from '../../src/auth/TokenIntrospector';
import { PingOneConfig, TokenInfo, AuthenticationError, AuthErrorCodes } from '../../src/interfaces/auth';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('TokenIntrospector', () => {
  let tokenIntrospector: TokenIntrospector;
  let mockConfig: PingOneConfig;
  let mockAxiosInstance: jest.Mocked<any>;

  beforeEach(() => {
    mockConfig = {
      baseUrl: 'https://openam-dna.forgeblocks.com:443',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      tokenIntrospectionEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/introspect',
      authorizationEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/authorize',
      tokenEndpoint: 'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/access_token'
    };

    mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      patch: jest.fn()
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance);
    tokenIntrospector = new TokenIntrospector(mockConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('introspectToken', () => {
    it('should successfully introspect an active token', async () => {
      const mockTokenInfo: TokenInfo = {
        active: true,
        scope: 'banking:read banking:write',
        client_id: 'test-client',
        username: 'test-user',
        token_type: 'Bearer',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000),
        sub: 'user-123',
        aud: 'banking-api',
        iss: 'https://auth.pingone.com'
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockTokenInfo });

      const result = await tokenIntrospector.introspectToken('valid-token');

      expect(result).toEqual(mockTokenInfo);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        'https://openam-dna.forgeblocks.com:443/am/oauth2/realms/root/realms/alpha/introspect',
        'token=valid-token&client_id=test-client-id&client_secret=test-client-secret'
      );
    });

    it('should handle inactive token response', async () => {
      const mockTokenInfo: TokenInfo = {
        active: false
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockTokenInfo });

      const result = await tokenIntrospector.introspectToken('inactive-token');

      expect(result).toEqual(mockTokenInfo);
    });

    it('should throw AuthenticationError for 401 response', async () => {
      mockAxiosInstance.post.mockRejectedValue({
        isAxiosError: true,
        response: { status: 401 }
      });

      await expect(tokenIntrospector.introspectToken('invalid-token'))
        .rejects.toThrow(AuthenticationError);
      
      await expect(tokenIntrospector.introspectToken('invalid-token'))
        .rejects.toMatchObject({
          code: AuthErrorCodes.INVALID_AGENT_TOKEN,
          message: 'Invalid client credentials for token introspection'
        });
    });

    it('should throw AuthenticationError for 400 response', async () => {
      mockAxiosInstance.post.mockRejectedValue({
        isAxiosError: true,
        response: { status: 400 }
      });

      await expect(tokenIntrospector.introspectToken('malformed-token'))
        .rejects.toThrow(AuthenticationError);
      
      await expect(tokenIntrospector.introspectToken('malformed-token'))
        .rejects.toMatchObject({
          code: AuthErrorCodes.INVALID_AGENT_TOKEN,
          message: 'Invalid token format'
        });
    });

    it('should throw generic error for network failures', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      await expect(tokenIntrospector.introspectToken('token'))
        .rejects.toThrow('Token introspection failed: Network error');
    });
  });

  describe('validateAgentToken', () => {
    it('should validate an active token with scopes', async () => {
      const mockTokenInfo: TokenInfo = {
        active: true,
        scope: 'banking:read banking:write',
        client_id: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        iat: Math.floor(Date.now() / 1000)
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockTokenInfo });

      const result = await tokenIntrospector.validateAgentToken('valid-token');

      expect(result).toMatchObject({
        clientId: 'test-client',
        scopes: ['banking:read', 'banking:write'],
        isValid: true
      });
      expect(result.tokenHash).toHaveLength(16);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should throw error for inactive token', async () => {
      const mockTokenInfo: TokenInfo = {
        active: false
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockTokenInfo });

      await expect(tokenIntrospector.validateAgentToken('inactive-token'))
        .rejects.toThrow(AuthenticationError);
      
      await expect(tokenIntrospector.validateAgentToken('inactive-token'))
        .rejects.toMatchObject({
          code: AuthErrorCodes.INVALID_AGENT_TOKEN,
          message: 'Agent token is not active'
        });
    });

    it('should throw error for expired token', async () => {
      const mockTokenInfo: TokenInfo = {
        active: true,
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        client_id: 'test-client'
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockTokenInfo });

      await expect(tokenIntrospector.validateAgentToken('expired-token'))
        .rejects.toThrow(AuthenticationError);
      
      await expect(tokenIntrospector.validateAgentToken('expired-token'))
        .rejects.toMatchObject({
          code: AuthErrorCodes.TOKEN_EXPIRED,
          message: 'Agent token has expired'
        });
    });

    it('should handle token without scopes', async () => {
      const mockTokenInfo: TokenInfo = {
        active: true,
        client_id: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockTokenInfo });

      const result = await tokenIntrospector.validateAgentToken('token-no-scopes');

      expect(result.scopes).toEqual([]);
    });

    it('should use default expiration when exp is not provided', async () => {
      const mockTokenInfo: TokenInfo = {
        active: true,
        client_id: 'test-client'
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockTokenInfo });

      const result = await tokenIntrospector.validateAgentToken('token-no-exp');

      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('validateTokenScopes', () => {
    it('should return true when token has all required scopes', async () => {
      const mockTokenInfo: TokenInfo = {
        active: true,
        scope: 'banking:read banking:write admin:users',
        client_id: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockTokenInfo });

      const result = await tokenIntrospector.validateTokenScopes('valid-token', ['banking:read', 'banking:write']);

      expect(result).toBe(true);
    });

    it('should return false when token is missing required scopes', async () => {
      const mockTokenInfo: TokenInfo = {
        active: true,
        scope: 'banking:read',
        client_id: 'test-client',
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockTokenInfo });

      const result = await tokenIntrospector.validateTokenScopes('limited-token', ['banking:read', 'banking:write']);

      expect(result).toBe(false);
    });

    it('should return false for invalid token', async () => {
      mockAxiosInstance.post.mockRejectedValue({
        isAxiosError: true,
        response: { status: 401 }
      });

      const result = await tokenIntrospector.validateTokenScopes('invalid-token', ['banking:read']);

      expect(result).toBe(false);
    });

    it('should throw error for non-authentication errors', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      await expect(tokenIntrospector.validateTokenScopes('token', ['banking:read']))
        .rejects.toThrow('Network error');
    });
  });

  describe('healthCheck', () => {
    it('should return true when endpoint returns 400 (bad request)', async () => {
      mockAxiosInstance.post.mockRejectedValue({
        isAxiosError: true,
        response: { status: 400 }
      });

      const result = await tokenIntrospector.healthCheck();

      expect(result).toBe(true);
    });

    it('should return true when endpoint returns 401 (unauthorized)', async () => {
      mockAxiosInstance.post.mockRejectedValue({
        isAxiosError: true,
        response: { status: 401 }
      });

      const result = await tokenIntrospector.healthCheck();

      expect(result).toBe(true);
    });

    it('should return false for network errors', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      const result = await tokenIntrospector.healthCheck();

      expect(result).toBe(false);
    });

    it('should return true for successful response', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: { active: false } });

      const result = await tokenIntrospector.healthCheck();

      expect(result).toBe(true);
    });
  });
});