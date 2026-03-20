"""
MCP connection management with pooling and retry logic.
"""
import asyncio
import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from enum import Enum
import json
import websockets
from websockets.exceptions import ConnectionClosed, WebSocketException

from models.mcp import MCPServerConfig, MCPToolCall, AuthChallenge
from models.auth import AccessToken
from services.interfaces import MCPClient
from .local_connection import LocalMCPConnection


logger = logging.getLogger(__name__)


class ConnectionState(Enum):
    """Connection states for MCP connections"""
    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    FAILED = "failed"


class MCPConnection(MCPClient):
    """Individual MCP server connection with retry logic"""
    
    def __init__(self, server_config: MCPServerConfig, max_retries: int = 3, 
                 retry_delay: float = 1.0, connection_timeout: float = 30.0):
        self.server_config = server_config
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.connection_timeout = connection_timeout
        
        self._websocket: Optional[websockets.WebSocketServerProtocol] = None
        self._state = ConnectionState.DISCONNECTED
        self._last_error: Optional[Exception] = None
        self._retry_count = 0
        self._available_tools: List[str] = []
        self._tool_schemas: Dict[str, Dict[str, Any]] = {}
        self._connection_lock = asyncio.Lock()
        
        logger.info(f"Initialized MCP connection for server: {server_config.name}")
    
    @property
    def state(self) -> ConnectionState:
        """Get current connection state"""
        return self._state
    
    @property
    def is_connected(self) -> bool:
        """Check if connection is active"""
        return self._state == ConnectionState.CONNECTED and self._websocket is not None
    
    @property
    def last_error(self) -> Optional[Exception]:
        """Get last connection error"""
        return self._last_error
    
    async def connect(self, server_config: MCPServerConfig) -> None:
        """Establish connection to MCP server with retry logic"""
        async with self._connection_lock:
            if self.is_connected:
                logger.debug(f"Already connected to {server_config.name}")
                return
            
            self._state = ConnectionState.CONNECTING
            self._retry_count = 0
            
            while self._retry_count <= self.max_retries:
                try:
                    logger.info(f"Connecting to MCP server {server_config.name} (attempt {self._retry_count + 1})")
                    
                    # Connect to WebSocket endpoint
                    self._websocket = await asyncio.wait_for(
                        websockets.connect(server_config.endpoint),
                        timeout=self.connection_timeout
                    )
                    
                    # Perform handshake
                    await self._perform_handshake()
                    
                    # List available tools
                    await self._refresh_tools()
                    
                    self._state = ConnectionState.CONNECTED
                    self._last_error = None
                    self._retry_count = 0
                    
                    logger.info(f"Successfully connected to MCP server {server_config.name}")
                    return
                    
                except (ConnectionClosed, WebSocketException, asyncio.TimeoutError, ConnectionError) as e:
                    self._last_error = e
                    self._retry_count += 1
                    
                    if self._retry_count <= self.max_retries:
                        delay = self.retry_delay * (2 ** (self._retry_count - 1))  # Exponential backoff
                        logger.warning(f"Connection failed for {server_config.name}, retrying in {delay}s: {e}")
                        await asyncio.sleep(delay)
                    else:
                        self._state = ConnectionState.FAILED
                        logger.error(f"Failed to connect to {server_config.name} after {self.max_retries} attempts: {e}")
                        raise
                
                except Exception as e:
                    self._last_error = e
                    self._state = ConnectionState.FAILED
                    logger.error(f"Unexpected error connecting to {server_config.name}: {e}")
                    raise
    
    async def disconnect(self) -> None:
        """Close connection to MCP server"""
        async with self._connection_lock:
            if self._websocket:
                try:
                    await self._websocket.close()
                    logger.info(f"Disconnected from MCP server {self.server_config.name}")
                except Exception as e:
                    logger.warning(f"Error during disconnect from {self.server_config.name}: {e}")
                finally:
                    self._websocket = None
                    self._state = ConnectionState.DISCONNECTED
                    self._available_tools = []
                    self._tool_schemas = {}
    
    async def call_tool(self, tool_call: MCPToolCall) -> Dict[str, Any]:
        """Execute a tool call on the MCP server using JSON-RPC 2.0 format"""
        if not self.is_connected:
            await self._ensure_connected()
        
        try:
            # Prepare tool call message using JSON-RPC 2.0 format
            params = {
                "name": tool_call.tool_name,
                "arguments": tool_call.parameters
            }
            
            # Include agent token if available
            if tool_call.agent_token:
                params["agentToken"] = tool_call.agent_token.token
                logger.debug(f"Including agent token in request")
            
            # Include user auth code if available
            if tool_call.user_auth_code:
                params["userAuthCode"] = tool_call.user_auth_code.code
                logger.debug(f"Including user auth code in request")
            
            message = {
                "jsonrpc": "2.0",
                "id": f"tool_call_{datetime.now().timestamp()}",
                "method": "tools/call",
                "params": params
            }
            
            logger.info(f"Sending tools/call request to {self.server_config.name}: {message}")
            logger.debug(f"Tool call details - name: {tool_call.tool_name}, params: {tool_call.parameters}")
            logger.debug(f"Session ID: {tool_call.session_id}")
            logger.debug(f"Agent token present: {tool_call.agent_token is not None}")
            logger.debug(f"User auth code present: {tool_call.user_auth_code is not None}")
            
            # Send message and wait for response
            await self._websocket.send(json.dumps(message))
            logger.debug(f"Sent message to MCP server, waiting for response...")
            
            response_data = await self._websocket.recv()
            logger.debug(f"Received raw response: {response_data}")
            
            response = json.loads(response_data)
            logger.info(f"Received tools/call response from {self.server_config.name}: {response}")
            
            # Check for JSON-RPC error
            if "error" in response:
                error = response["error"]
                error_code = error.get('code', 'unknown')
                error_msg = error.get('message', 'Unknown error')
                error_data = error.get('data', {})
                
                logger.info(f"Tool call JSON-RPC error from {self.server_config.name}: Code {error_code}, Message: {error_msg}")
                logger.debug(f"Error data: {error_data}")
                
                # Handle authentication errors by triggering auth challenge
                if error_code == -32001 or error_data.get('type') == 'authentication_error':
                    logger.info(f"Authentication required for {self.server_config.name}, creating auth challenge")
                    
                    # Create an authentication challenge
                    # This should trigger the user authorization flow
                    challenge = AuthChallenge(
                        challenge_type="oauth2",
                        authorization_url="",  # Will be filled by auth manager
                        scope="banking:accounts:read banking:transactions:read banking:transactions:write",
                        state=f"session_{tool_call.session_id}"
                    )
                    return {"type": "auth_challenge", "challenge": challenge}
                
                # For other errors, raise exception
                full_error_msg = f"JSON-RPC Error {error_code}: {error_msg}"
                logger.error(f"Tool call error from {self.server_config.name}: {full_error_msg}")
                raise Exception(f"MCP server error: {full_error_msg}")
            
            # Handle authentication challenges (if the server supports them)
            if "result" in response and isinstance(response["result"], dict):
                result = response["result"]
                if result.get("type") == "auth_challenge":
                    logger.info(f"Authentication challenge received from {self.server_config.name}")
                    challenge = AuthChallenge(
                        challenge_type=result["challenge_type"],
                        authorization_url=result["authorization_url"],
                        scope=result["scope"],
                        state=result["state"]
                    )
                    return {"type": "auth_challenge", "challenge": challenge}
            
            # Return successful response
            result = response.get("result", {})
            logger.info(f"Tool call successful, returning result: {result}")
            return result
            
        except (ConnectionClosed, WebSocketException) as e:
            logger.error(f"Connection lost during tool call to {self.server_config.name}: {e}")
            await self._handle_connection_loss()
            raise
        
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON response from {self.server_config.name}: {e}")
            logger.error(f"Raw response data: {response_data}")
            raise Exception(f"Invalid JSON response from MCP server: {e}")
        
        except Exception as e:
            logger.error(f"Error executing tool call on {self.server_config.name}: {e}")
            logger.error(f"Exception type: {type(e)}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
            raise
    
    async def list_tools(self) -> List[str]:
        """List available tools on the MCP server"""
        if not self.is_connected:
            await self._ensure_connected()
        
        return self._available_tools.copy()
    
    async def get_tool_schema(self, tool_name: str) -> Optional[Dict[str, Any]]:
        """Get schema for a specific tool"""
        if not self.is_connected:
            await self._ensure_connected()
        
        return self._tool_schemas.get(tool_name)
    
    async def handle_auth_challenge(self, challenge: AuthChallenge) -> Dict[str, Any]:
        """Handle authentication challenge from MCP server"""
        if not self.is_connected:
            await self._ensure_connected()
        
        try:
            # Send challenge response
            message = {
                "type": "auth_challenge_response",
                "challenge_type": challenge.challenge_type,
                "state": challenge.state
            }
            
            await self._websocket.send(json.dumps(message))
            response_data = await self._websocket.recv()
            response = json.loads(response_data)
            
            return response
            
        except Exception as e:
            logger.error(f"Error handling auth challenge for {self.server_config.name}: {e}")
            raise
    
    async def _perform_handshake(self) -> None:
        """Perform initial handshake with MCP server using JSON-RPC 2.0"""
        # Send initialize request according to banking MCP server specification
        initialize_message = {
            "jsonrpc": "2.0",
            "id": "handshake-1",
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "tools": {
                        "listChanged": False
                    }
                }
            }
        }
        
        await self._websocket.send(json.dumps(initialize_message))
        response_data = await self._websocket.recv()
        response = json.loads(response_data)
        
        # Check for JSON-RPC error
        if "error" in response:
            raise Exception(f"Initialize error: {response['error']}")
        
        # Validate initialize response
        if response.get("id") != "handshake-1" or "result" not in response:
            raise Exception(f"Invalid initialize response: {response}")
        
        # Send initialized notification (if required by the server)
        # Note: Some MCP servers may not require this notification
        initialized_message = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }
        
        await self._websocket.send(json.dumps(initialized_message))
        
        logger.info(f"MCP handshake completed with {self.server_config.name}")
    
    async def _refresh_tools(self) -> None:
        """Refresh list of available tools from server using MCP protocol"""
        try:
            list_tools_message = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": {}
            }
            
            logger.info(f"Sending tools/list request: {list_tools_message}")
            await self._websocket.send(json.dumps(list_tools_message))
            response_data = await self._websocket.recv()
            response = json.loads(response_data)
            
            logger.info(f"Received tools/list response: {response}")
            
            # Check for JSON-RPC error
            if "error" in response:
                logger.warning(f"Error listing tools: {response['error']}")
                self._available_tools = []
                self._tool_schemas = {}
                return
            
            # Extract tools from MCP response
            if response.get("id") == 1 and "result" in response:
                tools_result = response["result"]
                if "tools" in tools_result:
                    # Extract tool names and schemas from MCP tool objects
                    self._available_tools = []
                    self._tool_schemas = {}
                    
                    for tool in tools_result["tools"]:
                        if "name" in tool:
                            tool_name = tool["name"]
                            self._available_tools.append(tool_name)
                            
                            # Store the full tool schema for parameter extraction
                            self._tool_schemas[tool_name] = {
                                "name": tool_name,
                                "description": tool.get("description", ""),
                                "inputSchema": tool.get("inputSchema", {})
                            }
                    
                    logger.info(f"Successfully refreshed {len(self._available_tools)} tools for {self.server_config.name}: {self._available_tools}")
                    logger.debug(f"Tool schemas: {self._tool_schemas}")
                else:
                    self._available_tools = []
                    self._tool_schemas = {}
                    logger.warning(f"No 'tools' field in response result: {tools_result}")
            else:
                logger.warning(f"Unexpected response to tools/list: {response}")
                self._available_tools = []
                self._tool_schemas = {}
                
        except Exception as e:
            logger.error(f"Error during tools refresh: {e}")
            self._available_tools = []
            self._tool_schemas = {}
    
    async def _ensure_connected(self) -> None:
        """Ensure connection is active, reconnect if necessary"""
        if not self.is_connected:
            if self._state == ConnectionState.FAILED:
                # Reset state for retry
                self._state = ConnectionState.DISCONNECTED
                self._retry_count = 0
            
            await self.connect(self.server_config)
    
    async def _handle_connection_loss(self) -> None:
        """Handle unexpected connection loss"""
        self._state = ConnectionState.RECONNECTING
        self._websocket = None
        
        try:
            await self._ensure_connected()
        except Exception as e:
            logger.error(f"Failed to reconnect to {self.server_config.name}: {e}")
            self._state = ConnectionState.FAILED


