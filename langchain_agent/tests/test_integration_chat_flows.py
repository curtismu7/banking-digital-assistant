"""
Integration tests for end-to-end chat flows.

These tests verify complete user chat sessions including:
- Complete user chat sessions from WebSocket to agent response
- Authorization flow integration within chat context
- Performance tests for concurrent user sessions
"""
import pytest
import asyncio
import json
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from typing import Dict, Any, List
import websockets
from websockets.exceptions import ConnectionClosed

from src.api.websocket_handler import ChatWebSocketHandler
from src.api.message_processor import MessageProcessor
from src.api.session_manager import SessionManager
from src.agent.langchain_mcp_agent import LangChainMCPAgent
from src.agent.mcp_tool_provider import MCPToolProvider
from src.agent.conversation_memory import ConversationMemory
from src.mcp.tool_registry import MCPClientManager
from src.authentication.oauth_manager import OAuthAuthenticationManager
from src.models.chat import ChatMessage, ChatSession, MessageRole
from src.models.auth import AccessToken, AuthorizationCode
from src.models.mcp import MCPServerConfig, AuthRequirements, AuthRequirementType
from src.config.settings import AppConfig, PingOneConfig, SecurityConfig, ChatConfig, LangChainConfig


@pytest.fixture
def integration_config():
    """Create configuration for chat integration testing."""
    return AppConfig(
        environment="integration",
        debug=True,
        log_level="DEBUG",
        pingone=PingOneConfig(
            base_url="https://integration-tenant.forgeblocks.com",
            client_registration_endpoint="https://integration-tenant.forgeblocks.com/am/oauth2/realms/alpha/register",
            token_endpoint="https://integration-tenant.forgeblocks.com/am/oauth2/realms/alpha/access_token",
            authorization_endpoint="https://integration-tenant.forgeblocks.com/am/oauth2/realms/alpha/authorize",
            default_scope="openid profile mcp:access",
            redirect_uri="https://localhost:8080/oauth/callback",
            realm="alpha"
        ),
        security=SecurityConfig(
            encryption_key="integration-test-key-32-chars",
            token_expiry_buffer_seconds=300,
            session_timeout_minutes=60,
            max_retry_attempts=3,
            retry_backoff_seconds=1
        ),
        chat=ChatConfig(
            max_message_length=4000,
            session_timeout_minutes=30,
            max_concurrent_sessions=100
        ),
        langchain=LangChainConfig(
            model_name="gpt-3.5-turbo",
            temperature=0.7,
            max_tokens=1000,
            openai_api_key="test-openai-key",
            verbose=True,
            max_iterations=5,
            max_execution_time=30
        ),
        mcp=MagicMock()
    )


@pytest.fixture
def mock_agent_token():
    """Create a mock agent access token."""
    return AccessToken(
        token="chat-integration-agent-token",
        token_type="Bearer",
        expires_in=3600,
        scope="openid profile mcp:access",
        issued_at=datetime.now(timezone.utc)
    )


@pytest.fixture
async def chat_system_components(integration_config, mock_agent_token):
    """Create and initialize all chat system components."""
    # Create OAuth manager
    oauth_manager = MagicMock()
    oauth_manager.get_client_credentials_token = AsyncMock(return_value=mock_agent_token)
    oauth_manager.generate_user_authorization_url = MagicMock(
        return_value="https://github.com/login/oauth/authorize?client_id=test&scope=repo&state=test-state"
    )
    oauth_manager.handle_user_authorization_callback = MagicMock(
        return_value={
            "authorization_code": "test-auth-code",
            "state": "test-state",
            "session_id": "test-session",
            "mcp_server_id": "github-mcp"
        }
    )
    
    # Create MCP client manager
    mcp_manager = MCPClientManager()
    
    # Mock MCP tools
    mock_tools = [
        MagicMock(name="list_repositories", description="List GitHub repositories"),
        MagicMock(name="create_issue", description="Create a GitHub issue"),
        MagicMock(name="search_code", description="Search code in repositories")
    ]
    
    # Create agent components
    conversation_memory = ConversationMemory()
    mcp_tool_provider = MCPToolProvider(mcp_manager, oauth_manager)
    
    # Mock LangChain agent
    agent = MagicMock(spec=LangChainMCPAgent)
    agent.process_message = AsyncMock()
    agent.get_available_tools = AsyncMock(return_value=[
        {"name": "list_repositories", "description": "List GitHub repositories"},
        {"name": "create_issue", "description": "Create a GitHub issue"}
    ])
    
    # Create session manager
    session_manager = SessionManager(integration_config)
    
    # Create WebSocket handler
    websocket_handler = ChatWebSocketHandler(integration_config)
    
    # Create message processor
    message_processor = MessageProcessor(
        agent=agent,
        session_manager=session_manager,
        websocket_handler=websocket_handler,
        config=integration_config
    )
    
    # Wire components together
    websocket_handler.set_message_processor(message_processor)
    
    # Start message processor
    await message_processor.start()
    
    components = {
        "oauth_manager": oauth_manager,
        "mcp_manager": mcp_manager,
        "agent": agent,
        "session_manager": session_manager,
        "websocket_handler": websocket_handler,
        "message_processor": message_processor,
        "conversation_memory": conversation_memory
    }
    
    yield components
    
    # Cleanup
    await message_processor.stop()
    await session_manager.shutdown()
    await websocket_handler.shutdown()


