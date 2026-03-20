#!/usr/bin/env bash
# start.sh — Start all banking digital assistant services
set -e

BASEDIR="$(cd "$(dirname "$0")" && pwd)"

echo "🏦 Starting Banking Digital Assistant..."
echo "   Using PingOne environment: ${PINGONE_ENVIRONMENT_ID:-see .env files}"

# Check for node_modules
for svc in banking_api_server banking_mcp_server langchain_agent banking_api_ui; do
  if [ ! -d "$BASEDIR/$svc/node_modules" ]; then
    echo "📦 Installing dependencies for $svc..."
    (cd "$BASEDIR/$svc" && npm install)
  fi
done

# Start banking_api_server (port 3001)
echo "🚀 Starting Banking API Server on :3001..."
(cd "$BASEDIR/banking_api_server" && npm start > /tmp/banking-api-server.log 2>&1) &
echo $! > /tmp/banking-api-server.pid

sleep 1

# Start banking_mcp_server (port 8080)
if [ -d "$BASEDIR/banking_mcp_server" ]; then
  echo "🤖 Starting Banking MCP Server on :8080..."
  (cd "$BASEDIR/banking_mcp_server" && cp .env.development .env 2>/dev/null; npm start > /tmp/banking-mcp-server.log 2>&1) &
  echo $! > /tmp/banking-mcp-server.pid
fi

# Start langchain_agent backend (port 8888)
if [ -f "$BASEDIR/langchain_agent/server.py" ] || [ -f "$BASEDIR/langchain_agent/main.py" ]; then
  echo "🔗 Starting LangChain Agent Backend on :8888..."
  (cd "$BASEDIR/langchain_agent" && python3 -m uvicorn main:app --port 8888 > /tmp/langchain-agent.log 2>&1) &
  echo $! > /tmp/langchain-agent.pid
fi

# Start banking_api_ui (port 3000)
if [ -d "$BASEDIR/banking_api_ui" ]; then
  echo "🌐 Starting Banking UI on :3000..."
  (cd "$BASEDIR/banking_api_ui" && npm start > /tmp/banking-ui.log 2>&1) &
  echo $! > /tmp/banking-ui.pid
fi

echo ""
echo "✅ Services started:"
echo "   Banking API Server: http://localhost:3001"
echo "   Banking MCP Server: http://localhost:8080"
echo "   Banking UI:         http://localhost:3000"
echo "   LangChain Agent:    http://localhost:8888"
echo ""
echo "📋 Logs:"
echo "   Banking API: /tmp/banking-api-server.log"
echo "   MCP Server:  /tmp/banking-mcp-server.log"
echo "   Agent:       /tmp/langchain-agent.log"
echo "   UI:          /tmp/banking-ui.log"
echo ""
echo "ℹ️  To stop all services: ./stop.sh"
