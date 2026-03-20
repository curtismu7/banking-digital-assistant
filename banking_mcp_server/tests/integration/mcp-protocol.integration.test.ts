/**
 * End-to-end MCP protocol integration tests
 * Tests complete MCP handshake, tool listing, tool execution with authentication challenges,
 * user authorization, and performance tests for concurrent agent sessions
 */

import WebSocket from 'ws';
import { BankingMCPServer, ServerConfig } from '../../src/server/BankingMCPServer';
import { BankingAuthenticationManager } from '../../src/auth/BankingAuthenticationManager';
import { BankingSessionManager } from '../../src/storage/BankingSessionManager';
import { BankingToolProvider } from '../../src/tools/BankingToolProvider';
import { BankingAPIClient } from '../../src/banking/BankingAPIClient';
import { 
  MCPMessage, 
  MCPResponse, 
  HandshakeMessage, 
  ListToolsMessage, 
  ToolCallMessage 
} from '../../src/interfaces/mcp';
import { PingOneConfig, UserTokens } from '../../src/interfaces/auth';
import { Account, Transaction } from '../../src/interfaces/banking';
import axios from 'axios';
import { promises as fs } from 'fs';
import { join } from 'path';

// Mock axios for API calls
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('MCP Protocol End-to-End Integration Tests', () => {
  let server: BankingMCPServer;
  let authManager: BankingAuthenticationManager;
  let sessionManager: BankingSessionManager;
  let toolProvider: BankingToolProvider;
  let bankingClient: BankingAPIClient;
  let serverConfig: ServerConfig;
  let testStoragePath: string;
  let testEncryptionKey: string;
  let serverPort: number;

  // Test data
  const mockAccounts: Account[] = [
    {
      id: 'acc-123',
      userId: 'user-456',
      accountType: 'checking',
      accountNumber: '1234567890',
      balance: 1500.50,
      status: 'active',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
  ];

  beforeAll(async () => {
    // Setup test storage
    testStoragePath = join(__dirname, '../storage/test-mcp-integration');
    testEncryptionKey = 'test-encryption-key-32-chars-long!';

    // Ensure test directory exists
    await fs.mkdir(testStoragePath, { recursive: true });

    // Setup test configuration
    const testConfig: PingOneConfig = {
      baseUrl: 'https://test.pingone.com',
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      tokenIntrospectionEndpoint: '/as/introspect',
      authorizationEndpoint: '/as/authorization',
      tokenEndpoint: '/as/token'
    };

    // Find available port
    serverPort = 8080 + Math.floor(Math.random() * 1000);

    serverConfig = {
      host: 'localhost',
      port: serverPort,
      maxConnections: 100,
      sessionTimeout: 3600,
      enableLogging: false
    };

    // Initialize components
    authManager = new BankingAuthenticationManager(testConfig);
    sessionManager = new BankingSessionManager(
      testStoragePath,
      testEncryptionKey,
      3600,
      60,
      { enableDetailedLogging: false }
    );
    bankingClient = new BankingAPIClient({
      baseUrl: 'http://localhost:3001',
      timeout: 30000
    });
    toolProvider = new BankingToolProvider(bankingClient, authManager, sessionManager);
    server = new BankingMCPServer(serverConfig, authManager, sessionManager, toolProvider);

    // Setup axios mock defaults
    mockedAxios.create.mockReturnValue(mockedAxios);

    // Start server
    await server.startServer();
    
    // Wait a bit for server to be ready
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    // Cleanup test resources
    await server.stopServer();
    authManager.destroy();
    sessionManager.destroy();

    // Clean up test storage
    try {
      await fs.rm(testStoragePath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
  });

  describe('MCP Handshake and Connection Management', () => {
    it('should complete MCP handshake successfully', async () => {
      // Arrange
      const ws = new WebSocket(`ws://localhost:${serverPort}`);
      
      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      const handshakeMessage: HandshakeMessage = {
        id: 'handshake-1',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false }
          },
          clientInfo: {
            name: 'Test MCP Client',
            version: '1.0.0'
          }
        }
      };

      // Act
      const response = await sendMessageAndWaitForResponse(ws, handshakeMessage);

      // Assert
      expect(response.id).toBe('handshake-1');
      expect(response.result).toBeDefined();
      expect(response.result!.protocolVersion).toBe('2024-11-05');
      expect(response.result!.serverInfo).toMatchObject({
        name: 'Banking MCP Server',
        version: '1.0.0',
        description: expect.stringContaining('banking operations')
      });
      expect(response.result!.capabilities).toMatchObject({
        tools: { listChanged: false }
      });

      ws.close();
    });

    it('should complete handshake with agent token and create session', async () => {
      // Arrange
      const ws = new WebSocket(`ws://localhost:${serverPort}`);
      
      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      // Mock agent token validation
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          active: true,
          client_id: 'test-client-id',
          scope: 'banking:read banking:write',
          exp: Math.floor(Date.now() / 1000) + 3600
        }
      });

      const handshakeMessage: HandshakeMessage = {
        id: 'handshake-with-token',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false }
          },
          clientInfo: {
            name: 'Test MCP Client',
            version: '1.0.0'
          },
          agentToken: 'valid-agent-token-123'
        }
      };

      // Act
      const response = await sendMessageAndWaitForResponse(ws, handshakeMessage);

      // Assert
      expect(response.id).toBe('handshake-with-token');
      expect(response.result).toBeDefined();
      expect(response.result!.protocolVersion).toBe('2024-11-05');

      // Verify agent token was validated
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/as/introspect',
        expect.stringContaining('token=valid-agent-token-123'),
        expect.any(Object)
      );

      ws.close();
    });

    it('should handle invalid protocol version', async () => {
      // Arrange
      const ws = new WebSocket(`ws://localhost:${serverPort}`);
      
      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      const handshakeMessage: HandshakeMessage = {
        id: 'invalid-version',
        method: 'initialize',
        params: {
          protocolVersion: '2023-01-01', // Unsupported version
          capabilities: {
            tools: { listChanged: false }
          },
          clientInfo: {
            name: 'Test MCP Client',
            version: '1.0.0'
          }
        }
      };

      // Act
      const response = await sendMessageAndWaitForResponse(ws, handshakeMessage);

      // Assert
      expect(response.id).toBe('invalid-version');
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32602);
      expect(response.error!.message).toContain('Unsupported protocol version');

      ws.close();
    });

    it('should handle malformed JSON messages', async () => {
      // Arrange
      const ws = new WebSocket(`ws://localhost:${serverPort}`);
      
      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      // Act
      ws.send('{ invalid json }');
      
      const response = await new Promise<MCPResponse>((resolve) => {
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      // Assert
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32700);
      expect(response.error!.message).toContain('Parse error');

      ws.close();
    });
  });

  describe('Tool Listing and Discovery', () => {
    let authenticatedWs: WebSocket;

    beforeEach(async () => {
      // Setup authenticated WebSocket connection
      authenticatedWs = new WebSocket(`ws://localhost:${serverPort}`);
      
      await new Promise<void>((resolve, reject) => {
        authenticatedWs.on('open', resolve);
        authenticatedWs.on('error', reject);
      });

      // Mock agent token validation
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          active: true,
          client_id: 'test-client-id',
          scope: 'banking:read banking:write',
          exp: Math.floor(Date.now() / 1000) + 3600
        }
      });

      // Complete handshake
      const handshakeMessage: HandshakeMessage = {
        id: 'setup-handshake',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          clientInfo: { name: 'Test Client', version: '1.0.0' },
          agentToken: 'test-agent-token'
        }
      };

      await sendMessageAndWaitForResponse(authenticatedWs, handshakeMessage);
    });

    afterEach(() => {
      if (authenticatedWs.readyState === WebSocket.OPEN) {
        authenticatedWs.close();
      }
    });

    it('should list all available banking tools', async () => {
      // Arrange
      const listToolsMessage: ListToolsMessage = {
        id: 'list-tools-1',
        method: 'tools/list',
        params: {}
      };

      // Act
      const response = await sendMessageAndWaitForResponse(authenticatedWs, listToolsMessage);

      // Assert
      expect(response.id).toBe('list-tools-1');
      expect(response.result).toBeDefined();
      expect(response.result!.tools).toBeInstanceOf(Array);
      expect(response.result!.tools.length).toBeGreaterThan(0);

      // Check for expected banking tools
      const toolNames = response.result!.tools.map((tool: any) => tool.name);
      expect(toolNames).toContain('get_my_accounts');
      expect(toolNames).toContain('get_account_balance');
      expect(toolNames).toContain('get_my_transactions');
      expect(toolNames).toContain('create_deposit');
      expect(toolNames).toContain('create_withdrawal');
      expect(toolNames).toContain('create_transfer');

      // Verify tool structure
      const getAccountsTool = response.result!.tools.find((tool: any) => tool.name === 'get_my_accounts');
      expect(getAccountsTool).toMatchObject({
        name: 'get_my_accounts',
        description: expect.any(String),
        inputSchema: expect.any(Object),
        requiresUserAuth: true,
        requiredScopes: expect.arrayContaining(['banking:accounts:read'])
      });
    });

    it('should handle tools/list with pagination parameters', async () => {
      // Arrange
      const listToolsMessage: ListToolsMessage = {
        id: 'list-tools-paginated',
        method: 'tools/list',
        params: {
          cursor: 'test-cursor'
        }
      };

      // Act
      const response = await sendMessageAndWaitForResponse(authenticatedWs, listToolsMessage);

      // Assert
      expect(response.id).toBe('list-tools-paginated');
      expect(response.result).toBeDefined();
      expect(response.result!.tools).toBeInstanceOf(Array);
      // For now, pagination is not implemented, so nextCursor should be undefined
      expect(response.result!.nextCursor).toBeUndefined();
    });
  });

  describe('Tool Execution with Authentication', () => {
    let authenticatedWs: WebSocket;
    let sessionId: string;

    beforeEach(async () => {
      // Setup authenticated WebSocket connection
      authenticatedWs = new WebSocket(`ws://localhost:${serverPort}`);
      
      await new Promise<void>((resolve, reject) => {
        authenticatedWs.on('open', resolve);
        authenticatedWs.on('error', reject);
      });

      // Mock agent token validation
      mockedAxios.post.mockResolvedValueOnce({
        data: {
          active: true,
          client_id: 'test-client-id',
          scope: 'banking:read banking:write',
          exp: Math.floor(Date.now() / 1000) + 3600
        }
      });

      // Complete handshake
      const handshakeMessage: HandshakeMessage = {
        id: 'setup-handshake',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          clientInfo: { name: 'Test Client', version: '1.0.0' },
          agentToken: 'test-agent-token-' + Date.now()
        }
      };

      await sendMessageAndWaitForResponse(authenticatedWs, handshakeMessage);
    });

    afterEach(() => {
      if (authenticatedWs.readyState === WebSocket.OPEN) {
        authenticatedWs.close();
      }
    });

    it('should return authorization challenge when user tokens are missing', async () => {
      // Arrange
      const toolCallMessage: ToolCallMessage = {
        id: 'tool-call-no-auth',
        method: 'tools/call',
        params: {
          name: 'get_my_accounts',
          arguments: {}
        }
      };

      // Act
      const response = await sendMessageAndWaitForResponse(authenticatedWs, toolCallMessage);

      // Assert
      expect(response.id).toBe('tool-call-no-auth');
      expect(response.result).toBeDefined();
      expect(response.result!.content).toBeInstanceOf(Array);
      expect(response.result!.content[0]).toMatchObject({
        type: 'text',
        success: false,
        error: 'User authorization required',
        authChallenge: expect.objectContaining({
          authorizationUrl: expect.stringContaining('https://test.pingone.com/as/authorization'),
          state: expect.any(String),
          scope: expect.any(String)
        })
      });
      expect(response.result!.isError).toBe(true);
    });

    it('should execute tool successfully with valid user tokens', async () => {
      // Arrange - First get authorization challenge to create session
      const initialToolCall: ToolCallMessage = {
        id: 'initial-call',
        method: 'tools/call',
        params: {
          name: 'get_my_accounts',
          arguments: {}
        }
      };

      const challengeResponse = await sendMessageAndWaitForResponse(authenticatedWs, initialToolCall);
      const authChallenge = challengeResponse.result!.content[0].authChallenge;

      // Mock authorization code exchange
      const mockUserTokens = {
        access_token: 'user-access-token-123',
        refresh_token: 'user-refresh-token-123',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'banking:accounts:read banking:transactions:read'
      };

      mockedAxios.post.mockResolvedValueOnce({
        data: mockUserTokens
      });

      // Handle authorization code
      const authCodeMessage: ToolCallMessage = {
        id: 'auth-code-exchange',
        method: 'tools/call',
        params: {
          name: 'handle_authorization',
          arguments: {
            authorization_code: 'test-auth-code-123',
            state: authChallenge.state
          }
        }
      };

      const authResult = await sendMessageAndWaitForResponse(authenticatedWs, authCodeMessage);
      expect(authResult.result!.content[0].success).toBe(true);

      // Mock banking API response
      mockedAxios.request.mockResolvedValueOnce({
        status: 200,
        data: mockAccounts,
        config: { url: '/api/accounts/my', method: 'get' }
      });

      // Act - Now execute the tool with valid user tokens
      const toolCallMessage: ToolCallMessage = {
        id: 'tool-call-with-auth',
        method: 'tools/call',
        params: {
          name: 'get_my_accounts',
          arguments: {}
        }
      };

      const response = await sendMessageAndWaitForResponse(authenticatedWs, toolCallMessage);

      // Assert
      expect(response.id).toBe('tool-call-with-auth');
      expect(response.result).toBeDefined();
      expect(response.result!.content[0]).toMatchObject({
        type: 'text',
        success: true,
        text: expect.stringContaining('Found 1 account(s)')
      });
      expect(response.result!.isError).toBe(false);

      // Verify banking API was called with correct token
      expect(mockedAxios.request).toHaveBeenCalledWith({
        method: 'get',
        url: '/api/accounts/my',
        headers: {
          'Authorization': 'Bearer user-access-token-123'
        }
      });
    });

    it('should handle tool execution with parameters', async () => {
      // Arrange - Setup session with user tokens (simplified)
      await setupSessionWithUserTokens(authenticatedWs);

      // Mock banking API response
      mockedAxios.request.mockResolvedValueOnce({
        status: 200,
        data: { balance: 1500.50 },
        config: { url: '/api/accounts/acc-123/balance', method: 'get' }
      });

      const toolCallMessage: ToolCallMessage = {
        id: 'tool-call-with-params',
        method: 'tools/call',
        params: {
          name: 'get_account_balance',
          arguments: {
            account_id: 'acc-123'
          }
        }
      };

      // Act
      const response = await sendMessageAndWaitForResponse(authenticatedWs, toolCallMessage);

      // Assert
      expect(response.id).toBe('tool-call-with-params');
      expect(response.result!.content[0]).toMatchObject({
        type: 'text',
        success: true,
        text: 'Account acc-123 balance: 1500.50'
      });
    });

    it('should handle banking API errors gracefully', async () => {
      // Arrange - Setup session with user tokens
      await setupSessionWithUserTokens(authenticatedWs);

      // Mock banking API error
      mockedAxios.request.mockRejectedValueOnce({
        response: {
          status: 404,
          data: {
            error: 'Account not found',
            code: 'ACCOUNT_NOT_FOUND'
          }
        }
      });

      const toolCallMessage: ToolCallMessage = {
        id: 'tool-call-error',
        method: 'tools/call',
        params: {
          name: 'get_account_balance',
          arguments: {
            account_id: 'non-existent-account'
          }
        }
      };

      // Act
      const response = await sendMessageAndWaitForResponse(authenticatedWs, toolCallMessage);

      // Assert
      expect(response.id).toBe('tool-call-error');
      expect(response.result!.content[0]).toMatchObject({
        type: 'text',
        success: false,
        error: expect.stringContaining('Account not found')
      });
      expect(response.result!.isError).toBe(true);
    });

    it('should handle unknown tool calls', async () => {
      // Arrange
      const toolCallMessage: ToolCallMessage = {
        id: 'unknown-tool',
        method: 'tools/call',
        params: {
          name: 'unknown_banking_tool',
          arguments: {}
        }
      };

      // Act
      const response = await sendMessageAndWaitForResponse(authenticatedWs, toolCallMessage);

      // Assert
      expect(response.id).toBe('unknown-tool');
      expect(response.result!.content[0]).toMatchObject({
        type: 'text',
        success: false,
        error: expect.stringContaining('Unknown tool')
      });
    });

    it('should handle invalid tool parameters', async () => {
      // Arrange
      const toolCallMessage: ToolCallMessage = {
        id: 'invalid-params',
        method: 'tools/call',
        params: {
          name: 'get_account_balance',
          arguments: {
            account_id: '' // Invalid empty account ID
          }
        }
      };

      // Act
      const response = await sendMessageAndWaitForResponse(authenticatedWs, toolCallMessage);

      // Assert
      expect(response.id).toBe('invalid-params');
      expect(response.result!.content[0]).toMatchObject({
        type: 'text',
        success: false,
        error: expect.stringContaining('Invalid parameters')
      });
    });
  });

  describe('Performance and Concurrent Sessions', () => {
    it('should handle multiple concurrent agent connections', async () => {
      // Arrange
      const concurrentConnections = 10;
      const connections: WebSocket[] = [];
      const connectionPromises: Promise<void>[] = [];

      // Create multiple concurrent connections
      for (let i = 0; i < concurrentConnections; i++) {
        const ws = new WebSocket(`ws://localhost:${serverPort}`);
        connections.push(ws);
        
        connectionPromises.push(new Promise<void>((resolve, reject) => {
          ws.on('open', resolve);
          ws.on('error', reject);
        }));
      }

      // Wait for all connections to open
      await Promise.all(connectionPromises);

      // Mock agent token validation for all connections
      for (let i = 0; i < concurrentConnections; i++) {
        mockedAxios.post.mockResolvedValueOnce({
          data: {
            active: true,
            client_id: 'test-client-id',
            scope: 'banking:read banking:write',
            exp: Math.floor(Date.now() / 1000) + 3600
          }
        });
      }

      // Act - Perform handshakes concurrently
      const handshakePromises = connections.map((ws, index) => {
        const handshakeMessage: HandshakeMessage = {
          id: `concurrent-handshake-${index}`,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            clientInfo: { name: `Test Client ${index}`, version: '1.0.0' },
            agentToken: `concurrent-agent-token-${index}`
          }
        };
        return sendMessageAndWaitForResponse(ws, handshakeMessage);
      });

      const responses = await Promise.all(handshakePromises);

      // Assert
      expect(responses).toHaveLength(concurrentConnections);
      responses.forEach((response, index) => {
        expect(response.id).toBe(`concurrent-handshake-${index}`);
        expect(response.result).toBeDefined();
        expect(response.result!.protocolVersion).toBe('2024-11-05');
      });

      // Verify server stats
      const serverStats = server.getServerStats();
      expect(serverStats.activeConnections).toBe(concurrentConnections);
      expect(serverStats.totalConnections).toBeGreaterThanOrEqual(concurrentConnections);

      // Cleanup
      connections.forEach(ws => ws.close());
    });

    it('should handle concurrent tool executions from multiple agents', async () => {
      // Arrange
      const concurrentAgents = 5;
      const connections: WebSocket[] = [];

      // Setup multiple authenticated connections
      for (let i = 0; i < concurrentAgents; i++) {
        const ws = new WebSocket(`ws://localhost:${serverPort}`);
        connections.push(ws);
        
        await new Promise<void>((resolve, reject) => {
          ws.on('open', resolve);
          ws.on('error', reject);
        });

        // Mock agent token validation
        mockedAxios.post.mockResolvedValueOnce({
          data: {
            active: true,
            client_id: 'test-client-id',
            scope: 'banking:read banking:write',
            exp: Math.floor(Date.now() / 1000) + 3600
          }
        });

        // Complete handshake
        const handshakeMessage: HandshakeMessage = {
          id: `setup-${i}`,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            clientInfo: { name: `Agent ${i}`, version: '1.0.0' },
            agentToken: `concurrent-test-token-${i}`
          }
        };

        await sendMessageAndWaitForResponse(ws, handshakeMessage);

        // Setup user tokens for each session
        await setupSessionWithUserTokens(ws, i);
      }

      // Mock banking API responses for all concurrent calls
      for (let i = 0; i < concurrentAgents; i++) {
        mockedAxios.request.mockResolvedValueOnce({
          status: 200,
          data: mockAccounts,
          config: { url: '/api/accounts/my', method: 'get' }
        });
      }

      // Act - Execute tools concurrently
      const toolCallPromises = connections.map((ws, index) => {
        const toolCallMessage: ToolCallMessage = {
          id: `concurrent-tool-${index}`,
          method: 'tools/call',
          params: {
            name: 'get_my_accounts',
            arguments: {}
          }
        };
        return sendMessageAndWaitForResponse(ws, toolCallMessage);
      });

      const responses = await Promise.all(toolCallPromises);

      // Assert
      expect(responses).toHaveLength(concurrentAgents);
      responses.forEach((response, index) => {
        expect(response.id).toBe(`concurrent-tool-${index}`);
        expect(response.result!.content[0].success).toBe(true);
        expect(response.result!.content[0].text).toContain('Found 1 account(s)');
      });

      // Cleanup
      connections.forEach(ws => ws.close());
    });

    it('should handle server connection limits', async () => {
      // This test would require creating a server with a very low connection limit
      // For now, we'll test that the server can handle the configured max connections
      const serverStats = server.getServerStats();
      expect(serverStats.activeConnections).toBeLessThanOrEqual(serverConfig.maxConnections);
    });

    it('should maintain performance under load', async () => {
      // Arrange
      const loadTestConnections = 20;
      const messagesPerConnection = 5;
      const connections: WebSocket[] = [];

      // Setup connections
      for (let i = 0; i < loadTestConnections; i++) {
        const ws = new WebSocket(`ws://localhost:${serverPort}`);
        connections.push(ws);
        
        await new Promise<void>((resolve, reject) => {
          ws.on('open', resolve);
          ws.on('error', reject);
        });
      }

      const startTime = Date.now();

      // Act - Send multiple messages per connection
      const allPromises: Promise<MCPResponse>[] = [];
      
      for (let connIndex = 0; connIndex < loadTestConnections; connIndex++) {
        for (let msgIndex = 0; msgIndex < messagesPerConnection; msgIndex++) {
          const listToolsMessage: ListToolsMessage = {
            id: `load-test-${connIndex}-${msgIndex}`,
            method: 'tools/list',
            params: {}
          };
          allPromises.push(sendMessageAndWaitForResponse(connections[connIndex], listToolsMessage));
        }
      }

      const responses = await Promise.all(allPromises);
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Assert
      expect(responses).toHaveLength(loadTestConnections * messagesPerConnection);
      responses.forEach(response => {
        expect(response.result).toBeDefined();
        expect(response.result!.tools).toBeInstanceOf(Array);
      });

      // Performance assertion - should handle all messages within reasonable time
      const averageTimePerMessage = totalTime / responses.length;
      expect(averageTimePerMessage).toBeLessThan(100); // Less than 100ms per message on average

      console.log(`Load test completed: ${responses.length} messages in ${totalTime}ms (avg: ${averageTimePerMessage.toFixed(2)}ms per message)`);

      // Cleanup
      connections.forEach(ws => ws.close());
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle WebSocket connection errors gracefully', async () => {
      // Arrange
      const ws = new WebSocket(`ws://localhost:${serverPort}`);
      
      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      // Act - Force connection error by sending invalid data
      ws.send(Buffer.from([0xFF, 0xFF, 0xFF, 0xFF])); // Invalid UTF-8

      // Wait for connection to close
      await new Promise<void>((resolve) => {
        ws.on('close', resolve);
      });

      // Assert - Server should handle the error gracefully
      const serverStats = server.getServerStats();
      expect(serverStats.totalErrors).toBeGreaterThan(0);
    });

    it('should handle unknown MCP methods', async () => {
      // Arrange
      const ws = new WebSocket(`ws://localhost:${serverPort}`);
      
      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      const unknownMethodMessage = {
        id: 'unknown-method',
        method: 'unknown/method',
        params: {}
      };

      // Act
      const response = await sendMessageAndWaitForResponse(ws, unknownMethodMessage);

      // Assert
      expect(response.id).toBe('unknown-method');
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32601);
      expect(response.error!.message).toBe('Method not found');

      ws.close();
    });

    it('should handle server shutdown gracefully', async () => {
      // Arrange
      const testServer = new BankingMCPServer(
        { ...serverConfig, port: serverPort + 1 },
        authManager,
        sessionManager,
        toolProvider
      );

      await testServer.startServer();

      const ws = new WebSocket(`ws://localhost:${serverPort + 1}`);
      await new Promise<void>((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
      });

      // Act - Shutdown server while connection is active
      const shutdownPromise = testServer.stopServer();

      // Wait for connection to close
      await new Promise<void>((resolve) => {
        ws.on('close', resolve);
      });

      await shutdownPromise;

      // Assert - Server should shutdown cleanly
      expect(testServer.isServerRunning()).toBe(false);
    });
  });

  // Helper functions
  async function sendMessageAndWaitForResponse(ws: WebSocket, message: MCPMessage): Promise<MCPResponse> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Message timeout'));
      }, 5000);

      ws.once('message', (data) => {
        clearTimeout(timeout);
        try {
          const response = JSON.parse(data.toString());
          resolve(response);
        } catch (error) {
          reject(error);
        }
      });

      ws.send(JSON.stringify(message));
    });
  }

  async function setupSessionWithUserTokens(ws: WebSocket, index: number = 0): Promise<void> {
    // Get authorization challenge
    const toolCallMessage: ToolCallMessage = {
      id: `setup-auth-${index}`,
      method: 'tools/call',
      params: {
        name: 'get_my_accounts',
        arguments: {}
      }
    };

    const challengeResponse = await sendMessageAndWaitForResponse(ws, toolCallMessage);
    const authChallenge = challengeResponse.result!.content[0].authChallenge;

    // Mock authorization code exchange
    mockedAxios.post.mockResolvedValueOnce({
      data: {
        access_token: `user-access-token-${index}`,
        refresh_token: `user-refresh-token-${index}`,
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'banking:accounts:read banking:transactions:read banking:transactions:write'
      }
    });

    // Handle authorization code
    const authCodeMessage: ToolCallMessage = {
      id: `auth-setup-${index}`,
      method: 'tools/call',
      params: {
        name: 'handle_authorization',
        arguments: {
          authorization_code: `test-auth-code-${index}`,
          state: authChallenge.state
        }
      }
    };

    await sendMessageAndWaitForResponse(ws, authCodeMessage);
  }
});