class MockWebSocket:
    """Mock WebSocket for testing."""
    
    def __init__(self):
        self.sent_messages = []
        self.received_messages = []
        self.closed = False
        
    async def send(self, message: str):
        """Mock send method."""
        if self.closed:
            raise ConnectionClosed(None, None)
        self.sent_messages.append(json.loads(message))
    
    async def recv(self):
        """Mock recv method."""
        if self.closed:
            raise ConnectionClosed(None, None)
        if self.received_messages:
            return self.received_messages.pop(0)
        await asyncio.sleep(0.1)  # Simulate waiting
        raise ConnectionClosed(None, None)
    
    def add_received_message(self, message: Dict[str, Any]):
        """Add a message to be received."""
        self.received_messages.append(json.dumps(message))
    
    async def close(self):
        """Mock close method."""
        self.closed = True
    
    def __aiter__(self):
        """Async iterator for messages."""
        return self
    
    async def __anext__(self):
        """Get next message."""
        if self.received_messages:
            return self.received_messages.pop(0)
        raise StopAsyncIteration


class TestCompleteUserChatSessions:
    """Integration tests for complete user chat sessions."""
    
    @pytest.mark.asyncio
    async def test_simple_chat_session_flow(self, chat_system_components):
        """Test a simple chat session from connection to response."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        agent = components["agent"]
        
        # Mock agent response
        agent.process_message.return_value = "Hello! I can help you with GitHub repositories. What would you like to do?"
        
        # Create mock WebSocket
        mock_websocket = MockWebSocket()
        
        # Add messages to be received
        mock_websocket.add_received_message({
            "type": "session_init",
            "user_id": "test-user-123"
        })
        
        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "Hello, can you help me list my repositories?",
            "session_id": None  # Will be set after session init
        })
        
        # Start WebSocket handler in background
        handler_task = asyncio.create_task(
            websocket_handler.handle_connection(mock_websocket, "/chat")
        )
        
        # Wait a bit for processing
        await asyncio.sleep(0.2)
        
        # Check that session was initialized
        sent_messages = mock_websocket.sent_messages
        assert len(sent_messages) >= 1
        
        # Find session initialization response
        session_init_response = None
        for msg in sent_messages:
            if msg.get("type") == "session_initialized":
                session_init_response = msg
                break
        
        assert session_init_response is not None
        session_id = session_init_response["session_id"]
        
        # Update the chat message with the session ID
        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "Hello, can you help me list my repositories?",
            "session_id": session_id
        })
        
        # Wait for message processing
        await asyncio.sleep(0.3)
        
        # Verify agent was called
        agent.process_message.assert_called_once()
        call_args = agent.process_message.call_args
        assert "repositories" in call_args[0][0].lower()
        assert call_args[0][1] == session_id
        
        # Check for chat response
        chat_response = None
        for msg in mock_websocket.sent_messages:
            if msg.get("type") == "chat_response":
                chat_response = msg
                break
        
        assert chat_response is not None
        assert "Hello!" in chat_response["content"]
        assert chat_response["session_id"] == session_id
        
        # Close WebSocket
        await mock_websocket.close()
        
        # Wait for handler to finish
        try:
            await asyncio.wait_for(handler_task, timeout=1.0)
        except asyncio.TimeoutError:
            handler_task.cancel()
    
    @pytest.mark.asyncio
    async def test_chat_session_with_tool_execution(self, chat_system_components):
        """Test chat session that involves tool execution."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        agent = components["agent"]
        
        # Mock agent response that indicates tool usage
        agent.process_message.return_value = "I found 3 repositories in your GitHub account: repo1, repo2, and repo3."
        
        # Create mock WebSocket
        mock_websocket = MockWebSocket()
        
        # Initialize session
        mock_websocket.add_received_message({
            "type": "session_init",
            "user_id": "test-user-456"
        })
        
        # Start handler
        handler_task = asyncio.create_task(
            websocket_handler.handle_connection(mock_websocket, "/chat")
        )
        
        await asyncio.sleep(0.1)
        
        # Get session ID
        session_init_msg = next(
            msg for msg in mock_websocket.sent_messages 
            if msg.get("type") == "session_initialized"
        )
        session_id = session_init_msg["session_id"]
        
        # Send chat message requesting tool usage
        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "Please list all my GitHub repositories",
            "session_id": session_id
        })
        
        # Wait for processing
        await asyncio.sleep(0.3)
        
        # Verify typing indicators were sent
        typing_messages = [
            msg for msg in mock_websocket.sent_messages
            if msg.get("type") in ["typing_start", "typing_stop"]
        ]
        assert len(typing_messages) >= 2  # Should have start and stop
        
        # Verify agent was called with correct message
        agent.process_message.assert_called_once()
        call_args = agent.process_message.call_args
        assert "repositories" in call_args[0][0].lower()
        
        # Verify response was sent
        chat_response = next(
            msg for msg in mock_websocket.sent_messages
            if msg.get("type") == "chat_response"
        )
        assert "repositories" in chat_response["content"].lower()
        assert "repo1" in chat_response["content"]
        
        await mock_websocket.close()
        handler_task.cancel()
    
    @pytest.mark.asyncio
    async def test_chat_session_error_handling(self, chat_system_components):
        """Test error handling in chat sessions."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        agent = components["agent"]
        
        # Mock agent to raise an exception
        agent.process_message.side_effect = Exception("Simulated agent error")
        
        # Create mock WebSocket
        mock_websocket = MockWebSocket()
        
        # Initialize session
        mock_websocket.add_received_message({
            "type": "session_init"
        })
        
        # Start handler
        handler_task = asyncio.create_task(
            websocket_handler.handle_connection(mock_websocket, "/chat")
        )
        
        await asyncio.sleep(0.1)
        
        # Get session ID
        session_init_msg = next(
            msg for msg in mock_websocket.sent_messages 
            if msg.get("type") == "session_initialized"
        )
        session_id = session_init_msg["session_id"]
        
        # Send message that will cause error
        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "This will cause an error",
            "session_id": session_id
        })
        
        # Wait for processing
        await asyncio.sleep(0.3)
        
        # Verify error response was sent
        error_response = None
        for msg in mock_websocket.sent_messages:
            if msg.get("type") == "error_response":
                error_response = msg
                break
        
        assert error_response is not None
        assert "error" in error_response["message"].lower()
        
        await mock_websocket.close()
        handler_task.cancel()
    
    @pytest.mark.asyncio
    async def test_session_timeout_handling(self, chat_system_components):
        """Test handling of session timeouts."""
        components = chat_system_components
        session_manager = components["session_manager"]
        websocket_handler = components["websocket_handler"]
        
        # Create a session
        session = ChatSession.create_new_session("test-user")
        await session_manager.create_session(session)
        
        # Manually set last activity to past timeout
        session.last_activity = datetime.now(timezone.utc) - timedelta(minutes=35)
        await session_manager.update_session(session)
        
        # Create mock WebSocket
        mock_websocket = MockWebSocket()
        
        # Try to send message to expired session
        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "This should fail due to timeout",
            "session_id": session.session_id
        })
        
        # Start handler
        handler_task = asyncio.create_task(
            websocket_handler.handle_connection(mock_websocket, "/chat")
        )
        
        await asyncio.sleep(0.2)
        
        # Verify error response for expired session
        error_response = None
        for msg in mock_websocket.sent_messages:
            if msg.get("type") == "error_response":
                error_response = msg
                break
        
        assert error_response is not None
        assert "expired" in error_response["message"].lower()
        
        await mock_websocket.close()
        handler_task.cancel()


class TestAuthorizationFlowIntegration:
    """Integration tests for authorization flow within chat context."""
    
    @pytest.mark.asyncio
    async def test_auth_challenge_in_chat_flow(self, chat_system_components):
        """Test handling of authentication challenges during chat."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        message_processor = components["message_processor"]
        agent = components["agent"]
        
        # Mock agent to simulate auth challenge
        async def mock_process_message(message, session_id):
            # Simulate requesting user authorization
            auth_url = "https://github.com/login/oauth/authorize?client_id=test&scope=repo&state=test-state"
            await message_processor.request_user_authorization(session_id, auth_url, "repo")
            return "I need authorization to access your GitHub repositories. Please authorize the application."
        
        agent.process_message.side_effect = mock_process_message
        
        # Create mock WebSocket
        mock_websocket = MockWebSocket()
        
        # Initialize session
        mock_websocket.add_received_message({
            "type": "session_init",
            "user_id": "auth-test-user"
        })
        
        # Start handler
        handler_task = asyncio.create_task(
            websocket_handler.handle_connection(mock_websocket, "/chat")
        )
        
        await asyncio.sleep(0.1)
        
        # Get session ID
        session_init_msg = next(
            msg for msg in mock_websocket.sent_messages 
            if msg.get("type") == "session_initialized"
        )
        session_id = session_init_msg["session_id"]
        
        # Send message that triggers auth challenge
        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "Create an issue in my repository",
            "session_id": session_id
        })
        
        # Wait for processing
        await asyncio.sleep(0.3)
        
        # Verify auth request was sent
        auth_request = None
        for msg in mock_websocket.sent_messages:
            if msg.get("type") == "auth_request":
                auth_request = msg
                break
        
        assert auth_request is not None
        assert "github.com" in auth_request["auth_url"]
        assert auth_request["session_id"] == session_id
        
        # Simulate user completing authorization
        state = auth_request["state"]
        mock_websocket.add_received_message({
            "type": "auth_response",
            "session_id": session_id,
            "auth_code": "user-auth-code-123",
            "state": state
        })
        
        # Wait for auth processing
        await asyncio.sleep(0.2)
        
        # Verify auth confirmation was sent
        auth_confirmed = None
        for msg in mock_websocket.sent_messages:
            if msg.get("type") == "auth_confirmed":
                auth_confirmed = msg
                break
        
        assert auth_confirmed is not None
        assert auth_confirmed["session_id"] == session_id
        
        await mock_websocket.close()
        handler_task.cancel()
    
    @pytest.mark.asyncio
    async def test_auth_flow_with_invalid_state(self, chat_system_components):
        """Test handling of invalid state in authorization flow."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        
        # Create mock WebSocket
        mock_websocket = MockWebSocket()
        
        # Initialize session
        mock_websocket.add_received_message({
            "type": "session_init"
        })
        
        # Start handler
        handler_task = asyncio.create_task(
            websocket_handler.handle_connection(mock_websocket, "/chat")
        )
        
        await asyncio.sleep(0.1)
        
        # Get session ID
        session_init_msg = next(
            msg for msg in mock_websocket.sent_messages 
            if msg.get("type") == "session_initialized"
        )
        session_id = session_init_msg["session_id"]
        
        # Send auth response with invalid state
        mock_websocket.add_received_message({
            "type": "auth_response",
            "session_id": session_id,
            "auth_code": "auth-code-123",
            "state": "invalid-state-parameter"
        })
        
        # Wait for processing
        await asyncio.sleep(0.2)
        
        # Verify error response was sent
        error_response = None
        for msg in mock_websocket.sent_messages:
            if msg.get("type") == "error_response":
                error_response = msg
                break
        
        assert error_response is not None
        assert "invalid" in error_response["message"].lower()
        
        await mock_websocket.close()
        handler_task.cancel()
    
    @pytest.mark.asyncio
    async def test_multiple_auth_requests_same_session(self, chat_system_components):
        """Test handling multiple authorization requests in the same session."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        message_processor = components["message_processor"]
        
        # Create mock WebSocket
        mock_websocket = MockWebSocket()
        
        # Initialize session
        mock_websocket.add_received_message({
            "type": "session_init"
        })
        
        # Start handler
        handler_task = asyncio.create_task(
            websocket_handler.handle_connection(mock_websocket, "/chat")
        )
        
        await asyncio.sleep(0.1)
        
        # Get session ID
        session_init_msg = next(
            msg for msg in mock_websocket.sent_messages 
            if msg.get("type") == "session_initialized"
        )
        session_id = session_init_msg["session_id"]
        
        # Request multiple authorizations
        auth_url1 = "https://github.com/login/oauth/authorize?client_id=test&scope=repo"
        auth_url2 = "https://slack.com/oauth/authorize?client_id=test&scope=channels:read"
        
        state1 = await message_processor.request_user_authorization(session_id, auth_url1, "repo")
        state2 = await message_processor.request_user_authorization(session_id, auth_url2, "channels:read")
        
        # Wait for processing
        await asyncio.sleep(0.2)
        
        # Verify both auth requests were sent
        auth_requests = [
            msg for msg in mock_websocket.sent_messages
            if msg.get("type") == "auth_request"
        ]
        assert len(auth_requests) == 2
        
        # Verify states are different
        states = [req["state"] for req in auth_requests]
        assert len(set(states)) == 2  # All states should be unique
        assert state1 in states
        assert state2 in states
        
        await mock_websocket.close()
        handler_task.cancel()


