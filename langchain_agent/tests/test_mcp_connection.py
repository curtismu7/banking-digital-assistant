"""
Unit tests for MCP connection management.
"""
import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from datetime import datetime, timedelta
import json

from src.mcp.connection import MCPConnection, MCPConnectionPool, ConnectionState
from src.models.mcp import MCPServerConfig, AuthRequirements, AuthRequirementType, MCPToolCall, AuthChallenge
from src.models.auth import AccessToken, AuthorizationCode


@pytest.fixture
def sample_server_config():
    """Sample MCP server configuration for testing"""
    auth_requirements = AuthRequirements(
        type=AuthRequirementType.AGENT_TOKEN,
        scopes=["read", "write"]
    )
    return MCPServerConfig(
        name="test-server",
        endpoint="ws://localhost:8080/mcp",
        capabilities=["tool_execution"],
        auth_requirements=auth_requirements
    )


@pytest.fixture
def sample_access_token():
    """Sample access token for testing"""
    return AccessToken(
        token="test-token-123",
        token_type="Bearer",
        expires_in=3600,
        scope="read write",
        issued_at=datetime.now()
    )


@pytest.fixture
def sample_tool_call(sample_access_token):
    """Sample MCP tool call for testing"""
    return MCPToolCall(
        tool_name="test_tool",
        parameters={"param1": "value1"},
        agent_token=sample_access_token,
        user_auth_code=None,
        session_id="session-123"
    )


