"""
Unit tests for LangChain MCP Agent.
"""
import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch, MagicMock
from datetime import datetime

from src.agent.langchain_mcp_agent import LangChainMCPAgent
from src.agent.mcp_tool_provider import MCPToolProvider
from src.agent.conversation_memory import ConversationMemory
from src.mcp.tool_registry import MCPClientManager
from src.authentication.oauth_manager import OAuthAuthenticationManager
from src.models.auth import AccessToken
from src.models.chat import ChatMessage
from src.config.settings import AppConfig, LangChainConfig


@pytest.fixture
def mock_config():
    """Mock configuration for testing."""
    langchain_config = LangChainConfig(
        model_name="gpt-3.5-turbo",
        temperature=0.7,
        max_tokens=1000,
        openai_api_key="test-key",
        verbose=False,
        max_iterations=10,
        max_execution_time=60
    )
    
    config = Mock(spec=AppConfig)
    config.langchain = langchain_config
    return config


@pytest.fixture
def mock_mcp_client_manager():
    """Mock MCP client manager."""
    manager = Mock(spec=MCPClientManager)
    manager.get_manager_status = AsyncMock(return_value={
        "registered_servers": 1,
        "server_configs": ["test_server"],
        "tool_registry": {"total_tools": 2},
        "connection_pool": {"status": "active"}
    })
    manager.shutdown = AsyncMock()
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
    return manager


@pytest.fixture
def mock_llm():
    """Mock LangChain LLM."""
    with patch('src.agent.langchain_mcp_agent.ChatOpenAI') as mock_chat_openai:
        llm = Mock()
        llm.model_name = "gpt-3.5-turbo"
        mock_chat_openai.return_value = llm
        yield llm


@pytest.fixture
def mock_tools():
    """Mock LangChain tools."""
    tool1 = Mock()
    tool1.name = "test_server_tool1"
    tool1.description = "Test tool 1"
    
    tool2 = Mock()
    tool2.name = "test_server_tool2"
    tool2.description = "Test tool 2"
    
    return [tool1, tool2]


@pytest.fixture
async def agent(mock_config, mock_mcp_client_manager, mock_auth_manager, mock_llm):
    """Create LangChain MCP Agent for testing."""
    with patch('src.agent.langchain_mcp_agent.ChatOpenAI') as mock_chat_openai:
        mock_chat_openai.return_value = mock_llm
        
        agent = LangChainMCPAgent(
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager,
            config=mock_config
        )
        
        yield agent
        
        # Cleanup
        await agent.shutdown()


