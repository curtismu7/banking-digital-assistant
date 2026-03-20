# P1AIC OAuth Integration with MCP

This guide explains how to configure and use PingOne Advanced Identity Cloud (P1AIC) as the OAuth provider for the MCP server and client.

## 🔐 Overview

The MCP server and client have been modified to use P1AIC instead of the demo OAuth server. This provides enterprise-grade authentication and authorization capabilities.

## 🚀 Quick Setup

### 1. Run the Setup Script

```bash
./setup-p1aic-env.sh
```

This interactive script will:
- Prompt for your P1AIC tenant name, client ID, and client secret
- Create a `.env` file with your configuration
- Display the P1AIC OAuth endpoints
- Show you what to configure in your P1AIC tenant

### 2. Configure P1AIC Tenant

In your P1AIC tenant, create an OAuth client with these settings:

- **Client ID**: (the one you provided in setup)
- **Redirect URI**: `http://localhost:8090/callback`
- **Grant Types**: `authorization_code`, `refresh_token`
- **Response Types**: `code`
- **Token Endpoint Auth Method**: `client_secret_post`
- **Scopes**: `mcp:tools openid profile email`

### 3. Run the MCP Server with P1AIC OAuth

```bash
source .env && npx tsx src/examples/server/simpleStreamableHttp.ts --oauth
```

### 4. Run the MCP Client with P1AIC OAuth

```bash
source .env && npx tsx src/examples/client/simpleOAuthClient.ts
```

## 🔧 Manual Configuration

If you prefer to configure manually, create a `.env` file with:

```bash
# P1AIC OAuth Configuration
P1AIC_TENANT_NAME=your-tenant-name
P1AIC_CLIENT_ID=your-client-id
P1AIC_CLIENT_SECRET=your-client-secret

# MCP Server Configuration
MCP_SERVER_URL=http://localhost:3000/mcp
```

## 🌐 P1AIC OAuth Endpoints

The following endpoints will be used automatically:

- **Authorization**: `https://openam-{tenant}.forgeblocks.com/am/oauth2/realms/root/realms/alpha/authorize`
- **Token**: `https://openam-{tenant}.forgeblocks.com/am/oauth2/realms/root/realms/alpha/access_token`
- **Registration**: `https://openam-{tenant}.forgeblocks.com/am/oauth2/realms/root/realms/alpha/connect/register`
- **User Info**: `https://openam-{tenant}.forgeblocks.com/am/oauth2/realms/root/realms/alpha/userinfo`

## 🔄 OAuth Flow

1. **Client Initialization**: MCP client connects to server
2. **OAuth Discovery**: Server returns P1AIC issuer in `serverInfo.auth`
3. **Dynamic Client Registration**: Client registers with P1AIC
4. **Authorization**: Browser opens P1AIC login page
5. **Callback**: User authorizes, returns to client
6. **Token Exchange**: Client exchanges code for access token
7. **Authenticated Requests**: Client uses token for MCP requests

## 🛠️ Troubleshooting

### Common Issues

1. **"Please set P1AIC_TENANT_NAME environment variable"**
   - Run `./setup-p1aic-env.sh` or set the environment variable manually

2. **"OAuth authorization failed"**
   - Check that your P1AIC client is configured correctly
   - Verify redirect URI matches exactly: `http://localhost:8090/callback`
   - Ensure scopes include `mcp:tools openid profile email`

3. **"Connection refused"**
   - Make sure the MCP server is running with `--oauth` flag
   - Check that port 3000 is available

4. **"Invalid client"**
   - Verify client ID and secret in `.env` file
   - Check that client is active in P1AIC tenant

### Debug Mode

To see detailed OAuth flow logs, the server includes comprehensive debug logging that shows:
- All HTTP requests and responses
- OAuth redirect URLs
- Token exchange details
- Authentication headers

## 🔒 Security Considerations

- Store client secrets securely (use environment variables)
- Use HTTPS in production
- Implement proper token storage and refresh logic
- Consider implementing PKCE for additional security
- Regularly rotate client secrets

## 📋 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `P1AIC_TENANT_NAME` | Your P1AIC tenant name | Yes |
| `P1AIC_CLIENT_ID` | OAuth client ID from P1AIC | Yes |
| `P1AIC_CLIENT_SECRET` | OAuth client secret from P1AIC | Yes |
| `MCP_SERVER_URL` | MCP server URL | No (defaults to localhost:3000) |

## 🎯 Example Usage

```bash
# 1. Setup configuration
./setup-p1aic-env.sh

# 2. Start server (in one terminal)
source .env && npx tsx src/examples/server/simpleStreamableHttp.ts --oauth

# 3. Start client (in another terminal)
source .env && npx tsx src/examples/client/simpleOAuthClient.ts

# 4. Follow the OAuth flow in your browser
# 5. Use the interactive client to call MCP tools
```

## 🔗 Related Files

- `src/examples/server/simpleStreamableHttp.ts` - MCP server with P1AIC OAuth
- `src/examples/client/simpleOAuthClient.ts` - MCP client with P1AIC OAuth
- `setup-p1aic-env.sh` - Configuration setup script
- `.env` - Environment configuration (created by setup script)