class TestConcurrentUserSessions:
    """Performance tests for concurrent user sessions."""
    
    @pytest.mark.asyncio
    async def test_multiple_concurrent_sessions(self, chat_system_components):
        """Test handling multiple concurrent chat sessions."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        agent = components["agent"]
        
        # Mock agent responses
        agent.process_message.return_value = "Response from agent"
        
        # Create multiple mock WebSockets
        num_sessions = 5
        mock_websockets = []
        handler_tasks = []
        
        for i in range(num_sessions):
            mock_websocket = MockWebSocket()
            mock_websockets.append(mock_websocket)
            
            # Initialize session
            mock_websocket.add_received_message({
                "type": "session_init",
                "user_id": f"concurrent-user-{i}"
            })
            
            # Start handler
            task = asyncio.create_task(
                websocket_handler.handle_connection(mock_websocket, f"/chat/{i}")
            )
            handler_tasks.append(task)
        
        # Wait for all sessions to initialize
        await asyncio.sleep(0.2)
        
        # Get session IDs
        session_ids = []
        for mock_websocket in mock_websockets:
            session_init_msg = next(
                msg for msg in mock_websocket.sent_messages 
                if msg.get("type") == "session_initialized"
            )
            session_ids.append(session_init_msg["session_id"])
        
        # Send messages to all sessions concurrently
        for i, (mock_websocket, session_id) in enumerate(zip(mock_websockets, session_ids)):
            mock_websocket.add_received_message({
                "type": "chat_message",
                "content": f"Message from user {i}",
                "session_id": session_id
            })
        
        # Wait for all messages to be processed
        await asyncio.sleep(0.5)
        
        # Verify all sessions received responses
        for mock_websocket in mock_websockets:
            chat_response = None
            for msg in mock_websocket.sent_messages:
                if msg.get("type") == "chat_response":
                    chat_response = msg
                    break
            assert chat_response is not None
            assert "Response from agent" in chat_response["content"]
        
        # Verify agent was called for each session
        assert agent.process_message.call_count == num_sessions
        
        # Cleanup
        for mock_websocket in mock_websockets:
            await mock_websocket.close()
        
        for task in handler_tasks:
            task.cancel()
    
    @pytest.mark.asyncio
    async def test_session_isolation(self, chat_system_components):
        """Test that sessions are properly isolated from each other."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        session_manager = components["session_manager"]
        agent = components["agent"]
        
        # Mock agent to return session-specific responses
        def mock_process_message(message, session_id):
            return f"Response for session {session_id}: {message}"
        
        agent.process_message.side_effect = mock_process_message
        
        # Create two sessions
        mock_websocket1 = MockWebSocket()
        mock_websocket2 = MockWebSocket()
        
        # Initialize sessions
        mock_websocket1.add_received_message({
            "type": "session_init",
            "user_id": "isolation-user-1"
        })
        mock_websocket2.add_received_message({
            "type": "session_init",
            "user_id": "isolation-user-2"
        })
        
        # Start handlers
        task1 = asyncio.create_task(
            websocket_handler.handle_connection(mock_websocket1, "/chat/1")
        )
        task2 = asyncio.create_task(
            websocket_handler.handle_connection(mock_websocket2, "/chat/2")
        )
        
        await asyncio.sleep(0.1)
        
        # Get session IDs
        session1_msg = next(
            msg for msg in mock_websocket1.sent_messages 
            if msg.get("type") == "session_initialized"
        )
        session2_msg = next(
            msg for msg in mock_websocket2.sent_messages 
            if msg.get("type") == "session_initialized"
        )
        
        session_id1 = session1_msg["session_id"]
        session_id2 = session2_msg["session_id"]
        
        # Verify sessions are different
        assert session_id1 != session_id2
        
        # Send different messages to each session
        mock_websocket1.add_received_message({
            "type": "chat_message",
            "content": "Message from session 1",
            "session_id": session_id1
        })
        mock_websocket2.add_received_message({
            "type": "chat_message",
            "content": "Message from session 2",
            "session_id": session_id2
        })
        
        await asyncio.sleep(0.3)
        
        # Verify each session got its own response
        response1 = next(
            msg for msg in mock_websocket1.sent_messages 
            if msg.get("type") == "chat_response"
        )
        response2 = next(
            msg for msg in mock_websocket2.sent_messages 
            if msg.get("type") == "chat_response"
        )
        
        assert session_id1 in response1["content"]
        assert "session 1" in response1["content"]
        assert session_id2 in response2["content"]
        assert "session 2" in response2["content"]
        
        # Verify sessions are tracked separately
        active_sessions = websocket_handler.get_active_sessions()
        assert session_id1 in active_sessions
        assert session_id2 in active_sessions
        assert len(active_sessions) >= 2
        
        # Cleanup
        await mock_websocket1.close()
        await mock_websocket2.close()
        task1.cancel()
        task2.cancel()
    
    @pytest.mark.asyncio
    async def test_session_cleanup_on_disconnect(self, chat_system_components):
        """Test that sessions are properly cleaned up when clients disconnect."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        
        # Create mock WebSocket
        mock_websocket = MockWebSocket()
        
        # Initialize session
        mock_websocket.add_received_message({
            "type": "session_init",
            "user_id": "cleanup-test-user"
        })
        
        # Start handler
        handler_task = asyncio.create_task(
            websocket_handler.handle_connection(mock_websocket, "/chat")
        )
        
        await asyncio.sleep(0.1)
        
        # Get session ID
        session_init_msg = next(
            msg for msg in mock_websocket.sent_messages 
            if msg.get("type") == "session_initialized"
        )
        session_id = session_init_msg["session_id"]
        
        # Verify session is active
        active_sessions = websocket_handler.get_active_sessions()
        assert session_id in active_sessions
        
        # Close WebSocket to simulate disconnect
        await mock_websocket.close()
        
        # Wait for cleanup
        await asyncio.sleep(0.2)
        
        # Verify session was cleaned up
        active_sessions = websocket_handler.get_active_sessions()
        assert session_id not in active_sessions
        
        handler_task.cancel()
    
    @pytest.mark.asyncio
    async def test_performance_under_load(self, chat_system_components):
        """Test system performance under high message load."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        agent = components["agent"]
        
        # Mock fast agent response
        agent.process_message.return_value = "Quick response"
        
        # Create session
        mock_websocket = MockWebSocket()
        mock_websocket.add_received_message({
            "type": "session_init",
            "user_id": "load-test-user"
        })
        
        # Start handler
        handler_task = asyncio.create_task(
            websocket_handler.handle_connection(mock_websocket, "/chat")
        )
        
        await asyncio.sleep(0.1)
        
        # Get session ID
        session_init_msg = next(
            msg for msg in mock_websocket.sent_messages 
            if msg.get("type") == "session_initialized"
        )
        session_id = session_init_msg["session_id"]
        
        # Send many messages rapidly
        num_messages = 10
        start_time = datetime.now()
        
        for i in range(num_messages):
            mock_websocket.add_received_message({
                "type": "chat_message",
                "content": f"Load test message {i}",
                "session_id": session_id
            })
        
        # Wait for all messages to be processed
        await asyncio.sleep(1.0)
        
        end_time = datetime.now()
        processing_time = (end_time - start_time).total_seconds()
        
        # Verify all messages were processed
        chat_responses = [
            msg for msg in mock_websocket.sent_messages
            if msg.get("type") == "chat_response"
        ]
        
        assert len(chat_responses) == num_messages
        
        # Verify reasonable performance (should process messages quickly)
        assert processing_time < 2.0  # Should complete within 2 seconds
        
        # Verify agent was called for each message
        assert agent.process_message.call_count == num_messages
        
        await mock_websocket.close()
        handler_task.cancel()


