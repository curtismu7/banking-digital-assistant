/**
 * MCP Message Handler Tests
 * Unit tests for MCP protocol message handling
 */

import { MCPMessageHandler, MessageHandlerContext } from '../../src/server/MCPMessageHandler';
import { BankingAuthenticationManager } from '../../src/auth/BankingAuthenticationManager';
import { BankingSessionManager, BankingSession } from '../../src/storage/BankingSessionManager';
import { BankingToolProvider } from '../../src/tools/BankingToolProvider';
import { 
  HandshakeMessage, 
  ListToolsMessage, 
  ToolCallMessage,
  ToolDefinition 
} from '../../src/interfaces/mcp';
import { PingOneConfig, AgentTokenInfo } from '../../src/interfaces/auth';
import { BankingToolDefinition } from '../../src/tools/BankingToolRegistry';

// Mock dependencies
jest.mock('../../src/auth/BankingAuthenticationManager');
jest.mock('../../src/storage/BankingSessionManager');
jest.mock('../../src/tools/BankingToolProvider');

describe('MCPMessageHandler', () => {
  let handler: MCPMessageHandler;
  let mockAuthManager: jest.Mocked<BankingAuthenticationManager>;
  let mockSessionManager: jest.Mocked<BankingSessionManager>;
  let mockToolProvider: jest.Mocked<BankingToolProvider>;
  let mockContext: MessageHandlerContext;

  beforeEach(() => {
    // Create mock instances
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
    mockToolProvider = {} as jest.Mocked<BankingToolProvider>;

    // Set up default mocks
    mockToolProvider.getAvailableTools = jest.fn().mockReturnValue([]);
    mockToolProvider.executeTool = jest.fn();
    mockToolProvider.handleAuthorizationCode = jest.fn();

    // Mock AuthenticationIntegration methods
    mockAuthManager.validateAgentToken = jest.fn();
    mockAuthManager.generateAuthorizationRequest = jest.fn();
    mockAuthManager.validateAuthorizationState = jest.fn();
    mockAuthManager.exchangeAuthorizationCode = jest.fn();
    mockAuthManager.completeAuthorizationRequest = jest.fn();
    mockSessionManager.validateSession = jest.fn();
    mockSessionManager.createSession = jest.fn();
    mockSessionManager.getSessionByAgentToken = jest.fn();
    mockSessionManager.updateSessionActivity = jest.fn();

    handler = new MCPMessageHandler(mockAuthManager, mockSessionManager, mockToolProvider);

    mockContext = {
      connectionId: 'test-connection-1'
    };
  });

  describe('Handshake Handling', () => {
    it('should handle valid handshake message', async () => {
      const handshakeMessage: HandshakeMessage = {
        id: 'handshake-1',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false }
          }
        }
      };

      const response = await handler.handleHandshake(handshakeMessage, mockContext);

      expect(response.id).toBe('handshake-1');
      expect(response.result).toBeDefined();
      expect(response.result!.protocolVersion).toBe('2024-11-05');
      expect(response.result!.serverInfo).toBeDefined();
      expect(response.result!.capabilities).toBeDefined();
    });

    it('should handle handshake with agent token', async () => {
      const mockAgentTokenInfo: AgentTokenInfo = {
        tokenHash: 'test-hash',
        clientId: 'test-client',
        scopes: ['banking:read'],
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
      mockSessionManager.createSession.mockResolvedValue(mockSession);

      const handshakeMessage: HandshakeMessage = {
        id: 'handshake-2',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } },
          agentToken: 'test-agent-token'
        }
      };

      const response = await handler.handleHandshake(handshakeMessage, mockContext);

      expect(response.id).toBe('handshake-2');
      expect(response.result).toBeDefined();
      expect(mockContext.agentToken).toBe('test-agent-token');
      expect(mockContext.session).toBe(mockSession);
      expect(mockAuthManager.validateAgentToken).toHaveBeenCalledWith('test-agent-token');
      expect(mockSessionManager.createSession).toHaveBeenCalledWith('test-agent-token');
    });

    it('should reject unsupported protocol version', async () => {
      const handshakeMessage: HandshakeMessage = {
        id: 'handshake-3',
        method: 'initialize',
        params: {
          protocolVersion: '2023-01-01',
          capabilities: { tools: { listChanged: false } }
        }
      };

      const response = await handler.handleHandshake(handshakeMessage, mockContext);

      expect(response.id).toBe('handshake-3');
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32602);
      expect(response.error!.message).toContain('Unsupported protocol version');
    });

    it('should handle missing protocol version', async () => {
      const handshakeMessage: HandshakeMessage = {
        id: 'handshake-4',
        method: 'initialize',
        params: {
          capabilities: { tools: { listChanged: false } }
        } as any
      };

      const response = await handler.handleHandshake(handshakeMessage, mockContext);

      expect(response.id).toBe('handshake-4');
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32602);
      expect(response.error!.message).toContain('missing protocolVersion');
    });
  });

  describe('Tools List Handling', () => {
    it('should return available banking tools', async () => {
      const mockBankingTools: BankingToolDefinition[] = [
        {
          name: 'get_my_accounts',
          description: 'Get user accounts',
          inputSchema: {
            type: 'object',
            properties: {},
            required: []
          },
          requiresUserAuth: true,
          requiredScopes: ['banking:accounts:read'],
          handler: 'executeGetMyAccounts'
        },
        {
          name: 'get_account_balance',
          description: 'Get account balance',
          inputSchema: {
            type: 'object',
            properties: {
              account_id: { type: 'string' }
            },
            required: ['account_id']
          },
          requiresUserAuth: true,
          requiredScopes: ['banking:accounts:read'],
          handler: 'executeGetAccountBalance'
        }
      ];

      mockToolProvider.getAvailableTools.mockReturnValue(mockBankingTools);

      const listToolsMessage: ListToolsMessage = {
        id: 'list-tools-1',
        method: 'tools/list',
        params: {}
      };

      const response = await handler.handleListTools(listToolsMessage, mockContext);

      expect(response.id).toBe('list-tools-1');
      expect(response.result).toBeDefined();
      expect(response.result!.tools).toHaveLength(2);
      expect(response.result!.tools[0].name).toBe('get_my_accounts');
      expect(response.result!.tools[1].name).toBe('get_account_balance');
      expect(mockToolProvider.getAvailableTools).toHaveBeenCalled();
    });

    it('should handle empty tools list', async () => {
      mockToolProvider.getAvailableTools.mockReturnValue([]);

      const listToolsMessage: ListToolsMessage = {
        id: 'list-tools-2',
        method: 'tools/list',
        params: {}
      };

      const response = await handler.handleListTools(listToolsMessage, mockContext);

      expect(response.id).toBe('list-tools-2');
      expect(response.result).toBeDefined();
      expect(response.result!.tools).toHaveLength(0);
    });
  });

  describe('Tool Call Handling', () => {
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

    it('should execute tool call with valid session', async () => {
      mockContext.session = mockSession;
      mockContext.agentToken = 'test-agent-token';

      // Mock successful authentication validation
      mockSessionManager.validateSession.mockResolvedValue({
        isValid: true,
        requiresUserAuth: false,
        session: mockSession
      });

      const mockToolResult = {
        type: 'text' as const,
        text: 'Account balance: $1000.00',
        success: true
      };

      mockToolProvider.executeTool.mockResolvedValue(mockToolResult);
      mockSessionManager.updateSessionActivity.mockResolvedValue();

      const toolCallMessage: ToolCallMessage = {
        id: 'tool-call-1',
        method: 'tools/call',
        params: {
          name: 'get_account_balance',
          arguments: {
            account_id: 'acc-123'
          }
        }
      };

      const response = await handler.handleToolCall(toolCallMessage, mockContext);

      expect(response.id).toBe('tool-call-1');
      expect(response.result).toBeDefined();
      expect(response.result!.content).toHaveLength(1);
      expect(response.result!.content[0].text).toBe('Account balance: $1000.00');
      expect(response.result!.isError).toBe(false);
      expect(mockToolProvider.executeTool).toHaveBeenCalledWith(
        'get_account_balance',
        { account_id: 'acc-123' },
        mockSession
      );
      expect(mockSessionManager.updateSessionActivity).toHaveBeenCalledWith(
        'test-session-1',
        'tool_call'
      );
    });

    it('should create session from agent token if no session exists', async () => {
      mockContext.agentToken = 'test-agent-token';

      const mockAgentTokenInfo: AgentTokenInfo = {
        tokenHash: 'test-hash',
        clientId: 'test-client',
        scopes: ['banking:read'],
        expiresAt: new Date(Date.now() + 3600000),
        isValid: true
      };

      const mockToolResult = {
        type: 'text' as const,
        text: 'Tool executed successfully',
        success: true
      };

      // Mock agent authentication
      mockAuthManager.validateAgentToken.mockResolvedValue(mockAgentTokenInfo);
      mockSessionManager.getSessionByAgentToken.mockResolvedValue(null);
      mockSessionManager.createSession.mockResolvedValue(mockSession);
      
      // Mock session validation
      mockSessionManager.validateSession.mockResolvedValue({
        isValid: true,
        requiresUserAuth: false,
        session: mockSession
      });
      
      mockSessionManager.updateSessionActivity.mockResolvedValue();
      mockToolProvider.executeTool.mockResolvedValue(mockToolResult);

      const toolCallMessage: ToolCallMessage = {
        id: 'tool-call-2',
        method: 'tools/call',
        params: {
          name: 'get_my_accounts',
          arguments: {}
        }
      };

      const response = await handler.handleToolCall(toolCallMessage, mockContext);

      expect(response.id).toBe('tool-call-2');
      expect(response.result).toBeDefined();
      expect(response.result!.isError).toBe(false);
    });

    it('should return authentication error when no agent token', async () => {
      const toolCallMessage: ToolCallMessage = {
        id: 'tool-call-3',
        method: 'tools/call',
        params: {
          name: 'get_my_accounts',
          arguments: {}
        }
      };

      const response = await handler.handleToolCall(toolCallMessage, mockContext);

      expect(response.id).toBe('tool-call-3');
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32001);
      expect(response.error!.message).toBe('Authentication required');
    });

    it('should handle tool execution error', async () => {
      mockContext.session = mockSession;

      // Mock successful authentication validation
      mockSessionManager.validateSession.mockResolvedValue({
        isValid: true,
        requiresUserAuth: false,
        session: mockSession
      });

      const mockToolResult = {
        type: 'text' as const,
        text: 'Error: Account not found',
        success: false,
        error: 'Account not found'
      };

      mockToolProvider.executeTool.mockResolvedValue(mockToolResult);
      mockSessionManager.updateSessionActivity.mockResolvedValue();

      const toolCallMessage: ToolCallMessage = {
        id: 'tool-call-4',
        method: 'tools/call',
        params: {
          name: 'get_account_balance',
          arguments: {
            account_id: 'invalid-account'
          }
        }
      };

      const response = await handler.handleToolCall(toolCallMessage, mockContext);

      expect(response.id).toBe('tool-call-4');
      expect(response.result).toBeDefined();
      expect(response.result!.content[0].text).toBe('Error: Account not found');
      expect(response.result!.isError).toBe(true);
    });
  });

  describe('Authorization Code Handling', () => {
    it('should handle authorization code successfully', async () => {
      const mockSession: BankingSession = {
        sessionId: 'test-session-1',
        agentTokenHash: 'test-hash',
        createdAt: new Date(),
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + 3600000)
      };

      mockContext.session = mockSession;

      // Mock authorization state validation
      const mockAuthRequest = {
        authorizationUrl: 'https://test.pingone.com/authorize',
        state: 'state-456',
        scope: 'banking:accounts:read',
        sessionId: 'test-session-1',
        expiresAt: new Date(Date.now() + 300000)
      };

      const mockUserTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
        scope: 'banking:accounts:read',
        issuedAt: new Date()
      };

      mockAuthManager.validateAuthorizationState.mockReturnValue(mockAuthRequest);
      mockAuthManager.exchangeAuthorizationCode.mockResolvedValue(mockUserTokens);
      mockSessionManager.associateUserTokens.mockResolvedValue();
      mockAuthManager.completeAuthorizationRequest.mockReturnValue(true);
      mockSessionManager.getSession.mockResolvedValue(mockSession);

      const authMessage: ToolCallMessage = {
        id: 'auth-1',
        method: 'tools/call',
        params: {
          name: 'handle_authorization',
          arguments: {
            authorization_code: 'auth-code-123',
            state: 'state-456'
          }
        }
      };

      const response = await handler.handleAuthorizationCode(authMessage, mockContext);

      expect(response.id).toBe('auth-1');
      expect(response.result).toBeDefined();
      expect(response.result!.content[0].text).toBe('Authorization successful! You can now use banking tools.');
      expect(response.result!.isError).toBe(false);
    });

    it('should handle missing authorization parameters', async () => {
      const mockSession: BankingSession = {
        sessionId: 'test-session-1',
        agentTokenHash: 'test-hash',
        createdAt: new Date(),
        lastActivity: new Date(),
        expiresAt: new Date(Date.now() + 3600000)
      };

      mockContext.session = mockSession;

      const authMessage: ToolCallMessage = {
        id: 'auth-2',
        method: 'tools/call',
        params: {
          name: 'handle_authorization',
          arguments: {
            authorization_code: 'auth-code-123'
            // Missing state parameter
          }
        }
      };

      const response = await handler.handleAuthorizationCode(authMessage, mockContext);

      expect(response.id).toBe('auth-2');
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32602);
      expect(response.error!.message).toContain('Missing authorization_code or state parameter');
    });
  });

  describe('Message Routing', () => {
    it('should route initialize message to handshake handler', async () => {
      const message = {
        id: 'msg-1',
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false } }
        }
      };

      const response = await handler.handleMessage(message, mockContext);

      expect(response.id).toBe('msg-1');
      expect(response.result).toBeDefined();
    });

    it('should route tools/list message to list tools handler', async () => {
      mockToolProvider.getAvailableTools.mockReturnValue([]);

      const message = {
        id: 'msg-2',
        method: 'tools/list',
        params: {}
      };

      const response = await handler.handleMessage(message, mockContext);

      expect(response.id).toBe('msg-2');
      expect(response.result).toBeDefined();
      expect(response.result!.tools).toBeDefined();
    });

    it('should return method not found for unknown methods', async () => {
      const message = {
        id: 'msg-3',
        method: 'unknown_method',
        params: {}
      };

      const response = await handler.handleMessage(message, mockContext);

      expect(response.id).toBe('msg-3');
      expect(response.error).toBeDefined();
      expect(response.error!.code).toBe(-32601);
      expect(response.error!.message).toBe('Method not found');
    });
  });

  describe('Server Info', () => {
    it('should return server information', () => {
      const serverInfo = handler.getServerInfo();

      expect(serverInfo.name).toBe('Banking MCP Server');
      expect(serverInfo.version).toBe('1.0.0');
      expect(serverInfo.description).toContain('banking operations');
    });

    it('should return server capabilities', () => {
      const capabilities = handler.getServerCapabilities();

      expect(capabilities.tools).toBeDefined();
      expect(capabilities.logging).toBeDefined();
      expect(capabilities.prompts).toBeDefined();
      expect(capabilities.resources).toBeDefined();
    });
  });
});