class TestMCPConnection:
    """Test cases for MCPConnection class"""
    
    @pytest.mark.asyncio
    async def test_connection_initialization(self, sample_server_config):
        """Test MCP connection initialization"""
        connection = MCPConnection(sample_server_config)
        
        assert connection.server_config == sample_server_config
        assert connection.state == ConnectionState.DISCONNECTED
        assert not connection.is_connected
        assert connection.last_error is None
    
    @pytest.mark.asyncio
    async def test_successful_connection(self, sample_server_config):
        """Test successful connection to MCP server"""
        mock_websocket = AsyncMock()
        
        # Mock handshake response
        handshake_response = {"type": "handshake_ack", "version": "1.0"}
        tools_response = {"type": "tools_list", "tools": ["tool1", "tool2"]}
        
        mock_websocket.recv.side_effect = [
            json.dumps(handshake_response),
            json.dumps(tools_response)
        ]
        
        connection = MCPConnection(sample_server_config)
        
        # Create an async mock that returns the mock websocket
        async def mock_connect(endpoint):
            return mock_websocket
        
        with patch('websockets.connect', side_effect=mock_connect):
            await connection.connect(sample_server_config)
        
        assert connection.state == ConnectionState.CONNECTED
        assert connection.is_connected
        assert await connection.list_tools() == ["tool1", "tool2"]
        
        # Verify handshake and tools list calls
        assert mock_websocket.send.call_count == 2
        mock_websocket.send.assert_any_call(json.dumps({
            "type": "handshake",
            "version": "1.0",
            "capabilities": ["tool_execution", "authentication"]
        }))
        mock_websocket.send.assert_any_call(json.dumps({"type": "list_tools"}))
    
    @pytest.mark.asyncio
    async def test_connection_retry_logic(self, sample_server_config):
        """Test connection retry logic with exponential backoff"""
        connection = MCPConnection(sample_server_config, max_retries=2, retry_delay=0.1)
        
        # Mock connection failures followed by success
        mock_websocket = AsyncMock()
        handshake_response = {"type": "handshake_ack", "version": "1.0"}
        tools_response = {"type": "tools_list", "tools": ["tool1"]}
        
        mock_websocket.recv.side_effect = [
            json.dumps(handshake_response),
            json.dumps(tools_response)
        ]
        
        connection_attempts = 0
        
        async def mock_connect(endpoint):
            nonlocal connection_attempts
            connection_attempts += 1
            if connection_attempts < 3:  # Fail first 2 attempts
                raise ConnectionError("Connection failed")
            return mock_websocket
        
        with patch('websockets.connect', side_effect=mock_connect):
            await connection.connect(sample_server_config)
        
        assert connection.state == ConnectionState.CONNECTED
        assert connection_attempts == 3
    
    @pytest.mark.asyncio
    async def test_connection_max_retries_exceeded(self, sample_server_config):
        """Test connection failure after max retries exceeded"""
        connection = MCPConnection(sample_server_config, max_retries=1, retry_delay=0.1)
        
        async def mock_connect(endpoint):
            raise ConnectionError("Connection failed")
        
        with patch('websockets.connect', side_effect=mock_connect):
            with pytest.raises(ConnectionError):
                await connection.connect(sample_server_config)
        
        assert connection.state == ConnectionState.FAILED
        assert connection.last_error is not None
    
    @pytest.mark.asyncio
    async def test_successful_tool_call(self, sample_server_config, sample_tool_call):
        """Test successful tool call execution"""
        mock_websocket = AsyncMock()
        
        # Mock responses
        handshake_response = {"type": "handshake_ack", "version": "1.0"}
        tools_response = {"type": "tools_list", "tools": ["test_tool"]}
        tool_response = {"type": "result", "result": {"output": "success"}}
        
        mock_websocket.recv.side_effect = [
            json.dumps(handshake_response),
            json.dumps(tools_response),
            json.dumps(tool_response)
        ]
        
        connection = MCPConnection(sample_server_config)
        
        # Create an async mock that returns the mock websocket
        async def mock_connect(endpoint):
            return mock_websocket
        
        with patch('websockets.connect', side_effect=mock_connect):
            await connection.connect(sample_server_config)
            result = await connection.call_tool(sample_tool_call)
        
        assert result == {"output": "success"}
        
        # Verify tool call message
        expected_tool_call = {
            "type": "tool_call",
            "tool_name": "test_tool",
            "parameters": {"param1": "value1"},
            "session_id": "session-123",
            "agent_token": "test-token-123",
            "user_auth_code": None
        }
        mock_websocket.send.assert_called_with(json.dumps(expected_tool_call))
    
    @pytest.mark.asyncio
    async def test_tool_call_auth_challenge(self, sample_server_config, sample_tool_call):
        """Test tool call returning authentication challenge"""
        mock_websocket = AsyncMock()
        
        # Mock responses
        handshake_response = {"type": "handshake_ack", "version": "1.0"}
        tools_response = {"type": "tools_list", "tools": ["test_tool"]}
        auth_challenge_response = {
            "type": "auth_challenge",
            "challenge_type": "oauth_authorization_code",
            "authorization_url": "https://auth.example.com/authorize",
            "scope": "read write",
            "state": "state-123"
        }
        
        mock_websocket.recv.side_effect = [
            json.dumps(handshake_response),
            json.dumps(tools_response),
            json.dumps(auth_challenge_response)
        ]
        
        connection = MCPConnection(sample_server_config)
        
        # Create an async mock that returns the mock websocket
        async def mock_connect(endpoint):
            return mock_websocket
        
        with patch('websockets.connect', side_effect=mock_connect):
            await connection.connect(sample_server_config)
            result = await connection.call_tool(sample_tool_call)
        
        assert result["type"] == "auth_challenge"
        assert isinstance(result["challenge"], AuthChallenge)
        assert result["challenge"].challenge_type == "oauth_authorization_code"
    
    @pytest.mark.asyncio
    async def test_tool_call_error_response(self, sample_server_config, sample_tool_call):
        """Test tool call returning error response"""
        mock_websocket = AsyncMock()
        
        # Mock responses
        handshake_response = {"type": "handshake_ack", "version": "1.0"}
        tools_response = {"type": "tools_list", "tools": ["test_tool"]}
        error_response = {"type": "error", "message": "Tool execution failed"}
        
        mock_websocket.recv.side_effect = [
            json.dumps(handshake_response),
            json.dumps(tools_response),
            json.dumps(error_response)
        ]
        
        connection = MCPConnection(sample_server_config)
        
        # Create an async mock that returns the mock websocket
        async def mock_connect(endpoint):
            return mock_websocket
        
        with patch('websockets.connect', side_effect=mock_connect):
            await connection.connect(sample_server_config)
            
            with pytest.raises(Exception, match="MCP server error: Tool execution failed"):
                await connection.call_tool(sample_tool_call)
    
    @pytest.mark.asyncio
    async def test_disconnect(self, sample_server_config):
        """Test connection disconnect"""
        mock_websocket = AsyncMock()
        
        handshake_response = {"type": "handshake_ack", "version": "1.0"}
        tools_response = {"type": "tools_list", "tools": ["tool1"]}
        
        mock_websocket.recv.side_effect = [
            json.dumps(handshake_response),
            json.dumps(tools_response)
        ]
        
        connection = MCPConnection(sample_server_config)
        
        # Create an async mock that returns the mock websocket
        async def mock_connect(endpoint):
            return mock_websocket
        
        with patch('websockets.connect', side_effect=mock_connect):
            await connection.connect(sample_server_config)
            assert connection.is_connected
            
            await connection.disconnect()
            assert connection.state == ConnectionState.DISCONNECTED
            assert not connection.is_connected
            mock_websocket.close.assert_called_once()


