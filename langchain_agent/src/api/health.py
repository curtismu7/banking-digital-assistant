"""
Health check endpoints for monitoring and status.
"""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, Any
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import threading

from config.settings import get_config


logger = logging.getLogger(__name__)


class HealthCheckHandler(BaseHTTPRequestHandler):
    """HTTP handler for health check endpoints."""
    
    def __init__(self, app_status, *args, **kwargs):
        self.app_status = app_status
        super().__init__(*args, **kwargs)
    
    def do_GET(self):
        """Handle GET requests."""
        if self.path == "/health":
            self._handle_health_check()
        elif self.path == "/status":
            self._handle_status_check()
        else:
            self._send_response(404, {"error": "Not found"})
    
    def _handle_health_check(self):
        """Handle basic health check."""
        response = {
            "status": "healthy" if self.app_status.get("initialized", False) else "starting",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": "1.0.0"
        }
        self._send_response(200, response)
    
    def _handle_status_check(self):
        """Handle detailed status check."""
        response = {
            "status": "healthy" if self.app_status.get("initialized", False) else "starting",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "version": "1.0.0",
            "components": {
                "oauth_manager": self.app_status.get("oauth_manager", "unknown"),
                "mcp_manager": self.app_status.get("mcp_manager", "unknown"),
                "agent": self.app_status.get("agent", "unknown"),
                "websocket_server": self.app_status.get("websocket_server", "unknown"),
                "message_processor": self.app_status.get("message_processor", "unknown")
            },
            "uptime_seconds": self.app_status.get("uptime_seconds", 0),
            "environment": self.app_status.get("environment", "unknown")
        }
        self._send_response(200, response)
    
    def _send_response(self, status_code: int, data: Dict[str, Any]):
        """Send JSON response."""
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        
        response_json = json.dumps(data, indent=2)
        self.wfile.write(response_json.encode())
    
    def log_message(self, format, *args):
        """Override to use our logger."""
        logger.debug(f"Health check: {format % args}")


class HealthCheckServer:
    """HTTP server for health check endpoints."""
    
    def __init__(self, port: int = 8080):
        self.port = port
        self.app_status = {
            "initialized": False,
            "start_time": datetime.now(timezone.utc),
            "environment": get_config().environment
        }
        self.server = None
        self.server_thread = None
    
    def start(self):
        """Start the health check server."""
        try:
            # Create handler with app status
            def handler(*args, **kwargs):
                return HealthCheckHandler(self.app_status, *args, **kwargs)
            
            # Create server
            self.server = HTTPServer(("0.0.0.0", self.port), handler)
            
            # Start server in background thread
            self.server_thread = threading.Thread(
                target=self.server.serve_forever,
                daemon=True
            )
            self.server_thread.start()
            
            logger.info(f"Health check server started on port {self.port}")
            logger.info(f"Health check: http://localhost:{self.port}/health")
            logger.info(f"Status check: http://localhost:{self.port}/status")
            
        except Exception as e:
            logger.error(f"Failed to start health check server: {e}")
            raise
    
    def stop(self):
        """Stop the health check server."""
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            logger.info("Health check server stopped")
    
    def update_status(self, component: str, status: str):
        """Update component status."""
        self.app_status[component] = status
        
        # Update uptime
        uptime = datetime.now(timezone.utc) - self.app_status["start_time"]
        self.app_status["uptime_seconds"] = int(uptime.total_seconds())
    
    def set_initialized(self, initialized: bool = True):
        """Set application as initialized."""
        self.app_status["initialized"] = initialized