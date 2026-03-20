"""
Unit tests for agent message processing workflows.
"""
import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime

from src.agent.langchain_mcp_agent import LangChainMCPAgent
from src.mcp.tool_registry import MCPClientManager
from src.authentication.oauth_manager import OAuthAuthenticationManager
from src.models.auth import AccessToken
from src.models.mcp import AuthChallenge
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
def mock_tools():
    """Mock LangChain tools."""
    tool1 = Mock()
    tool1.name = "test_server_tool1"
    tool1.description = "Test tool 1"
    tool1.arun = AsyncMock(return_value="Tool 1 executed successfully")
    
    tool2 = Mock()
    tool2.name = "test_server_tool2"
    tool2.description = "Test tool 2"
    tool2.arun = AsyncMock(return_value="Tool 2 executed successfully")
    
    return [tool1, tool2]


@pytest.fixture
def agent_with_tools(mock_config, mock_mcp_client_manager, mock_auth_manager, mock_tools):
    """Create agent with initialized tools."""
    with patch('src.agent.langchain_mcp_agent.ChatOpenAI') as mock_chat_openai:
        mock_llm = Mock()
        mock_llm.model_name = "gpt-3.5-turbo"
        mock_chat_openai.return_value = mock_llm
        
        agent = LangChainMCPAgent(
            mcp_client_manager=mock_mcp_client_manager,
            auth_manager=mock_auth_manager,
            config=mock_config
        )
        
        # Mock tool initialization
        agent.mcp_tool_provider.get_langchain_tools = AsyncMock(return_value=mock_tools)
        
        # Initialize tools
        with patch('src.agent.langchain_mcp_agent.create_openai_functions_agent') as mock_create_agent, \
             patch('src.agent.langchain_mcp_agent.AgentExecutor') as mock_executor_class:
            
            mock_agent_instance = Mock()
            mock_create_agent.return_value = mock_agent_instance
            
            mock_executor = Mock()
            mock_executor_class.return_value = mock_executor
            agent._agent_executor = mock_executor
            agent._tools = mock_tools
        
        return agent, mock_executor