class MCPConnectionPool:
    """Connection pool for managing multiple MCP server connections"""
    
    def __init__(self, max_connections_per_server: int = 5):
        self.max_connections_per_server = max_connections_per_server
        self._connections: Dict[str, List[MCPConnection]] = {}
        self._connection_lock = asyncio.Lock()
        
        logger.info(f"Initialized MCP connection pool with max {max_connections_per_server} connections per server")
    
    async def get_connection(self, server_config: MCPServerConfig) -> MCPClient:
        """Get an available connection for the specified server"""
        async with self._connection_lock:
            server_name = server_config.name
            
            # Check if this is a local server
            if server_config.endpoint.startswith("local://"):
                # For local servers, create a single connection per server
                if server_name not in self._connections:
                    self._connections[server_name] = []
                
                connections = self._connections[server_name]
                
                # Return existing local connection if available
                for connection in connections:
                    if isinstance(connection, LocalMCPConnection) and connection.is_connected:
                        return connection
                
                # Create new local connection
                local_connection = LocalMCPConnection(server_config)
                await local_connection.connect(server_config)
                connections.append(local_connection)
                return local_connection
            
            # Handle WebSocket connections (existing logic)
            # Initialize connection list for server if not exists
            if server_name not in self._connections:
                self._connections[server_name] = []
            
            connections = self._connections[server_name]
            
            # Find an available connected connection
            for connection in connections:
                if isinstance(connection, MCPConnection) and connection.is_connected:
                    return connection
            
            # Find a disconnected connection to reuse
            for connection in connections:
                if isinstance(connection, MCPConnection) and connection.state == ConnectionState.DISCONNECTED:
                    await connection.connect(server_config)
                    return connection
            
            # Create new connection if under limit
            if len(connections) < self.max_connections_per_server:
                connection = MCPConnection(server_config)
                await connection.connect(server_config)
                connections.append(connection)
                return connection
            
            # All connections are busy or failed, wait for one to become available
            # For now, just return the first one and let it handle reconnection
            if connections:
                connection = connections[0]
                if isinstance(connection, MCPConnection) and not connection.is_connected:
                    await connection.connect(server_config)
                return connection
            
            # Fallback: create new connection (shouldn't reach here normally)
            connection = MCPConnection(server_config)
            await connection.connect(server_config)
            connections.append(connection)
            return connection
    
    async def close_all_connections(self) -> None:
        """Close all connections in the pool"""
        async with self._connection_lock:
            for server_connections in self._connections.values():
                for connection in server_connections:
                    await connection.disconnect()
            
            self._connections.clear()
            logger.info("Closed all connections in MCP connection pool")
    
    async def get_pool_status(self) -> Dict[str, Dict[str, Any]]:
        """Get status of all connections in the pool"""
        status = {}
        
        for server_name, connections in self._connections.items():
            server_status = {
                "total_connections": len(connections),
                "connected": sum(1 for conn in connections if conn.is_connected),
                "failed": sum(1 for conn in connections if isinstance(conn, MCPConnection) and conn.state == ConnectionState.FAILED),
                "connecting": sum(1 for conn in connections if isinstance(conn, MCPConnection) and conn.state == ConnectionState.CONNECTING),
                "local": sum(1 for conn in connections if isinstance(conn, LocalMCPConnection))
            }
            status[server_name] = server_status
        
        return status