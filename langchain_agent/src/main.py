#!/usr/bin/env python3
"""
Main application entry point for LangChain MCP OAuth Agent.

This module starts the complete application including:
- OAuth authentication manager
- MCP client manager
- LangChain agent
- WebSocket chat interface
- Session management
"""

import asyncio
import logging
import signal
import sys
from pathlib import Path
from typing import Optional

# Add src to Python path
sys.path.insert(0, str(Path(__file__).parent))

from config.settings import get_config
from authentication.oauth_manager import OAuthAuthenticationManager
from mcp.tool_registry import MCPClientManager
from agent.langchain_mcp_agent import LangChainMCPAgent
from api.websocket_handler import ChatWebSocketHandler
from api.message_processor import MessageProcessor
from api.session_manager import SessionManager
from api.health import HealthCheckServer
from log_utils.structured_logger import setup_logging


logger = logging.getLogger(__name__)


class LangChainMCPApplication:
    """Main application class that orchestrates all components."""
    
    def __init__(self):
        self.config = get_config()
        self.oauth_manager: Optional[OAuthAuthenticationManager] = None
        self.mcp_manager: Optional[MCPClientManager] = None
        self.agent: Optional[LangChainMCPAgent] = None
        self.session_manager: Optional[SessionManager] = None
        self.websocket_handler: Optional[ChatWebSocketHandler] = None
        self.message_processor: Optional[MessageProcessor] = None
        self.websocket_server = None
        self.health_server: Optional[HealthCheckServer] = None
        self._shutdown_event = asyncio.Event()
        
    async def initialize(self):
        """Initialize all application components."""
        logger.info("Initializing LangChain MCP OAuth Agent...")
        
        try:
            # Start health check server first
            logger.info("Starting health check server...")
            self.health_server = HealthCheckServer(port=8081)  # Use different port
            self.health_server.start()
            
            # Initialize OAuth manager
            logger.info("Initializing OAuth authentication manager...")
            self.oauth_manager = OAuthAuthenticationManager(self.config)
            await self.oauth_manager.__aenter__()
            self.health_server.update_status("oauth_manager", "initializing")
            
            # Register OAuth client with ai_agent scope
            logger.info("Registering OAuth client with ai_agent scope...")
            await self.oauth_manager.register_client(additional_scopes=["ai_agent"])
            self.health_server.update_status("oauth_manager", "ready")
            
            # Initialize MCP client manager
            logger.info("Initializing MCP client manager...")
            self.mcp_manager = MCPClientManager()
            
            # Register MCP servers from configuration
            await self._register_mcp_servers()
            
            self.health_server.update_status("mcp_manager", "ready")
            
            # Initialize LangChain agent
            logger.info("Initializing LangChain agent...")
            self.agent = LangChainMCPAgent(
                mcp_client_manager=self.mcp_manager,
                auth_manager=self.oauth_manager,
                config=self.config
            )
            self.health_server.update_status("agent", "initializing")
            
            # Initialize agent tools
            await self.agent.initialize_tools()
            self.health_server.update_status("agent", "ready")
            
            # Initialize session manager
            logger.info("Initializing session manager...")
            self.session_manager = SessionManager(self.config)
            
            # Initialize WebSocket handler
            logger.info("Initializing WebSocket handler...")
            self.websocket_handler = ChatWebSocketHandler(self.config)
            
            # Initialize message processor
            logger.info("Initializing message processor...")
            self.message_processor = MessageProcessor(
                agent=self.agent,
                session_manager=self.session_manager,
                websocket_handler=self.websocket_handler,
                config=self.config
            )
            self.health_server.update_status("message_processor", "initializing")
            
            # Wire components together
            self.websocket_handler.set_message_processor(self.message_processor)
            self.websocket_handler.set_session_manager(self.session_manager)
            
            # Start message processor
            await self.message_processor.start()
            self.health_server.update_status("message_processor", "ready")
            
            # Mark as initialized
            self.health_server.set_initialized(True)
            
            logger.info("✅ All components initialized successfully")
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize application: {e}")
            await self.cleanup()
            raise
    
    async def _register_mcp_servers(self):
        """Register MCP servers from environment configuration."""
        from config.settings import get_mcp_server_configs
        from models.mcp import MCPServerConfig, AuthRequirements, AuthRequirementType
        
        # Register the built-in user management server first
        try:
            logger.info("Registering built-in user management MCP server")
            
            # Create auth requirements for user management server
            auth_requirements = AuthRequirements(
                type=AuthRequirementType.AGENT_TOKEN,
                scopes=["ai_agent"]
            )
            
            # Create server config for local user management server
            user_mgmt_config = MCPServerConfig(
                name="user_management",
                endpoint="local://user_management",
                capabilities=["user_lookup", "account_registration"],
                auth_requirements=auth_requirements
            )
            
            # Register the server
            await self.mcp_manager.register_server(user_mgmt_config)
            logger.info("✅ Successfully registered user management MCP server")
            
        except Exception as e:
            logger.error(f"❌ Failed to register user management MCP server: {e}")
        
        # Get MCP server configurations from environment
        server_configs = get_mcp_server_configs()
        
        if not server_configs:
            logger.info("No additional MCP servers configured in environment")
            return
        
        logger.info(f"Found {len(server_configs)} additional MCP server(s) in configuration")
        
        for server_name, config in server_configs.items():
            try:
                logger.info(f"Registering MCP server: {server_name} at {config['endpoint']}")
                
                # Create auth requirements
                auth_requirements = AuthRequirements(
                    type=AuthRequirementType.AGENT_TOKEN if config.get('auth_required', False) else AuthRequirementType.NONE,
                    scopes=config.get('capabilities', ['read'])
                )
                
                # Create server config
                mcp_server_config = MCPServerConfig(
                    name=server_name,
                    endpoint=config['endpoint'],
                    capabilities=config.get('capabilities', ['read']),
                    auth_requirements=auth_requirements
                )
                
                # Register the server
                await self.mcp_manager.register_server(mcp_server_config)
                logger.info(f"✅ Successfully registered MCP server: {server_name}")
                
            except Exception as e:
                logger.error(f"❌ Failed to register MCP server {server_name}: {e}")
                # Continue with other servers even if one fails
    
    async def start_websocket_server(self):
        """Start the WebSocket server."""
        import websockets
        
        host = "0.0.0.0"
        port = self.config.chat.websocket_port
        
        logger.info(f"Starting WebSocket server on {host}:{port}...")
        
        try:
            self.websocket_server = await websockets.serve(
                self.websocket_handler.handle_connection,
                host,
                port,
                ping_interval=30,
                ping_timeout=10,
                close_timeout=10
            )
            
            self.health_server.update_status("websocket_server", "ready")
            logger.info(f"✅ WebSocket server started on ws://{host}:{port}")
            
        except Exception as e:
            self.health_server.update_status("websocket_server", "failed")
            logger.error(f"❌ Failed to start WebSocket server: {e}")
            raise
    
    async def run(self):
        """Run the application."""
        try:
            # Initialize components
            await self.initialize()
            
            # Start WebSocket server
            await self.start_websocket_server()
            
            # Register signal handlers
            self._setup_signal_handlers()
            
            logger.info("🚀 LangChain MCP OAuth Agent is running!")
            logger.info(f"📡 WebSocket endpoint: ws://localhost:{self.config.chat.websocket_port}")
            logger.info("🔗 Frontend URL: http://localhost:3030 (if running)")
            logger.info("📋 Health check: http://localhost:8081/health")
            logger.info("Press Ctrl+C to stop")
            
            # Wait for shutdown signal
            await self._shutdown_event.wait()
            
        except KeyboardInterrupt:
            logger.info("Received keyboard interrupt, shutting down...")
        except Exception as e:
            logger.error(f"Application error: {e}")
            raise
        finally:
            await self.cleanup()
    
    def _setup_signal_handlers(self):
        """Setup signal handlers for graceful shutdown."""
        def signal_handler(signum, frame):
            logger.info(f"Received signal {signum}, initiating shutdown...")
            self._shutdown_event.set()
        
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
    
    async def cleanup(self):
        """Cleanup all resources."""
        logger.info("Cleaning up application resources...")
        
        try:
            # Stop health check server
            if self.health_server:
                self.health_server.stop()
                logger.info("✅ Health check server stopped")
            
            # Stop WebSocket server
            if self.websocket_server:
                self.websocket_server.close()
                await self.websocket_server.wait_closed()
                logger.info("✅ WebSocket server stopped")
            
            # Stop message processor
            if self.message_processor:
                await self.message_processor.stop()
                logger.info("✅ Message processor stopped")
            
            # Shutdown WebSocket handler
            if self.websocket_handler:
                await self.websocket_handler.shutdown()
                logger.info("✅ WebSocket handler shutdown")
            
            # Shutdown session manager
            if self.session_manager:
                await self.session_manager.shutdown()
                logger.info("✅ Session manager shutdown")
            
            # Shutdown agent
            if self.agent:
                await self.agent.shutdown()
                logger.info("✅ Agent shutdown")
            
            # Shutdown MCP manager
            if self.mcp_manager:
                await self.mcp_manager.shutdown()
                logger.info("✅ MCP manager shutdown")
            
            # Shutdown OAuth manager
            if self.oauth_manager:
                await self.oauth_manager.__aexit__(None, None, None)
                logger.info("✅ OAuth manager shutdown")
            
            logger.info("🏁 Application cleanup complete")
            
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")


async def main():
    """Main entry point."""
    # Setup logging
    setup_logging()
    
    logger.info("Starting LangChain MCP OAuth Agent...")
    
    try:
        # Validate configuration
        config = get_config()
        logger.info(f"Running in {config.environment} environment")
        
        # Create and run application
        app = LangChainMCPApplication()
        await app.run()
        
    except Exception as e:
        logger.error(f"Failed to start application: {e}")
        sys.exit(1)


if __name__ == "__main__":
    # Run the application
    asyncio.run(main())