/**
 * MCP Message Handler
 * Handles MCP protocol messages including handshake, list_tools, and tool_call
 */

import { 
  MCPMessage, 
  MCPResponse, 
  HandshakeMessage, 
  HandshakeResponse,
  ListToolsMessage,
  ListToolsResponse,
  ToolCallMessage,
  ToolCallResponse,
  ServerCapabilities,
  ServerInfo,
  ToolDefinition,
  ToolResult
} from '../interfaces/mcp';
import { BankingAuthenticationManager } from '../auth/BankingAuthenticationManager';
import { BankingSessionManager, BankingSession } from '../storage/BankingSessionManager';
import { BankingToolProvider } from '../tools/BankingToolProvider';
import { AuthenticationError, AuthErrorCodes } from '../interfaces/auth';
import { AuthenticationIntegration } from './AuthenticationIntegration';

export interface MessageHandlerContext {
  connectionId: string;
  agentToken?: string;
  session?: BankingSession;
}

export class MCPMessageHandler {
  private readonly serverInfo: ServerInfo = {
    name: 'Banking MCP Server',
    version: '1.0.0',
    description: 'Secure banking operations MCP server with PingOne authentication'
  };

  private readonly serverCapabilities: ServerCapabilities = {
    tools: {
      listChanged: false
    },
    logging: {},
    prompts: {
      listChanged: false
    },
    resources: {
      subscribe: false,
      listChanged: false
    }
  };

  private authIntegration: AuthenticationIntegration;

  constructor(
    private authManager: BankingAuthenticationManager,
    private sessionManager: BankingSessionManager,
    private toolProvider: BankingToolProvider
  ) {
    this.authIntegration = new AuthenticationIntegration(authManager, sessionManager);
  }

  /**
   * Route MCP message to appropriate handler
   */
  async handleMessage(message: MCPMessage, context: MessageHandlerContext): Promise<MCPResponse> {
    try {
      switch (message.method) {
        case 'initialize':
          return await this.handleHandshake(message as HandshakeMessage, context);
        
        case 'tools/list':
          return await this.handleListTools(message as ListToolsMessage, context);
        
        case 'tools/call':
          return await this.handleToolCall(message as ToolCallMessage, context);
        
        default:
          return this.createErrorResponse(message.id, -32601, 'Method not found', { method: message.method });
      }
    } catch (error) {
      console.error(`[MCPMessageHandler] Error handling message ${message.method}:`, error);
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.createErrorResponse(message.id, -32603, `Internal error: ${errorMessage}`);
    }
  }

  /**
   * Handle MCP handshake/initialize message
   */
  async handleHandshake(message: HandshakeMessage, context: MessageHandlerContext): Promise<HandshakeResponse> {
    try {
      // Validate protocol version
      const clientVersion = message.params?.protocolVersion;
      if (!clientVersion) {
        return this.createErrorResponse(message.id, -32602, 'Invalid params: missing protocolVersion') as HandshakeResponse;
      }

      // For now, accept any version that starts with "2024-"
      if (!clientVersion.startsWith('2024-')) {
        return this.createErrorResponse(message.id, -32602, 'Unsupported protocol version', { 
          supportedVersions: ['2024-11-05'] 
        }) as HandshakeResponse;
      }

      // Extract agent token from params if provided (multiple possible locations)
      const agentToken = message.params?.agentToken as string || 
                        (message.params as any)?.agent_token as string ||
                        (message.params as any)?.clientInfo?.agentToken as string;
                        
      console.log(`[MCPMessageHandler] Handshake - looking for agent token in params:`, !!agentToken);
      
      if (agentToken) {
        context.agentToken = agentToken;
        
        // Validate agent token and create session
        try {
          const agentTokenInfo = await this.authManager.validateAgentToken(agentToken);
          const session = await this.sessionManager.createSession(agentToken);
          context.session = session;
          
          console.log(`[MCPMessageHandler] Created session ${session.sessionId} for agent token`);
        } catch (error) {
          console.warn(`[MCPMessageHandler] Agent token validation failed:`, error);
          // Continue with handshake but without session - tools will require authentication
        }
      } else {
        console.log(`[MCPMessageHandler] No agent token found in handshake params`);
      }

      return {
        id: message.id ?? 'unknown',
        result: {
          protocolVersion: '2024-11-05',
          capabilities: this.serverCapabilities,
          serverInfo: this.serverInfo
        }
      };
    } catch (error) {
      console.error('[MCPMessageHandler] Error in handshake:', error);
      return this.createErrorResponse(message.id, -32603, 'Handshake failed') as HandshakeResponse;
    }
  }

