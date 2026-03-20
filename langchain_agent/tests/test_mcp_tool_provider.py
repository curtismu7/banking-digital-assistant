"""
Unit tests for MCP Tool Provider.
"""
import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime

from src.agent.mcp_tool_provider import MCPToolProvider, MCPTool, MCPToolInput
from src.mcp.tool_registry import MCPClientManager, ToolInfo
from src.authentication.oauth_manager import OAuthAuthenticationManager
from src.models.auth import AccessToken
from src.models.mcp import AuthChallenge


@pytest.fixture
def mock_mcp_client_manager():
    """Mock MCP client manager."""
    manager = Mock(spec=MCPClientManager)
    manager.tool_registry = Mock()
    manager.execute_tool = AsyncMock()
    return manager


@pytest.fixture
def mock_auth_manager():
    """Mock OAuth authentication manager."""
    manager = Mock(spec=OAuthAuthenticationManager)
    manager.get_client_credentials_token = AsyncMock(return_value=AccessToken(
        token="test-token",
        token_type="Bearer",
        expires_in=3600,
        scope="read write",
        issued_at=datetime.now()
    ))
    manager.generate_user_authorization_url = Mock(return_value="https://auth.example.com/authorize")
    return manager


@pytest.fixture
def sample_tool_info():
    """Sample tool info for testing."""
    return ToolInfo(
        name="test_tool",
        server_name="test_server",
        description="A test tool for unit testing"
    )


@pytest.fixture
def sample_tool_infos():
    """Sample tool infos for testing."""
    return {
        "test_server.tool1": ToolInfo(
            name="tool1",
            server_name="test_server",
            description="Test tool 1"
        ),
        "test_server.tool2": ToolInfo(
            name="tool2",
            server_name="test_server",
            description="Test tool 2"
        ),
        "other_server.tool3": ToolInfo(
            name="tool3",
            server_name="other_server",
            description="Test tool 3"
        )
    }


@pytest.fixture
def mcp_tool_provider(mock_mcp_client_manager, mock_auth_manager):
    """Create MCP tool provider for testing."""
    return MCPToolProvider(
        mcp_client_manager=mock_mcp_client_manager,
        auth_manager=mock_auth_manager
    )


