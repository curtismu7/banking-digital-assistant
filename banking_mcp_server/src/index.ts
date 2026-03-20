/**
 * Main entry point for the Banking MCP Server
 */

import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

import { loadConfiguration, validateConfiguration, ConfigurationError } from './config';
import { BankingMCPServerConfig } from './interfaces';
import { BankingMCPServer } from './server/BankingMCPServer';
import { BankingAuthenticationManager } from './auth/BankingAuthenticationManager';
import { BankingSessionManager } from './storage/BankingSessionManager';
import { BankingToolProvider } from './tools/BankingToolProvider';
import { BankingAPIClient } from './banking/BankingAPIClient';

// Export all types and interfaces for library usage
export * from './types';
export * from './config';

// Export specific interfaces to avoid conflicts
export type { 
  BankingMCPServerConfig,
  EnvironmentVariables,
  DEFAULT_CONFIG
} from './interfaces';

export { 
  AuthenticationError,
  BankingAPIError
} from './interfaces';

export {
  loadConfiguration,
  validateConfiguration,
  ConfigurationError
} from './config';

// Export the main server class
export { BankingMCPServer } from './server/BankingMCPServer';

let server: BankingMCPServer | null = null;

async function main(): Promise<void> {
  try {
    console.log('Banking MCP Server starting...');
    
    // Load and validate configuration
    const config: BankingMCPServerConfig = loadConfiguration();
    validateConfiguration(config);
    
    console.log(`Server configured to run on ${config.server.host}:${config.server.port}`);
    console.log(`Banking API endpoint: ${config.bankingApi.baseUrl}`);
    console.log(`PingOne endpoint: ${config.pingone.baseUrl}`);
    
    // Initialize server components
    console.log('Initializing server components...');
    
    // Initialize authentication manager
    const authManager = new BankingAuthenticationManager(config.pingone);
    
    // Initialize session manager
    const sessionManager = new BankingSessionManager(
      config.security.tokenStoragePath,
      config.security.encryptionKey,
      3600, // Cache TTL
      config.security.sessionCleanupInterval
    );
    
    // Initialize banking API client
    const bankingClient = new BankingAPIClient({
      baseUrl: config.bankingApi.baseUrl,
      timeout: config.bankingApi.timeout,
      maxRetries: config.bankingApi.maxRetries,
      circuitBreakerThreshold: config.bankingApi.circuitBreakerThreshold
    });
    
    // Initialize tool provider
    const toolProvider = new BankingToolProvider(bankingClient, authManager, sessionManager);
    
    // Initialize and start MCP server
    const serverConfig = {
      host: config.server.host,
      port: config.server.port,
      maxConnections: config.server.maxConnections,
      sessionTimeout: config.server.sessionTimeout,
      enableLogging: config.logging.level === 'DEBUG'
    };
    
    server = new BankingMCPServer(serverConfig, authManager, sessionManager, toolProvider);
    
    console.log('Starting MCP server...');
    await server.startServer();
    
    console.log(`✅ Banking MCP Server is running on ${config.server.host}:${config.server.port}`);
    console.log('Server is ready to accept MCP connections.');
    
    // Keep the process running
    process.stdin.resume();
    
  } catch (error) {
    if (error instanceof ConfigurationError) {
      console.error('Configuration error:', error.message);
      process.exit(1);
    } else {
      console.error('Unexpected error:', error);
      console.error(error);
      process.exit(1);
    }
  }
}

// Handle graceful shutdown
async function shutdown(signal: string): Promise<void> {
  console.log(`\nReceived ${signal}, shutting down gracefully...`);
  
  if (server) {
    try {
      console.log('Stopping MCP server...');
      await server.stopServer();
      console.log('Server stopped successfully.');
    } catch (error) {
      console.error('Error stopping server:', error);
    }
  }
  
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  shutdown('unhandledRejection');
});

if (require.main === module) {
  main().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}