  /**
   * Handle tools/list message
   */
  async handleListTools(message: ListToolsMessage, context: MessageHandlerContext): Promise<ListToolsResponse> {
    try {
      // Get available banking tools
      const bankingTools = this.toolProvider.getAvailableTools();
      
      // Convert to MCP tool definitions
      const mcpTools: ToolDefinition[] = bankingTools.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        requiresUserAuth: tool.requiresUserAuth,
        requiredScopes: tool.requiredScopes
      }));

      return {
        id: message.id ?? 'unknown',
        result: {
          tools: mcpTools,
          nextCursor: message.params?.cursor ? undefined : undefined // No pagination for now
        }
      };
    } catch (error) {
      console.error('[MCPMessageHandler] Error listing tools:', error);
      return this.createErrorResponse(message.id, -32603, 'Failed to list tools') as ListToolsResponse;
    }
  }

  /**
   * Handle tools/call message
   */
  async handleToolCall(message: ToolCallMessage, context: MessageHandlerContext): Promise<ToolCallResponse> {
    console.log(`[MCPMessageHandler] *** TOOL CALL RECEIVED *** Tool: ${message.params.name}, Args:`, message.params.arguments);
    try {
      const toolName = message.params.name;
      const toolArguments = message.params.arguments || {};
      
      console.log(`[MCPMessageHandler] Processing tool call for: "${toolName}"`);
      console.log(`[MCPMessageHandler] Available tools:`, this.toolProvider.getAvailableTools().map(t => t.name));

      // Check if agent token is provided in the tool call params (fallback)
      const agentTokenFromCall = toolArguments.agent_token as string || 
                                toolArguments.agentToken as string ||
                                (message.params as any)?.agentToken as string;
                                
      console.log(`[MCPMessageHandler] Looking for agent token in tool call - found:`, !!agentTokenFromCall);
      console.log(`[MCPMessageHandler] Tool call params:`, message.params);
      
      if (agentTokenFromCall && !context.agentToken) {
        console.log(`[MCPMessageHandler] Agent token found in tool call parameters`);
        context.agentToken = agentTokenFromCall;
        
        // Try to get or create session for this agent token
        try {
          let session = await this.sessionManager.getSessionByAgentToken(agentTokenFromCall);
          if (!session) {
            const agentTokenInfo = await this.authManager.validateAgentToken(agentTokenFromCall);
            session = await this.sessionManager.createSession(agentTokenFromCall);
            console.log(`[MCPMessageHandler] Created session ${session.sessionId} for agent token from tool call`);
          }
          context.session = session;
        } catch (error) {
          console.warn(`[MCPMessageHandler] Failed to create session from tool call agent token:`, error);
        }
      }

      // Special handling for authorization code
      if (toolName === 'handle_authorization' || toolArguments.authorization_code) {
        return await this.handleAuthorizationCode(message, context);
      }

      // Get tool definition to check required scopes
      const availableTools = this.toolProvider.getAvailableTools() || [];
      const tool = availableTools.find(t => t.name === toolName);
      const requiredScopes = tool?.requiredScopes || [];

      // Validate authentication using integration service
      console.log(`[MCPMessageHandler] Validating authentication for scopes:`, requiredScopes);
      console.log(`[MCPMessageHandler] Session exists:`, !!context.session);
      console.log(`[MCPMessageHandler] Agent token exists:`, !!context.agentToken);
      
      const authResult = await this.authIntegration.validateToolAuthentication(
        context.session,
        context.agentToken,
        requiredScopes
      );

      console.log(`[MCPMessageHandler] Auth result:`, {
        success: authResult.success,
        error: authResult.error,
        hasAuthChallenge: !!authResult.authChallenge
      });

      if (!authResult.success) {
        if (authResult.authChallenge) {
          console.log(`[MCPMessageHandler] Returning authorization challenge`);
          const challengeResponse = this.authIntegration.createAuthorizationChallengeResponse(String(message.id ?? 'unknown'), authResult.authChallenge);
          console.log(`[MCPMessageHandler] Authorization challenge response:`, JSON.stringify(challengeResponse, null, 2));
          return challengeResponse;
        } else {
          console.log(`[MCPMessageHandler] Returning authentication error:`, authResult.error);
          const errorResponse = this.authIntegration.createAuthenticationErrorResponse(String(message.id ?? 'unknown'), authResult.error || 'Authentication failed') as ToolCallResponse;
          console.log(`[MCPMessageHandler] Authentication error response:`, JSON.stringify(errorResponse, null, 2));
          return errorResponse;
        }
      }

      // Update context with validated session
      context.session = authResult.session;

      // Update session activity
      if (context.session) {
        await this.sessionManager.updateSessionActivity(context.session.sessionId, 'tool_call');
      }

      // Execute the tool
      const toolResult = await this.toolProvider.executeTool(toolName, toolArguments, context.session!, context.agentToken);

      // Convert tool result to MCP format
      const mcpContent: ToolResult[] = [{
        type: 'text',
        text: toolResult.text,
        success: toolResult.success,
        error: toolResult.error,
        authChallenge: toolResult.authChallenge
      }];

      return {
        id: message.id ?? 'unknown',
        result: {
          content: mcpContent,
          isError: !toolResult.success
        }
      };

    } catch (error) {
      console.error(`[MCPMessageHandler] Error executing tool call:`, error);
      
      if (error instanceof AuthenticationError) {
        return this.authIntegration.createAuthenticationErrorResponse(String(message.id ?? 'unknown'), error.message) as ToolCallResponse;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.createErrorResponse(message.id, -32603, `Tool execution failed: ${errorMessage}`) as ToolCallResponse;
    }
  }

  /**
   * Handle authorization code from user (special tool call)
   */
  async handleAuthorizationCode(
    message: ToolCallMessage, 
    context: MessageHandlerContext
  ): Promise<ToolCallResponse> {
    try {
      // Ensure we have a session
      if (!context.session) {
        if (context.agentToken) {
          const authResult = await this.authIntegration.validateAgentAuthentication(context.agentToken);
          if (!authResult.success) {
            return this.authIntegration.createAuthenticationErrorResponse(String(message.id ?? 'unknown'), authResult.error || 'Agent authentication failed') as ToolCallResponse;
          }
          context.session = authResult.session;
        } else {
          return this.authIntegration.createAuthenticationErrorResponse(String(message.id ?? 'unknown'), 'Session required for authorization') as ToolCallResponse;
        }
      }

      const authCode = message.params.arguments?.authorization_code as string;
      const state = message.params.arguments?.state as string;

      if (!authCode || !state) {
        return this.createErrorResponse(message.id, -32602, 'Missing authorization_code or state parameter') as ToolCallResponse;
      }

      // Handle authorization code exchange through integration service
      const authResult = await this.authIntegration.handleAuthorizationCodeExchange(
        context.session!.sessionId,
        authCode,
        state
      );

      if (authResult.success) {
        // Update context with new session data
        context.session = authResult.session;

        const mcpContent: ToolResult[] = [{
          type: 'text',
          text: 'Authorization successful! You can now use banking tools.',
          success: true
        }];

        return {
          id: message.id ?? 'unknown',
          result: {
            content: mcpContent,
            isError: false
          }
        };
      } else {
        const mcpContent: ToolResult[] = [{
          type: 'text',
          text: `Authorization failed: ${authResult.error}`,
          success: false,
          error: authResult.error
        }];

        return {
          id: message.id ?? 'unknown',
          result: {
            content: mcpContent,
            isError: true
          }
        };
      }

    } catch (error) {
      console.error('[MCPMessageHandler] Error handling authorization code:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return this.createErrorResponse(message.id, -32603, `Authorization failed: ${errorMessage}`) as ToolCallResponse;
    }
  }

  /**
   * Associate session with connection context
   */
  async associateSession(context: MessageHandlerContext, agentToken: string): Promise<void> {
    try {
      // Validate agent token
      const agentTokenInfo = await this.authManager.validateAgentToken(agentToken);
      
      // Get or create session
      let session = await this.sessionManager.getSessionByAgentToken(agentToken);
      if (!session) {
        session = await this.sessionManager.createSession(agentToken);
      }

      context.session = session;
      context.agentToken = agentToken;

      console.log(`[MCPMessageHandler] Associated session ${session.sessionId} with connection ${context.connectionId}`);
    } catch (error) {
      console.error(`[MCPMessageHandler] Failed to associate session:`, error);
      throw new AuthenticationError('Session association failed', AuthErrorCodes.INVALID_AGENT_TOKEN);
    }
  }

  /**
   * Validate session and check authorization
   */
  async validateSessionAuth(context: MessageHandlerContext, requiredScopes: string[] = []): Promise<{
    isValid: boolean;
    requiresUserAuth: boolean;
    error?: string;
  }> {
    if (!context.session) {
      return {
        isValid: false,
        requiresUserAuth: false,
        error: 'No session found'
      };
    }

    // Validate session
    const validation = await this.sessionManager.validateSession(context.session.sessionId);
    
    if (!validation.isValid) {
      return {
        isValid: false,
        requiresUserAuth: false,
        error: validation.error
      };
    }

    // Check if user authorization is required for the requested scopes
    if (requiredScopes.length > 0 && validation.requiresUserAuth) {
      return {
        isValid: true,
        requiresUserAuth: true,
        error: 'User authorization required'
      };
    }

    return {
      isValid: true,
      requiresUserAuth: false
    };
  }

  /**
   * Create standard error response
   */
  private createErrorResponse(id: string | number | null | undefined, code: number, message: string, data?: any): MCPResponse {
    return {
      id: id ?? 'unknown',
      error: {
        code,
        message,
        data
      }
    };
  }



  /**
   * Get server information
   */
  getServerInfo(): ServerInfo {
    return { ...this.serverInfo };
  }

  /**
   * Handle authorization code exchange (called from HTTP callback)
   */
  async handleAuthorizationCodeExchange(authorizationCode: string, state: string): Promise<{
    success: boolean;
    error?: string;
    sessionId?: string;
  }> {
    try {
      console.log(`[MCPMessageHandler] Handling authorization code exchange for state: ${state}`);
      
      // First validate the state to get the session ID
      const authRequest = this.authManager.validateAuthorizationState(state);
      if (!authRequest) {
        return {
          success: false,
          error: 'Invalid or expired authorization state'
        };
      }

      console.log(`[MCPMessageHandler] Found authorization request for session: ${authRequest.sessionId}`);
      
      const result = await this.authIntegration.handleAuthorizationCodeExchange(
        authRequest.sessionId,
        authorizationCode,
        state
      );

      if (result.success && result.session) {
        return {
          success: true,
          sessionId: result.session.sessionId
        };
      } else {
        return {
          success: false,
          error: result.error || 'Authorization code exchange failed'
        };
      }

    } catch (error) {
      console.error('[MCPMessageHandler] Error in authorization code exchange:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get server capabilities
   */
  getServerCapabilities(): ServerCapabilities {
    return { ...this.serverCapabilities };
  }
}