class TestMCPConnectionPool:
    """Test cases for MCPConnectionPool class"""
    
    @pytest.mark.asyncio
    async def test_pool_initialization(self):
        """Test connection pool initialization"""
        pool = MCPConnectionPool(max_connections_per_server=3)
        assert pool.max_connections_per_server == 3
        assert len(pool._connections) == 0
    
    @pytest.mark.asyncio
    async def test_get_connection_new_server(self, sample_server_config):
        """Test getting connection for new server"""
        pool = MCPConnectionPool()
        
        mock_websocket = AsyncMock()
        handshake_response = {"type": "handshake_ack", "version": "1.0"}
        tools_response = {"type": "tools_list", "tools": ["tool1"]}
        
        mock_websocket.recv.side_effect = [
            json.dumps(handshake_response),
            json.dumps(tools_response)
        ]
        
        # Create an async mock that returns the mock websocket
        async def mock_connect(endpoint):
            return mock_websocket
        
        with patch('websockets.connect', side_effect=mock_connect):
            connection = await pool.get_connection(sample_server_config)
        
        assert connection.is_connected
        assert connection.server_config == sample_server_config
        assert len(pool._connections["test-server"]) == 1
    
    @pytest.mark.asyncio
    async def test_get_connection_reuse_existing(self, sample_server_config):
        """Test reusing existing connection from pool"""
        pool = MCPConnectionPool()
        
        mock_websocket = AsyncMock()
        handshake_response = {"type": "handshake_ack", "version": "1.0"}
        tools_response = {"type": "tools_list", "tools": ["tool1"]}
        
        mock_websocket.recv.side_effect = [
            json.dumps(handshake_response),
            json.dumps(tools_response)
        ]
        
        # Create an async mock that returns the mock websocket
        async def mock_connect(endpoint):
            return mock_websocket
        
        with patch('websockets.connect', side_effect=mock_connect):
            connection1 = await pool.get_connection(sample_server_config)
            connection2 = await pool.get_connection(sample_server_config)
        
        # Should reuse the same connection
        assert connection1 is connection2
        assert len(pool._connections["test-server"]) == 1
    
    @pytest.mark.asyncio
    async def test_close_all_connections(self, sample_server_config):
        """Test closing all connections in pool"""
        pool = MCPConnectionPool()
        
        mock_websocket = AsyncMock()
        handshake_response = {"type": "handshake_ack", "version": "1.0"}
        tools_response = {"type": "tools_list", "tools": ["tool1"]}
        
        mock_websocket.recv.side_effect = [
            json.dumps(handshake_response),
            json.dumps(tools_response)
        ]
        
        # Create an async mock that returns the mock websocket
        async def mock_connect(endpoint):
            return mock_websocket
        
        with patch('websockets.connect', side_effect=mock_connect):
            connection = await pool.get_connection(sample_server_config)
            assert connection.is_connected
            
            await pool.close_all_connections()
            
            assert len(pool._connections) == 0
            mock_websocket.close.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_get_pool_status(self, sample_server_config):
        """Test getting pool status"""
        pool = MCPConnectionPool()
        
        mock_websocket = AsyncMock()
        handshake_response = {"type": "handshake_ack", "version": "1.0"}
        tools_response = {"type": "tools_list", "tools": ["tool1"]}
        
        mock_websocket.recv.side_effect = [
            json.dumps(handshake_response),
            json.dumps(tools_response)
        ]
        
        # Create an async mock that returns the mock websocket
        async def mock_connect(endpoint):
            return mock_websocket
        
        with patch('websockets.connect', side_effect=mock_connect):
            await pool.get_connection(sample_server_config)
            
            status = await pool.get_pool_status()
            
            assert "test-server" in status
            assert status["test-server"]["total_connections"] == 1
            assert status["test-server"]["connected"] == 1
            assert status["test-server"]["failed"] == 0