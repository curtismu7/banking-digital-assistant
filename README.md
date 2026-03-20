# Banking Digital Assistant — PingOne Edition

Standalone AI-powered banking demo using PingOne for authentication and **RFC 8693 Token Exchange** so the AI agent can securely access banking data on behalf of users.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│              Banking Digital Assistant                    │
│                                                           │
│  banking_api_ui (:3000)   ←→   banking_api_server (:3001) │
│       React UI                  Express banking API        │
│                                    ↑ JWT validation        │
│                                    │ via PingOne JWKS      │
│                                                           │
│  langchain_agent (:8888)  ←→   banking_mcp_server (:8080) │
│    LangChain + OpenAI           MCP tools for banking      │
│           ↓ Token Exchange                                 │
│    oauth-playground (:3001)  (or PingOne directly)        │
└─────────────────────────────────────────────────────────┘
                        ↓
              PingOne (auth.pingone.com)
              Environment: b9817c16-...
```

## Key Changes from Original (ForgeRock/P1AIC → PingOne)

| Component | Before | After |
|---|---|---|
| AS endpoints | `openam-*.forgeblocks.com/am/oauth2/...` | `auth.pingone.com/{envId}/as/...` |
| Token validation | P1AIC introspection (HTTP call) | PingOne JWKS (JWT signature) |
| Token Exchange | Not implemented | RFC 8693 via `grant_type=urn:ietf:params:oauth:grant-type:token-exchange` |
| MCP server config | `PINGONE_BASE_URL=*.pingidentity.com` | `PINGONE_BASE_URL=https://auth.pingone.com/{envId}/as` |

## Services

| Service | Port | Description |
|---|---|---|
| `banking_api_server` | 3001 | Express REST API — banking accounts, transactions, admin |
| `banking_api_ui` | 3000 | React frontend for admin/customer portal |
| `banking_mcp_server` | 8080 | TypeScript MCP server — exposes banking tools to AI agents |
| `langchain_agent` | 8888 | LangChain agent + WebSocket frontend |

## Quick Start

1. **Install dependencies** (first time only):
   ```bash
   cd banking_api_server && npm install
   cd ../banking_mcp_server && npm install
   cd ../banking_api_ui && npm install
   ```

2. **Start the banking API server** (primary service):
   ```bash
   cd banking_api_server && npm start
   ```

3. **Start the MCP server** (for AI agent tool calls):
   ```bash
   cd banking_mcp_server
   cp .env.development .env
   npm start
   ```

4. **Start the UI**:
   ```bash
   cd banking_api_ui && npm start
   ```

## Token Exchange Flow

The AI agent (langchain_agent / MCP server) uses **RFC 8693 Token Exchange** to exchange its own agent access token for a user-delegated banking token:

```
Agent → PingOne (client_credentials) → agent_access_token
Agent → /api/token-exchange (oauth-playground OR PingOne directly):
  grant_type = urn:ietf:params:oauth:grant-type:token-exchange
  subject_token = agent_access_token
  requested_token_type = urn:ietf:params:oauth:token-type:access_token
  audience = banking_api_enduser
  scope = banking:read banking:transactions:read
→ user_delegated_token
Agent → banking_api_server (with user_delegated_token)
```

The `oauth-playground` server (`/api/token-exchange`) has a full RFC 8693 implementation 
for PingOne — either run it alongside this app or implement the exchange directly.

## PingOne Configuration Required

In your PingOne environment (`b9817c16-9910-4415-b67e-4ac687da74d9`), you need:

1. **Worker App** (client_credentials) — for MCP server & agent token
   - Already configured: `66a4686b-9222-4ad2-91b6-03113711c9aa`

2. **Web Application** (auth_code + PKCE) — for user login
   - Already configured: `a4f963ea-0736-456a-be72-b1fa4f63f81f`

3. **Token Exchange** policy — allow the Worker App to exchange tokens
   - In PingOne: Applications → Policies → Token Exchange
   - Subject token issuer: same PingOne environment
   - Requested audience: `banking_api_enduser`

## Environment Files

| File | Purpose |
|---|---|
| `banking_api_server/.env` | Banking API config (PingOne credentials, port) |
| `banking_mcp_server/.env.development` | MCP server config (copy to `.env` before running) |
| `langchain_agent/.env` | Agent config (OpenAI key, PingOne endpoints) |
| `banking_api_ui/.env` | React frontend config |