class TestMCPTool:
    """Test cases for MCPTool wrapper."""
    
    def test_initialization(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test MCPTool initialization."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        assert tool.name == "test_server_test_tool"  # Dots replaced with underscores
        assert tool.description == "A test tool for unit testing"
        assert tool.tool_info == sample_tool_info
        assert tool.mcp_client_manager == mock_mcp_client_manager
        assert tool.auth_manager == mock_auth_manager
        assert tool._current_session_id is None
        assert tool._current_agent_token is None
    
    def test_initialization_no_description(self, mock_mcp_client_manager, mock_auth_manager):
        """Test MCPTool initialization without description."""
        tool_info = ToolInfo(
            name="test_tool",
            server_name="test_server"
        )
        
        tool = MCPTool(
            tool_info=tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        assert "Execute test_tool tool on test_server server" in tool.description
    
    def test_sync_run_not_implemented(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test that synchronous run raises NotImplementedError."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        with pytest.raises(NotImplementedError):
            tool._run({})
    
    @pytest.mark.asyncio
    async def test_async_run_success(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test successful async tool execution."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        # Set session context
        session_id = "test-session-123"
        agent_token = AccessToken(
            token="test-token",
            token_type="Bearer",
            expires_in=3600,
            scope="read write",
            issued_at=datetime.now()
        )
        tool.set_session_context(session_id, agent_token)
        
        # Mock successful execution
        expected_result = {"result": "Tool executed successfully"}
        mock_mcp_client_manager.execute_tool.return_value = expected_result
        
        parameters = {"param1": "value1"}
        result = await tool._arun(parameters)
        
        assert result == "Tool executed successfully"
        mock_mcp_client_manager.execute_tool.assert_called_once_with(
            server_name="test_server",
            tool_name="test_tool",
            parameters=parameters,
            agent_token=agent_token,
            session_id=session_id
        )
    
    @pytest.mark.asyncio
    async def test_async_run_no_session_context(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test async run without session context."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        with pytest.raises(RuntimeError, match="Session context not set"):
            await tool._arun({})
    
    @pytest.mark.asyncio
    async def test_async_run_expired_token(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test async run with expired token gets new token."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        # Set session context with expired token
        session_id = "test-session-123"
        expired_token = AccessToken(
            token="expired-token",
            token_type="Bearer",
            expires_in=0,  # Expired
            scope="read write",
            issued_at=datetime.now()
        )
        tool.set_session_context(session_id, expired_token)
        
        # Mock successful execution
        expected_result = {"result": "Success"}
        mock_mcp_client_manager.execute_tool.return_value = expected_result
        
        result = await tool._arun({})
        
        assert result == "Success"
        # Should have requested new token
        mock_auth_manager.get_client_credentials_token.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_async_run_auth_challenge(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test async run with authentication challenge."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        # Set session context
        session_id = "test-session-123"
        agent_token = AccessToken(
            token="test-token",
            token_type="Bearer",
            expires_in=3600,
            scope="read write",
            issued_at=datetime.now()
        )
        tool.set_session_context(session_id, agent_token)
        
        # Mock auth challenge response
        challenge = AuthChallenge(
            challenge_type="oauth_authorization_code",
            authorization_url="https://auth.example.com/authorize",
            scope="read write",
            state="test-state"
        )
        mock_mcp_client_manager.execute_tool.return_value = {
            "type": "auth_challenge",
            "challenge": challenge
        }
        
        result = await tool._arun({})
        
        assert "requires user authorization" in result
        assert "https://auth.example.com/authorize" in result
        mock_auth_manager.generate_user_authorization_url.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_async_run_error(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test async run with execution error."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        # Set session context
        session_id = "test-session-123"
        agent_token = AccessToken(
            token="test-token",
            token_type="Bearer",
            expires_in=3600,
            scope="read write",
            issued_at=datetime.now()
        )
        tool.set_session_context(session_id, agent_token)
        
        # Mock execution error
        mock_mcp_client_manager.execute_tool.side_effect = Exception("Tool execution failed")
        
        result = await tool._arun({})
        
        assert "Tool execution failed" in result
    
    def test_set_session_context(self, sample_tool_info, mock_mcp_client_manager, mock_auth_manager):
        """Test setting session context."""
        tool = MCPTool(
            tool_info=sample_tool_info,
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        session_id = "test-session-123"
        agent_token = AccessToken(
            token="test-token",
            token_type="Bearer",
            expires_in=3600,
            scope="read write",
            issued_at=datetime.now()
        )
        
        tool.set_session_context(session_id, agent_token)
        
        assert tool._current_session_id == session_id
        assert tool._current_agent_token == agent_token


class TestMCPToolProvider:
    """Test cases for MCPToolProvider."""
    
    def test_initialization(self, mock_mcp_client_manager, mock_auth_manager):
        """Test MCPToolProvider initialization."""
        provider = MCPToolProvider(
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager
        )
        
        assert provider.mcp_client_manager == mock_mcp_client_manager
        assert provider.auth_manager == mock_auth_manager
        assert provider._tools == []
        assert provider._current_session_id is None
        assert provider._current_agent_token is None
    
    @pytest.mark.asyncio
    async def test_get_langchain_tools(self, mcp_tool_provider, sample_tool_infos):
        """Test getting LangChain tools."""
        # Mock tool registry
        mcp_tool_provider.mcp_client_manager.tool_registry.get_all_tools = AsyncMock(
            return_value=sample_tool_infos
        )
        
        tools = await mcp_tool_provider.get_langchain_tools()
        
        assert len(tools) == 3
        assert all(isinstance(tool, MCPTool) for tool in tools)
        assert tools[0].name == "test_server_tool1"
        assert tools[1].name == "test_server_tool2"
        assert tools[2].name == "other_server_tool3"
        assert mcp_tool_provider._tools == tools
    
    @pytest.mark.asyncio
    async def test_get_langchain_tools_error(self, mcp_tool_provider):
        """Test getting LangChain tools with error."""
        # Mock tool registry error
        mcp_tool_provider.mcp_client_manager.tool_registry.get_all_tools = AsyncMock(
            side_effect=Exception("Registry error")
        )
        
        tools = await mcp_tool_provider.get_langchain_tools()
        
        assert tools == []
    
    @pytest.mark.asyncio
    async def test_get_tools_by_server(self, mcp_tool_provider, sample_tool_infos):
        """Test getting tools for specific server."""
        # Mock tool registry
        server_tools = [sample_tool_infos["test_server.tool1"], sample_tool_infos["test_server.tool2"]]
        mcp_tool_provider.mcp_client_manager.tool_registry.get_server_tools = AsyncMock(
            return_value=server_tools
        )
        
        tools = await mcp_tool_provider.get_tools_by_server("test_server")
        
        assert len(tools) == 2
        assert all(isinstance(tool, MCPTool) for tool in tools)
        assert tools[0].name == "test_server_tool1"
        assert tools[1].name == "test_server_tool2"
    
    @pytest.mark.asyncio
    async def test_find_tools(self, mcp_tool_provider, sample_tool_infos):
        """Test finding tools by pattern."""
        # Mock tool registry
        matching_tools = [sample_tool_infos["test_server.tool1"]]
        mcp_tool_provider.mcp_client_manager.tool_registry.find_tools = AsyncMock(
            return_value=matching_tools
        )
        
        tools = await mcp_tool_provider.find_tools("tool1")
        
        assert len(tools) == 1
        assert isinstance(tools[0], MCPTool)
        assert tools[0].name == "test_server_tool1"
    
    @pytest.mark.asyncio
    async def test_set_session_context(self, mcp_tool_provider, sample_tool_infos):
        """Test setting session context."""
        # Setup tools
        mcp_tool_provider.mcp_client_manager.tool_registry.get_all_tools = AsyncMock(
            return_value=sample_tool_infos
        )
        await mcp_tool_provider.get_langchain_tools()
        
        session_id = "test-session-123"
        
        await mcp_tool_provider.set_session_context(session_id)
        
        assert mcp_tool_provider._current_session_id == session_id
        assert mcp_tool_provider._current_agent_token is not None
        
        # Check that all tools have session context set
        for tool in mcp_tool_provider._tools:
            assert tool._current_session_id == session_id
    
    @pytest.mark.asyncio
    async def test_set_session_context_auth_error(self, mcp_tool_provider):
        """Test setting session context with auth error."""
        # Mock auth manager error
        mcp_tool_provider.auth_manager.get_client_credentials_token = AsyncMock(
            side_effect=Exception("Auth error")
        )
        
        session_id = "test-session-123"
        
        await mcp_tool_provider.set_session_context(session_id)
        
        assert mcp_tool_provider._current_session_id == session_id
        assert mcp_tool_provider._current_agent_token is None
    
    @pytest.mark.asyncio
    async def test_refresh_tools(self, mcp_tool_provider, sample_tool_infos):
        """Test refreshing tools."""
        # Mock tool registry
        mcp_tool_provider.mcp_client_manager.tool_registry.get_all_tools = AsyncMock(
            return_value=sample_tool_infos
        )
        
        # Set initial session context
        session_id = "test-session-123"
        mcp_tool_provider._current_session_id = session_id
        
        tools = await mcp_tool_provider.refresh_tools()
        
        assert len(tools) == 3
        assert mcp_tool_provider._tools == tools
        
        # Check that session context is preserved
        for tool in tools:
            assert tool._current_session_id == session_id
    
    @pytest.mark.asyncio
    async def test_refresh_tools_error(self, mcp_tool_provider):
        """Test refreshing tools with error."""
        # Set some existing tools
        existing_tools = [Mock()]
        mcp_tool_provider._tools = existing_tools
        
        # Mock error
        mcp_tool_provider.mcp_client_manager.tool_registry.get_all_tools = AsyncMock(
            side_effect=Exception("Refresh error")
        )
        
        tools = await mcp_tool_provider.refresh_tools()
        
        # Should return existing tools on error
        assert tools == existing_tools
    
    @pytest.mark.asyncio
    async def test_get_tool_info(self, mcp_tool_provider, sample_tool_infos):
        """Test getting tool information."""
        # Setup tools
        mcp_tool_provider.mcp_client_manager.tool_registry.get_all_tools = AsyncMock(
            return_value=sample_tool_infos
        )
        await mcp_tool_provider.get_langchain_tools()
        
        tools_info = await mcp_tool_provider.get_tool_info()
        
        assert len(tools_info) == 3
        assert tools_info[0]["name"] == "test_server_tool1"
        assert tools_info[0]["server_name"] == "test_server"
        assert tools_info[0]["tool_name"] == "tool1"
        assert tools_info[0]["full_name"] == "test_server.tool1"
    
    def test_get_current_session_id(self, mcp_tool_provider):
        """Test getting current session ID."""
        assert mcp_tool_provider.get_current_session_id() is None
        
        mcp_tool_provider._current_session_id = "test-session-123"
        assert mcp_tool_provider.get_current_session_id() == "test-session-123"
    
    def test_get_tools_count(self, mcp_tool_provider):
        """Test getting tools count."""
        assert mcp_tool_provider.get_tools_count() == 0
        
        mcp_tool_provider._tools = [Mock(), Mock(), Mock()]
        assert mcp_tool_provider.get_tools_count() == 3


if __name__ == "__main__":
    pytest.main([__file__])