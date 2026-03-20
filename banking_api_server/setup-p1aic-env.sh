#!/bin/bash

# P1AIC OAuth Configuration Setup Script
# This script helps set up environment variables for P1AIC OAuth integration

echo "🔐 P1AIC OAuth Configuration Setup"
echo "=================================="
echo ""

# Check if .env file exists
if [ -f ".env" ]; then
    echo "📁 Found existing .env file"
    source .env
else
    echo "📁 Creating new .env file"
fi

echo ""
echo "Please provide your P1AIC configuration:"
echo ""

# Get tenant name
if [ -z "$P1AIC_TENANT_NAME" ]; then
    read -p "Enter your P1AIC tenant name: " P1AIC_TENANT_NAME
else
    echo "Current P1AIC tenant name: $P1AIC_TENANT_NAME"
    read -p "Press Enter to keep current value or type new value: " NEW_TENANT_NAME
    if [ ! -z "$NEW_TENANT_NAME" ]; then
        P1AIC_TENANT_NAME=$NEW_TENANT_NAME
    fi
fi

# Get client ID
if [ -z "$P1AIC_CLIENT_ID" ]; then
    read -p "Enter your P1AIC client ID: " P1AIC_CLIENT_ID
else
    echo "Current P1AIC client ID: $P1AIC_CLIENT_ID"
    read -p "Press Enter to keep current value or type new value: " NEW_CLIENT_ID
    if [ ! -z "$NEW_CLIENT_ID" ]; then
        P1AIC_CLIENT_ID=$NEW_CLIENT_ID
    fi
fi

# Get client secret
if [ -z "$P1AIC_CLIENT_SECRET" ]; then
    read -s -p "Enter your P1AIC client secret: " P1AIC_CLIENT_SECRET
    echo ""
else
    echo "Current P1AIC client secret: [hidden]"
    read -s -p "Press Enter to keep current value or type new value: " NEW_CLIENT_SECRET
    echo ""
    if [ ! -z "$NEW_CLIENT_SECRET" ]; then
        P1AIC_CLIENT_SECRET=$NEW_CLIENT_SECRET
    fi
fi

# Get MCP server URL (optional)
if [ -z "$MCP_SERVER_URL" ]; then
    read -p "Enter MCP server URL (default: http://localhost:3000/mcp): " MCP_SERVER_URL
    if [ -z "$MCP_SERVER_URL" ]; then
        MCP_SERVER_URL="http://localhost:3000/mcp"
    fi
else
    echo "Current MCP server URL: $MCP_SERVER_URL"
    read -p "Press Enter to keep current value or type new value: " NEW_SERVER_URL
    if [ ! -z "$NEW_SERVER_URL" ]; then
        MCP_SERVER_URL=$NEW_SERVER_URL
    fi
fi

# Write to .env file
echo "📝 Writing configuration to .env file..."
cat > .env << EOF
# P1AIC OAuth Configuration
P1AIC_TENANT_NAME=$P1AIC_TENANT_NAME
P1AIC_CLIENT_ID=$P1AIC_CLIENT_ID
P1AIC_CLIENT_SECRET=$P1AIC_CLIENT_SECRET

# MCP Server Configuration
MCP_SERVER_URL=$MCP_SERVER_URL
EOF

echo ""
echo "✅ Configuration saved to .env file"
echo ""
echo "🔗 P1AIC OAuth endpoints:"
echo "   Authorization: https://openam-${P1AIC_TENANT_NAME}.forgeblocks.com/am/oauth2/realms/root/realms/alpha/authorize"
echo "   Token: https://openam-${P1AIC_TENANT_NAME}.forgeblocks.com/am/oauth2/realms/root/realms/alpha/access_token"
echo "   Registration: https://openam-${P1AIC_TENANT_NAME}.forgeblocks.com/am/oauth2/realms/root/realms/alpha/connect/register"
echo ""
echo "🚀 To run the MCP server with P1AIC OAuth:"
echo "   source .env && npx tsx src/examples/server/simpleStreamableHttp.ts --oauth"
echo ""
echo "🚀 To run the MCP client with P1AIC OAuth:"
echo "   source .env && npx tsx src/examples/client/simpleOAuthClient.ts"
echo ""
echo "📋 Make sure to configure the following in your P1AIC tenant:"
echo "   - Client ID: $P1AIC_CLIENT_ID"
echo "   - Redirect URI: http://localhost:8090/callback"
echo "   - Grant types: authorization_code, refresh_token"
echo "   - Response types: code"
echo "   - Token endpoint auth method: client_secret_post"
echo "   - Scopes: mcp:tools openid profile email"