class TestAgentMessageProcessing:
    """Test cases for agent message processing workflows."""
    
    @pytest.mark.asyncio
    async def test_successful_message_processing(self, agent_with_tools):
        """Test successful message processing workflow."""
        agent, mock_executor = agent_with_tools
        
        session_id = "test-session-123"
        user_message = "Can you help me with a task?"
        expected_response = "I'd be happy to help you with that task!"
        
        # Mock conversation memory
        agent.conversation_memory.get_conversation_history = AsyncMock(return_value=[])
        agent.conversation_memory.add_message = AsyncMock()
        
        # Mock tool provider
        agent.mcp_tool_provider.set_session_context = AsyncMock()
        
        # Mock agent executor
        mock_executor.ainvoke = AsyncMock(return_value={"output": expected_response})
        
        # Process message
        response = await agent.process_message(user_message, session_id)
        
        # Verify response
        assert response == expected_response
        
        # Verify workflow
        agent.conversation_memory.get_conversation_history.assert_called_once_with(session_id)
        agent.mcp_tool_provider.set_session_context.assert_called_once_with(session_id)
        mock_executor.ainvoke.assert_called_once()
        
        # Verify messages were stored
        assert agent.conversation_memory.add_message.call_count == 2  # User and assistant messages
        
        # Verify agent input structure
        call_args = mock_executor.ainvoke.call_args[0][0]
        assert call_args["input"] == user_message
        assert "chat_history" in call_args
        assert "tool_names" in call_args
    
    @pytest.mark.asyncio
    async def test_message_processing_with_conversation_history(self, agent_with_tools):
        """Test message processing with existing conversation history."""
        agent, mock_executor = agent_with_tools
        
        session_id = "test-session-123"
        user_message = "What about the previous task?"
        
        # Mock conversation history
        from langchain_core.messages import HumanMessage, AIMessage
        mock_history = [
            HumanMessage(content="Can you help me?"),
            AIMessage(content="Sure, I can help!")
        ]
        agent.conversation_memory.get_conversation_history = AsyncMock(return_value=mock_history)
        agent.conversation_memory.add_message = AsyncMock()
        
        # Mock tool provider
        agent.mcp_tool_provider.set_session_context = AsyncMock()
        
        # Mock agent executor
        mock_executor.ainvoke = AsyncMock(return_value={"output": "I remember our previous conversation."})
        
        # Process message
        response = await agent.process_message(user_message, session_id)
        
        # Verify that history was passed to agent
        call_args = mock_executor.ainvoke.call_args[0][0]
        assert call_args["chat_history"] == mock_history
    
    @pytest.mark.asyncio
    async def test_message_processing_authentication_error(self, agent_with_tools):
        """Test message processing with authentication error."""
        agent, mock_executor = agent_with_tools
        
        session_id = "test-session-123"
        user_message = "Do something that requires auth"
        
        # Mock conversation memory
        agent.conversation_memory.get_conversation_history = AsyncMock(return_value=[])
        agent.mcp_tool_provider.set_session_context = AsyncMock()
        
        # Mock authentication error
        mock_executor.ainvoke = AsyncMock(side_effect=Exception("Authentication failed"))
        
        # Process message
        response = await agent.process_message(user_message, session_id)
        
        # Verify error handling
        assert "authentication issue" in response.lower()
        assert "authorization" in response.lower()
    
    @pytest.mark.asyncio
    async def test_message_processing_timeout_error(self, agent_with_tools):
        """Test message processing with timeout error."""
        agent, mock_executor = agent_with_tools
        
        session_id = "test-session-123"
        user_message = "Do something that takes too long"
        
        # Mock conversation memory
        agent.conversation_memory.get_conversation_history = AsyncMock(return_value=[])
        agent.mcp_tool_provider.set_session_context = AsyncMock()
        
        # Mock timeout error
        mock_executor.ainvoke = AsyncMock(side_effect=Exception("Request timeout"))
        
        # Process message
        response = await agent.process_message(user_message, session_id)
        
        # Verify error handling
        assert "took too long" in response.lower()
        assert "try again" in response.lower()
    
    @pytest.mark.asyncio
    async def test_message_processing_generic_error(self, agent_with_tools):
        """Test message processing with generic error."""
        agent, mock_executor = agent_with_tools
        
        session_id = "test-session-123"
        user_message = "Do something that fails"
        
        # Mock conversation memory
        agent.conversation_memory.get_conversation_history = AsyncMock(return_value=[])
        agent.mcp_tool_provider.set_session_context = AsyncMock()
        
        # Mock generic error
        mock_executor.ainvoke = AsyncMock(side_effect=Exception("Something went wrong"))
        
        # Process message
        response = await agent.process_message(user_message, session_id)
        
        # Verify error handling
        assert "encountered an error" in response.lower()
        assert "try again" in response.lower()
    
    @pytest.mark.asyncio
    async def test_direct_tool_execution_success(self, agent_with_tools):
        """Test direct tool execution workflow."""
        agent, _ = agent_with_tools
        
        session_id = "test-session-123"
        tool_name = "test_server_tool1"
        parameters = {"param1": "value1", "param2": "value2"}
        
        # Mock tool provider
        agent.mcp_tool_provider.set_session_context = AsyncMock()
        
        # Execute tool
        result = await agent.execute_tool(tool_name, parameters, session_id)
        
        # Verify result
        assert result["result"] == "Tool 1 executed successfully"
        assert result["tool_name"] == tool_name
        assert result["parameters"] == parameters
        
        # Verify session context was set
        agent.mcp_tool_provider.set_session_context.assert_called_once_with(session_id)
        
        # Verify tool was called
        tool = agent._tools[0]  # First tool
        tool.arun.assert_called_once_with(parameters)
    
    @pytest.mark.asyncio
    async def test_direct_tool_execution_tool_not_found(self, agent_with_tools):
        """Test direct tool execution with non-existent tool."""
        agent, _ = agent_with_tools
        
        session_id = "test-session-123"
        tool_name = "nonexistent_tool"
        parameters = {}
        
        # Execute tool
        with pytest.raises(ValueError, match="Tool 'nonexistent_tool' not found"):
            await agent.execute_tool(tool_name, parameters, session_id)
    
    @pytest.mark.asyncio
    async def test_direct_tool_execution_error(self, agent_with_tools):
        """Test direct tool execution with tool error."""
        agent, _ = agent_with_tools
        
        session_id = "test-session-123"
        tool_name = "test_server_tool1"
        parameters = {"param1": "value1"}
        
        # Mock tool provider
        agent.mcp_tool_provider.set_session_context = AsyncMock()
        
        # Mock tool error
        tool = agent._tools[0]
        tool.arun = AsyncMock(side_effect=Exception("Tool execution failed"))
        
        # Execute tool
        with pytest.raises(Exception, match="Tool execution failed"):
            await agent.execute_tool(tool_name, parameters, session_id)
    
    @pytest.mark.asyncio
    async def test_message_processing_with_tool_selection(self, agent_with_tools):
        """Test message processing that involves tool selection and execution."""
        agent, mock_executor = agent_with_tools
        
        session_id = "test-session-123"
        user_message = "Use tool1 to process some data"
        
        # Mock conversation memory
        agent.conversation_memory.get_conversation_history = AsyncMock(return_value=[])
        agent.conversation_memory.add_message = AsyncMock()
        
        # Mock tool provider
        agent.mcp_tool_provider.set_session_context = AsyncMock()
        
        # Mock agent executor to simulate tool usage
        mock_executor.ainvoke = AsyncMock(return_value={
            "output": "I used tool1 to process your data successfully. The result is: processed_data"
        })
        
        # Process message
        response = await agent.process_message(user_message, session_id)
        
        # Verify response mentions tool usage
        assert "tool1" in response.lower()
        assert "processed" in response.lower()
        
        # Verify agent was called with tool information
        call_args = mock_executor.ainvoke.call_args[0][0]
        assert len(call_args["tool_names"]) == 2  # Both tools available
        assert "test_server_tool1" in call_args["tool_names"]
        assert "test_server_tool2" in call_args["tool_names"]
    
    @pytest.mark.asyncio
    async def test_error_handling_preserves_conversation_state(self, agent_with_tools):
        """Test that errors don't corrupt conversation state."""
        agent, mock_executor = agent_with_tools
        
        session_id = "test-session-123"
        user_message = "This will fail"
        
        # Mock conversation memory
        agent.conversation_memory.get_conversation_history = AsyncMock(return_value=[])
        agent.conversation_memory.add_message = AsyncMock()
        
        # Mock tool provider
        agent.mcp_tool_provider.set_session_context = AsyncMock()
        
        # Mock executor error
        mock_executor.ainvoke = AsyncMock(side_effect=Exception("Processing failed"))
        
        # Process message
        response = await agent.process_message(user_message, session_id)
        
        # Verify error response
        assert "error" in response.lower()
        
        # Verify conversation memory operations were still attempted
        agent.conversation_memory.get_conversation_history.assert_called_once_with(session_id)
        agent.mcp_tool_provider.set_session_context.assert_called_once_with(session_id)
        
        # Note: add_message might not be called if the error occurs before response generation
        # This is acceptable behavior as we don't want to store failed interactions
    
    @pytest.mark.asyncio
    async def test_concurrent_message_processing(self, agent_with_tools):
        """Test concurrent message processing for different sessions."""
        agent, mock_executor = agent_with_tools
        
        # Mock conversation memory and tool provider
        agent.conversation_memory.get_conversation_history = AsyncMock(return_value=[])
        agent.conversation_memory.add_message = AsyncMock()
        agent.mcp_tool_provider.set_session_context = AsyncMock()
        
        # Mock executor with different responses
        responses = ["Response for session 1", "Response for session 2", "Response for session 3"]
        mock_executor.ainvoke = AsyncMock(side_effect=[{"output": resp} for resp in responses])
        
        # Process messages concurrently
        tasks = [
            agent.process_message(f"Message {i}", f"session-{i}")
            for i in range(1, 4)
        ]
        
        results = await asyncio.gather(*tasks)
        
        # Verify all messages were processed
        assert len(results) == 3
        assert "session 1" in results[0].lower()
        assert "session 2" in results[1].lower()
        assert "session 3" in results[2].lower()
        
        # Verify all sessions had context set
        assert agent.mcp_tool_provider.set_session_context.call_count == 3


if __name__ == "__main__":
    pytest.main([__file__])