class TestLangChainMCPAgent:
    """Test cases for LangChain MCP Agent."""
    
    def test_initialization(self, mock_config, mock_mcp_client_manager, mock_auth_manager, mock_llm):
        """Test agent initialization."""
        with patch('src.agent.langchain_mcp_agent.ChatOpenAI') as mock_chat_openai:
            mock_chat_openai.return_value = mock_llm
            
            agent = LangChainMCPAgent(
                mcp_client_manager=mock_mcp_client_manager,
                auth_manager=mock_auth_manager,
                config=mock_config
            )
            
            assert agent.config == mock_config
            assert agent.mcp_client_manager == mock_mcp_client_manager
            assert agent.auth_manager == mock_auth_manager
            assert agent.llm == mock_llm
            assert isinstance(agent.mcp_tool_provider, MCPToolProvider)
            assert isinstance(agent.conversation_memory, ConversationMemory)
            assert agent._agent_executor is None  # Not initialized yet
    
    @pytest.mark.asyncio
    async def test_initialize_tools_success(self, agent, mock_tools):
        """Test successful tool initialization."""
        # Mock tool provider
        agent.mcp_tool_provider.get_langchain_tools = AsyncMock(return_value=mock_tools)
        
        # Mock agent creation
        with patch('src.agent.langchain_mcp_agent.create_openai_functions_agent') as mock_create_agent, \
             patch('src.agent.langchain_mcp_agent.AgentExecutor') as mock_executor_class:
            
            mock_agent = Mock()
            mock_create_agent.return_value = mock_agent
            
            mock_executor = Mock()
            mock_executor_class.return_value = mock_executor
            
            await agent.initialize_tools()
            
            assert agent._tools == mock_tools
            assert agent._agent_executor == mock_executor
            mock_create_agent.assert_called_once()
            mock_executor_class.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_initialize_tools_no_tools(self, agent):
        """Test tool initialization with no available tools."""
        # Mock tool provider returning empty list
        agent.mcp_tool_provider.get_langchain_tools = AsyncMock(return_value=[])
        
        await agent.initialize_tools()
        
        assert agent._tools == []
        assert agent._agent_executor is None
    
    @pytest.mark.asyncio
    async def test_process_message_success(self, agent, mock_tools):
        """Test successful message processing."""
        session_id = "test-session-123"
        user_message = "Hello, can you help me?"
        expected_response = "Hello! I'd be happy to help you."
        
        # Setup mocks
        agent._tools = mock_tools
        mock_executor = Mock()
        mock_executor.ainvoke = AsyncMock(return_value={"output": expected_response})
        agent._agent_executor = mock_executor
        
        agent.conversation_memory.get_conversation_history = AsyncMock(return_value=[])
        agent.conversation_memory.add_message = AsyncMock()
        agent.mcp_tool_provider.set_session_context = AsyncMock()
        
        # Process message
        response = await agent.process_message(user_message, session_id)
        
        assert response == expected_response
        agent.mcp_tool_provider.set_session_context.assert_called_once_with(session_id)
        mock_executor.ainvoke.assert_called_once()
        assert agent.conversation_memory.add_message.call_count == 2  # User and assistant messages
    
    @pytest.mark.asyncio
    async def test_process_message_not_initialized(self, agent, mock_tools):
        """Test message processing when agent is not initialized."""
        session_id = "test-session-123"
        user_message = "Hello"
        
        # Mock initialization
        agent.initialize_tools = AsyncMock()
        agent._agent_executor = None  # Not initialized
        
        response = await agent.process_message(user_message, session_id)
        
        assert "not properly configured" in response
        agent.initialize_tools.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_process_message_authentication_error(self, agent, mock_tools):
        """Test message processing with authentication error."""
        session_id = "test-session-123"
        user_message = "Hello"
        
        # Setup mocks
        agent._tools = mock_tools
        mock_executor = Mock()
        mock_executor.ainvoke = AsyncMock(side_effect=Exception("Authentication failed"))
        agent._agent_executor = mock_executor
        
        agent.conversation_memory.get_conversation_history = AsyncMock(return_value=[])
        agent.mcp_tool_provider.set_session_context = AsyncMock()
        
        response = await agent.process_message(user_message, session_id)
        
        assert "authentication issue" in response.lower()
    
    @pytest.mark.asyncio
    async def test_execute_tool_success(self, agent, mock_tools):
        """Test successful direct tool execution."""
        session_id = "test-session-123"
        tool_name = "test_server_tool1"
        parameters = {"param1": "value1"}
        expected_result = "Tool executed successfully"
        
        # Setup mocks
        agent._tools = mock_tools
        mock_tools[0].arun = AsyncMock(return_value=expected_result)
        agent.mcp_tool_provider.set_session_context = AsyncMock()
        
        result = await agent.execute_tool(tool_name, parameters, session_id)
        
        assert result["result"] == expected_result
        assert result["tool_name"] == tool_name
        assert result["parameters"] == parameters
        agent.mcp_tool_provider.set_session_context.assert_called_once_with(session_id)
        mock_tools[0].arun.assert_called_once_with(parameters)
    
    @pytest.mark.asyncio
    async def test_execute_tool_not_found(self, agent, mock_tools):
        """Test tool execution with non-existent tool."""
        session_id = "test-session-123"
        tool_name = "nonexistent_tool"
        parameters = {}
        
        agent._tools = mock_tools
        
        with pytest.raises(ValueError, match="Tool 'nonexistent_tool' not found"):
            await agent.execute_tool(tool_name, parameters, session_id)
    
    @pytest.mark.asyncio
    async def test_get_available_tools(self, agent, mock_tools):
        """Test getting available tools information."""
        agent._tools = mock_tools
        
        tools_info = await agent.get_available_tools()
        
        assert len(tools_info) == 2
        assert tools_info[0]["name"] == "test_server_tool1"
        assert tools_info[0]["description"] == "Test tool 1"
        assert tools_info[1]["name"] == "test_server_tool2"
        assert tools_info[1]["description"] == "Test tool 2"
    
    @pytest.mark.asyncio
    async def test_get_available_tools_not_initialized(self, agent, mock_tools):
        """Test getting available tools when not initialized."""
        agent.initialize_tools = AsyncMock()
        agent._tools = []
        
        await agent.get_available_tools()
        
        agent.initialize_tools.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_refresh_tools(self, agent, mock_tools):
        """Test refreshing available tools."""
        agent.initialize_tools = AsyncMock()
        agent._tools = mock_tools
        
        await agent.refresh_tools()
        
        agent.initialize_tools.assert_called_once()
    
    @pytest.mark.asyncio
    async def test_get_agent_status(self, agent, mock_tools):
        """Test getting agent status."""
        agent._tools = mock_tools
        agent._agent_executor = Mock()
        agent.conversation_memory.get_active_sessions_count = AsyncMock(return_value=3)
        
        status = await agent.get_agent_status()
        
        assert status["initialized"] is True
        assert status["tools_count"] == 2
        assert status["tools"] == ["test_server_tool1", "test_server_tool2"]
        assert status["memory_sessions"] == 3
        assert "mcp_manager_status" in status
    
    @pytest.mark.asyncio
    async def test_clear_session_memory(self, agent):
        """Test clearing session memory."""
        session_id = "test-session-123"
        agent.conversation_memory.clear_session = AsyncMock()
        
        await agent.clear_session_memory(session_id)
        
        agent.conversation_memory.clear_session.assert_called_once_with(session_id)
    
    @pytest.mark.asyncio
    async def test_shutdown(self, agent):
        """Test agent shutdown."""
        agent.conversation_memory.cleanup = AsyncMock()
        
        await agent.shutdown()
        
        agent.conversation_memory.cleanup.assert_called_once()
        agent.mcp_client_manager.shutdown.assert_called_once()
    
    def test_create_agent_prompt(self, agent):
        """Test agent prompt creation."""
        prompt = agent._create_agent_prompt()
        
        assert prompt is not None
        # Check that the prompt contains expected elements
        prompt_str = str(prompt)
        assert "helpful AI assistant" in prompt_str
        assert "MCP" in prompt_str
        assert "tools" in prompt_str
    
    def test_initialize_llm_success(self, mock_config):
        """Test successful LLM initialization."""
        with patch('src.agent.langchain_mcp_agent.ChatOpenAI') as mock_chat_openai:
            mock_llm = Mock()
            mock_chat_openai.return_value = mock_llm
            
            agent = LangChainMCPAgent(
                mcp_client_manager=Mock(),
                auth_manager=Mock(),
                config=mock_config
            )
            
            assert agent.llm == mock_llm
            mock_chat_openai.assert_called_once()
    
    def test_initialize_llm_fallback(self, mock_config):
        """Test LLM initialization fallback to OpenAI."""
        with patch('src.agent.langchain_mcp_agent.ChatOpenAI') as mock_chat_openai, \
             patch('src.agent.langchain_mcp_agent.OpenAI') as mock_openai:
            
            # Make ChatOpenAI fail
            mock_chat_openai.side_effect = Exception("ChatOpenAI failed")
            
            mock_llm = Mock()
            mock_openai.return_value = mock_llm
            
            agent = LangChainMCPAgent(
                mcp_client_manager=Mock(),
                auth_manager=Mock(),
                config=mock_config
            )
            
            assert agent.llm == mock_llm
            mock_chat_openai.assert_called_once()
            mock_openai.assert_called_once()


if __name__ == "__main__":
    pytest.main([__file__])