/**
 * MCP Protocol Interfaces
 * Core interfaces for Model Context Protocol communication
 */

export interface MCPMessage {
  id?: string | number | null;
  method: string;
  params?: Record<string, any>;
}

export interface MCPResponse {
  id: string | number | null;
  result?: Record<string, any>;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: any;
}

export interface HandshakeMessage extends MCPMessage {
  method: 'initialize';
  params: {
    protocolVersion: string;
    capabilities: ServerCapabilities;
    clientInfo?: {
      name: string;
      version: string;
    };
    agentToken?: string;
  };
}

export interface HandshakeResponse extends MCPResponse {
  result: {
    protocolVersion: string;
    capabilities: ServerCapabilities;
    serverInfo: ServerInfo;
  };
}

export interface ListToolsMessage extends MCPMessage {
  method: 'tools/list';
  params?: {
    cursor?: string;
  };
}

export interface ListToolsResponse extends MCPResponse {
  result: {
    tools: ToolDefinition[];
    nextCursor?: string;
  };
}

export interface ToolCallMessage extends MCPMessage {
  method: 'tools/call';
  params: {
    name: string;
    arguments?: Record<string, any>;
  };
}

export interface ToolCallResponse extends MCPResponse {
  result: {
    content: ToolResult[];
    isError?: boolean;
  };
}

export interface ServerCapabilities {
  tools?: {
    listChanged?: boolean;
  };
  logging?: {};
  prompts?: {
    listChanged?: boolean;
  };
  resources?: {
    subscribe?: boolean;
    listChanged?: boolean;
  };
}

export interface ServerInfo {
  name: string;
  version: string;
  description?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  requiresUserAuth: boolean;
  requiredScopes: string[];
}

export interface ToolResult {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
  success?: boolean;
  error?: string;
  authChallenge?: AuthorizationRequest;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: any;
}

export interface AuthorizationRequest {
  authorizationUrl: string;
  state: string;
  scope: string;
  sessionId: string;
  expiresAt: Date;
  codeVerifier?: string; // For PKCE flow
}