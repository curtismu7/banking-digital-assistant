#!/usr/bin/env bash
# stop.sh — Stop all banking digital assistant services

echo "🛑 Stopping Banking Digital Assistant services..."

for pid_file in /tmp/banking-api-server.pid /tmp/banking-mcp-server.pid /tmp/langchain-agent.pid /tmp/banking-ui.pid; do
  if [ -f "$pid_file" ]; then
    PID=$(cat "$pid_file")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID" && echo "   Stopped PID $PID"
    fi
    rm -f "$pid_file"
  fi
done

echo "✅ All services stopped."
