# Banking MCP Server

A TypeScript-based Model Context Protocol (MCP) server for banking operations with PingOne Advanced Identity Cloud authentication.

## Features

- Secure authentication and session management with PingOne AIC
- Banking operations (balance inquiry, transfers, transaction history)
- MCP protocol compliance with WebSocket support
- TypeScript type safety and comprehensive testing
- Dual-token authentication (agent + user tokens)
- PKCE-enhanced OAuth 2.0 authorization code flow

## Prerequisites

- Node.js 20.x or higher
- npm 9.x or higher
- PingOne Advanced Identity Cloud account with OAuth clients configured
- Banking API server running

> **📋 OAuth Setup Required**: You need to configure OAuth clients in PingOne Advanced Identity Cloud before running the server. See [PingOne OAuth Setup Guide](./docs/pingone-oauth-setup.md) for detailed configuration instructions.

## Development

### Setup

```bash
npm install
```

### Development Mode

```bash
npm run start:dev
```

### Build

```bash
npm run build
```

### Testing

```bash
npm test
npm run test:watch
```

### Linting

```bash
npm run lint
npm run lint:fix
```

## Project Structure

```
src/
├── config/           # Configuration management
├── interfaces/       # Core interfaces for MCP, auth, and banking
├── types/           # Type definitions
└── index.ts         # Main entry point

tests/
├── config/          # Configuration tests
└── types/           # Type tests
```

## Core Interfaces

### MCP Protocol (`src/interfaces/mcp.ts`)
- MCPMessage, MCPResponse, MCPError
- HandshakeMessage, ListToolsMessage, ToolCallMessage
- ToolDefinition, ToolResult, JSONSchema

### Authentication (`src/interfaces/auth.ts`)
- AgentTokenInfo, UserTokens, Session
- PingOne configuration and token management
- AuthenticationError with error codes

### Banking (`src/interfaces/banking.ts`)
- Account, Transaction, TransactionRequest/Response
- Banking API client configuration
- BankingAPIError handling

### Configuration (`src/interfaces/config.ts`)
- BankingMCPServerConfig for complete server setup
- Environment variable definitions
- Default configuration values

## Configuration

Copy `.env.example` to `.env` and configure the required environment variables:

- **PingOne Configuration**: Authentication endpoints and credentials
- **Banking API Configuration**: Banking API server connection settings  
- **Security Configuration**: Encryption keys and token storage
- **Server Configuration**: Host, port, and connection limits

## License

MIT