class TestChatSystemResilience:
    """Tests for chat system resilience and error recovery."""
    
    @pytest.mark.asyncio
    async def test_recovery_from_agent_failure(self, chat_system_components):
        """Test system recovery when agent fails."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        agent = components["agent"]
        
        # Mock agent to fail initially, then recover
        call_count = 0
        def mock_process_message(message, session_id):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("Agent temporarily unavailable")
            return "Agent recovered and processed your message"
        
        agent.process_message.side_effect = mock_process_message
        
        # Create session
        mock_websocket = MockWebSocket()
        mock_websocket.add_received_message({
            "type": "session_init"
        })
        
        # Start handler
        handler_task = asyncio.create_task(
            websocket_handler.handle_connection(mock_websocket, "/chat")
        )
        
        await asyncio.sleep(0.1)
        
        # Get session ID
        session_init_msg = next(
            msg for msg in mock_websocket.sent_messages 
            if msg.get("type") == "session_initialized"
        )
        session_id = session_init_msg["session_id"]
        
        # Send message that will fail
        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "This will fail initially",
            "session_id": session_id
        })
        
        await asyncio.sleep(0.3)
        
        # Verify error response was sent
        error_response = next(
            msg for msg in mock_websocket.sent_messages
            if msg.get("type") == "error_response"
        )
        assert "error" in error_response["message"].lower()
        
        # Send another message that should succeed
        mock_websocket.add_received_message({
            "type": "chat_message",
            "content": "This should work now",
            "session_id": session_id
        })
        
        await asyncio.sleep(0.3)
        
        # Verify successful response
        chat_response = None
        for msg in reversed(mock_websocket.sent_messages):
            if msg.get("type") == "chat_response":
                chat_response = msg
                break
        
        assert chat_response is not None
        assert "recovered" in chat_response["content"]
        
        await mock_websocket.close()
        handler_task.cancel()
    
    @pytest.mark.asyncio
    async def test_graceful_shutdown(self, chat_system_components):
        """Test graceful shutdown of chat system components."""
        components = chat_system_components
        websocket_handler = components["websocket_handler"]
        message_processor = components["message_processor"]
        session_manager = components["session_manager"]
        
        # Create active sessions
        mock_websockets = []
        handler_tasks = []
        
        for i in range(3):
            mock_websocket = MockWebSocket()
            mock_websockets.append(mock_websocket)
            
            mock_websocket.add_received_message({
                "type": "session_init",
                "user_id": f"shutdown-user-{i}"
            })
            
            task = asyncio.create_task(
                websocket_handler.handle_connection(mock_websocket, f"/chat/{i}")
            )
            handler_tasks.append(task)
        
        await asyncio.sleep(0.2)
        
        # Verify sessions are active
        active_sessions = websocket_handler.get_active_sessions()
        assert len(active_sessions) >= 3
        
        # Initiate graceful shutdown
        await message_processor.stop()
        await websocket_handler.shutdown()
        await session_manager.shutdown()
        
        # Verify all connections were closed
        for mock_websocket in mock_websockets:
            assert mock_websocket.closed
        
        # Verify no active sessions remain
        active_sessions = websocket_handler.get_active_sessions()
        assert len(active_sessions) == 0
        
        # Cancel handler tasks
        for task in handler_tasks:
            if not task.done():
                task.cancel()