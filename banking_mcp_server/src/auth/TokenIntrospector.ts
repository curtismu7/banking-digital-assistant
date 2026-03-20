/**
 * Token Introspector for PingOne Advanced Identity Cloud
 * Handles token validation and introspection with PingOne endpoints
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { PingOneConfig, TokenInfo, AgentTokenInfo, AuthenticationError, AuthErrorCodes } from '../interfaces/auth';

export class TokenIntrospector {
  private httpClient: AxiosInstance;
  private config: PingOneConfig;

  constructor(config: PingOneConfig) {
    this.config = config;
    this.httpClient = axios.create({
      baseURL: config.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      }
    });
  }

  /**
   * Introspect a token using PingOne Advanced Identity Cloud introspection endpoint
   */
  async introspectToken(token: string): Promise<TokenInfo> {
    try {
      console.log(`[TokenIntrospector] Calling introspection endpoint: ${this.config.tokenIntrospectionEndpoint}`);
      console.log(`[TokenIntrospector] Using client_id: ${this.config.clientId}`);
      
      const response = await this.httpClient.post(
        this.config.tokenIntrospectionEndpoint,
        new URLSearchParams({
          token: token,
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        }).toString()
      );

      console.log(`[TokenIntrospector] Introspection response status: ${response.status}`);
      console.log(`[TokenIntrospector] Introspection response data:`, response.data);

      return response.data as TokenInfo;
    } catch (error) {
      if (error && typeof error === 'object' && 'isAxiosError' in error) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 401) {
          throw new AuthenticationError(
            'Invalid client credentials for token introspection',
            AuthErrorCodes.INVALID_AGENT_TOKEN
          );
        }
        if (axiosError.response?.status === 400) {
          throw new AuthenticationError(
            'Invalid token format',
            AuthErrorCodes.INVALID_AGENT_TOKEN
          );
        }
      }
      throw new Error(`Token introspection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validate agent token and extract token information
   */
  async validateAgentToken(token: string): Promise<AgentTokenInfo> {
    console.log(`[TokenIntrospector] Validating agent token...`);
    const tokenInfo = await this.introspectToken(token);
    
    console.log(`[TokenIntrospector] Token introspection result:`, {
      active: tokenInfo.active,
      client_id: tokenInfo.client_id,
      scope: tokenInfo.scope,
      exp: tokenInfo.exp,
      token_type: tokenInfo.token_type
    });

    if (!tokenInfo.active) {
      throw new AuthenticationError(
        'Agent token is not active',
        AuthErrorCodes.INVALID_AGENT_TOKEN
      );
    }

    // Check if token is expired
    if (tokenInfo.exp && tokenInfo.exp < Math.floor(Date.now() / 1000)) {
      throw new AuthenticationError(
        'Agent token has expired',
        AuthErrorCodes.TOKEN_EXPIRED
      );
    }

    // Extract scopes from token
    const scopes = tokenInfo.scope ? tokenInfo.scope.split(' ') : [];

    return {
      tokenHash: this.hashToken(token),
      clientId: tokenInfo.client_id || 'unknown',
      scopes: scopes,
      expiresAt: tokenInfo.exp ? new Date(tokenInfo.exp * 1000) : new Date(Date.now() + 3600000), // Default 1 hour
      isValid: true
    };
  }

  /**
   * Validate that a token has the required scopes
   */
  async validateTokenScopes(token: string, requiredScopes: string[]): Promise<boolean> {
    try {
      const agentTokenInfo = await this.validateAgentToken(token);
      
      // Check if all required scopes are present
      return requiredScopes.every(scope => agentTokenInfo.scopes.includes(scope));
    } catch (error) {
      if (error instanceof AuthenticationError) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Hash token for secure storage (using first 8 chars of SHA-256)
   */
  private hashToken(token: string): string {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
  }

  /**
   * Check if token introspection endpoint is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Try to introspect with an invalid token to test endpoint availability
      await this.httpClient.post(
        this.config.tokenIntrospectionEndpoint,
        new URLSearchParams({
          token: 'invalid_token_for_health_check',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret
        }).toString()
      );
      return true;
    } catch (error) {
      if (error && typeof error === 'object' && 'isAxiosError' in error) {
        const axiosError = error as AxiosError;
        // If we get a 400 or 401, the endpoint is reachable
        return axiosError.response?.status === 400 || axiosError.response?.status === 401;
      }
      return false;
    }
  }
}