/**
 * Server Configuration Interfaces
 * Core interfaces for server configuration and environment setup
 */

import { PingOneConfig, BankingAPIConfig } from './index';

export interface SecurityConfig {
  encryptionKey: string;
  tokenStoragePath: string;
  sessionCleanupInterval: number;
  maxSessionDuration: number;
}

export interface ServerConfig {
  host: string;
  port: number;
  maxConnections: number;
  sessionTimeout: number;
}

export interface LoggingConfig {
  level: string;
  auditLogPath: string;
  securityLogPath: string;
}

export interface BankingMCPServerConfig {
  server: ServerConfig;
  pingone: PingOneConfig;
  bankingApi: BankingAPIConfig;
  security: SecurityConfig;
  logging: LoggingConfig;
}

export interface EnvironmentVariables {
  // Server configuration
  MCP_SERVER_HOST?: string;
  MCP_SERVER_PORT?: string;
  MAX_CONNECTIONS?: string;
  SESSION_TIMEOUT?: string;

  // PingOne configuration
  PINGONE_BASE_URL?: string;
  PINGONE_CLIENT_ID?: string;
  PINGONE_CLIENT_SECRET?: string;
  PINGONE_INTROSPECTION_ENDPOINT?: string;
  PINGONE_AUTHORIZATION_ENDPOINT?: string;
  PINGONE_TOKEN_ENDPOINT?: string;

  // Banking API configuration
  BANKING_API_BASE_URL?: string;
  BANKING_API_TIMEOUT?: string;
  BANKING_API_MAX_RETRIES?: string;
  CIRCUIT_BREAKER_THRESHOLD?: string;

  // Security configuration
  ENCRYPTION_KEY?: string;
  TOKEN_STORAGE_PATH?: string;
  SESSION_CLEANUP_INTERVAL?: string;
  MAX_SESSION_DURATION?: string;

  // Logging configuration
  LOG_LEVEL?: string;
  AUDIT_LOG_PATH?: string;
  SECURITY_LOG_PATH?: string;
}

export const DEFAULT_CONFIG: Omit<BankingMCPServerConfig, 'pingone'> = {
  server: {
    host: '0.0.0.0',
    port: 8080,
    maxConnections: 100,
    sessionTimeout: 3600
  },
  bankingApi: {
    baseUrl: 'http://localhost:3001',
    timeout: 30000,
    maxRetries: 3,
    circuitBreakerThreshold: 5
  },
  security: {
    encryptionKey: '', // Must be provided via environment
    tokenStoragePath: './data/tokens',
    sessionCleanupInterval: 300,
    maxSessionDuration: 86400
  },
  logging: {
    level: 'INFO',
    auditLogPath: './logs/audit.log',
    securityLogPath: './logs/security.log'
  }
};