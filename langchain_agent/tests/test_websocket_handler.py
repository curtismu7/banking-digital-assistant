"""
Unit tests for WebSocket handler.
"""
import asyncio
import json
import pytest
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timezone

from src.api.websocket_handler import ChatWebSocketHandler
from src.models.chat import ChatMessage, MessageRole
from src.config.settings import ChatConfig, AppConfig


class MockWebSocket:
    """Mock WebSocket for testing."""
    
    def __init__(self, messages=None):
        self.messages = messages or []
        self.sent_messages = []
        self.closed = False
        self.message_index = 0
    
    async def send(self, message):
        """Mock send method."""
        if self.closed:
            raise ConnectionClosed("Connection closed")
        self.sent_messages.append(message)
    
    async def close(self):
        """Mock close method."""
        self.closed = True
    
    def __aiter__(self):
        return self
    
    async def __anext__(self):
        if self.message_index >= len(self.messages):
            raise StopAsyncIteration
        message = self.messages[self.message_index]
        self.message_index += 1
        return message


class ConnectionClosed(Exception):
    """Mock ConnectionClosed exception."""
    pass


@pytest.fixture
def mock_config():
    """Create a mock configuration."""
    chat_config = ChatConfig(
        websocket_port=8080,
        max_message_length=1000,
        conversation_history_limit=100,
        session_cleanup_interval_minutes=15
    )
    
    config = Mock(spec=AppConfig)
    config.chat = chat_config
    return config


@pytest.fixture
def websocket_handler(mock_config):
    """Create a WebSocket handler for testing."""
    return ChatWebSocketHandler(config=mock_config)


@pytest.mark.asyncio
class TestChatWebSocketHandler:
    """Test cases for ChatWebSocketHandler."""
    
    async def test_initialization(self, websocket_handler):
        """Test WebSocket handler initialization."""
        assert websocket_handler._connections == {}
        assert websocket_handler._session_connections == {}
        assert websocket_handler._connection_metadata == {}
        assert len(websocket_handler._message_handlers) == 5
    
    async def test_handle_connection_success(self, websocket_handler):
        """Test successful connection handling."""
        mock_websocket = MockWebSocket([])
        
        # Mock the connection handling to avoid infinite loop
        with patch.object(websocket_handler, '_process_message') as mock_process:
            # Simulate connection close after setup
            mock_websocket.messages = []
            
            # Start connection handling
            task = asyncio.create_task(
                websocket_handler.handle_connection(mock_websocket, "/chat")
            )
            
            # Give it a moment to set up
            await asyncio.sleep(0.01)
            
            # Close the connection to end the loop
            mock_websocket.closed = True
            
            # Wait for completion
            await task
        
        # Check that connection acknowledgment was sent
        assert len(mock_websocket.sent_messages) == 1
        ack_message = json.loads(mock_websocket.sent_messages[0])
        assert ack_message["type"] == "connection_ack"
        assert "connection_id" in ack_message
        assert "timestamp" in ack_message
    
    async def test_process_message_invalid_json(self, websocket_handler):
        """Test processing invalid JSON message."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        
        await websocket_handler._process_message(connection_id, "invalid json")
        
        # Should send error message
        assert len(mock_websocket.sent_messages) == 1
        error_message = json.loads(mock_websocket.sent_messages[0])
        assert error_message["type"] == "error"
        assert error_message["error_code"] == "invalid_json"
    
    async def test_process_message_missing_type(self, websocket_handler):
        """Test processing message without type field."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        
        message = json.dumps({"content": "test message"})
        await websocket_handler._process_message(connection_id, message)
        
        # Should send error message
        assert len(mock_websocket.sent_messages) == 1
        error_message = json.loads(mock_websocket.sent_messages[0])
        assert error_message["type"] == "error"
        assert error_message["error_code"] == "invalid_message"
    
    async def test_process_message_unknown_type(self, websocket_handler):
        """Test processing message with unknown type."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        
        message = json.dumps({"type": "unknown_type", "content": "test"})
        await websocket_handler._process_message(connection_id, message)
        
        # Should send error message
        assert len(mock_websocket.sent_messages) == 1
        error_message = json.loads(mock_websocket.sent_messages[0])
        assert error_message["type"] == "error"
        assert error_message["error_code"] == "invalid_message"
    
    async def test_handle_chat_message_success(self, websocket_handler):
        """Test successful chat message handling."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": None,
            "user_id": None
        }
        
        # Mock the message processor notification
        with patch.object(websocket_handler, '_notify_message_processor') as mock_notify:
            message = {
                "type": "chat_message",
                "content": "Hello, world!",
                "session_id": session_id,
                "_connection_id": connection_id,
                "_timestamp": datetime.now(timezone.utc).isoformat()
            }
            
            await websocket_handler._handle_chat_message(message)
        
        # Should send acknowledgment
        assert len(mock_websocket.sent_messages) == 1
        ack_message = json.loads(mock_websocket.sent_messages[0])
        assert ack_message["type"] == "message_received"
        assert ack_message["session_id"] == session_id
        
        # Should update connection metadata
        assert websocket_handler._connection_metadata[connection_id]["session_id"] == session_id
        assert websocket_handler._session_connections[session_id] == connection_id
        
        # Should notify message processor
        mock_notify.assert_called_once()
    
    async def test_handle_chat_message_missing_content(self, websocket_handler):
        """Test chat message handling with missing content."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        
        message = {
            "type": "chat_message",
            "session_id": "test-session-1",
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        await websocket_handler._handle_chat_message(message)
        
        # Should send error message
        assert len(mock_websocket.sent_messages) == 1
        error_message = json.loads(mock_websocket.sent_messages[0])
        assert error_message["type"] == "error"
        assert error_message["error_code"] == "invalid_content"
    
    async def test_handle_chat_message_too_long(self, websocket_handler):
        """Test chat message handling with content too long."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        
        # Create message longer than max length
        long_content = "x" * (websocket_handler.config.chat.max_message_length + 1)
        
        message = {
            "type": "chat_message",
            "content": long_content,
            "session_id": "test-session-1",
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        await websocket_handler._handle_chat_message(message)
        
        # Should send error message
        assert len(mock_websocket.sent_messages) == 1
        error_message = json.loads(mock_websocket.sent_messages[0])
        assert error_message["type"] == "error"
        assert error_message["error_code"] == "message_too_long"
    
    async def test_handle_session_init(self, websocket_handler):
        """Test session initialization handling."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        user_id = "test-user-1"
        mock_websocket = MockWebSocket()
        
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": None,
            "user_id": None
        }
        
        message = {
            "type": "session_init",
            "session_id": session_id,
            "user_id": user_id,
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        await websocket_handler._handle_session_init(message)
        
        # Should send session initialized response
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "session_initialized"
        assert response["session_id"] == session_id
        assert response["user_id"] == user_id
        
        # Should update connection metadata
        assert websocket_handler._connection_metadata[connection_id]["session_id"] == session_id
        assert websocket_handler._connection_metadata[connection_id]["user_id"] == user_id
        assert websocket_handler._session_connections[session_id] == connection_id
    
    async def test_handle_session_init_generate_id(self, websocket_handler):
        """Test session initialization with generated session ID."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()
        
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": None,
            "user_id": None
        }
        
        message = {
            "type": "session_init",
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        await websocket_handler._handle_session_init(message)
        
        # Should send session initialized response with generated ID
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "session_initialized"
        assert "session_id" in response
        assert response["session_id"] is not None
    
    async def test_handle_session_close(self, websocket_handler):
        """Test session close handling."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": session_id,
            "user_id": None
        }
        websocket_handler._session_connections[session_id] = connection_id
        
        message = {
            "type": "session_close",
            "session_id": session_id,
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        await websocket_handler._handle_session_close(message)
        
        # Should send session closed response
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "session_closed"
        assert response["session_id"] == session_id
        
        # Should remove session mapping
        assert session_id not in websocket_handler._session_connections
        assert websocket_handler._connection_metadata[connection_id]["session_id"] is None
    
    async def test_handle_ping(self, websocket_handler):
        """Test ping message handling."""
        connection_id = "test-conn-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        
        message = {
            "type": "ping",
            "_connection_id": connection_id,
            "_timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        await websocket_handler._handle_ping(message)
        
        # Should send pong response
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "pong"
        assert "timestamp" in response
    
    async def test_handle_auth_response(self, websocket_handler):
        """Test authorization response handling."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        websocket_handler._connections[connection_id] = mock_websocket
        
        # Mock the auth response notification
        with patch.object(websocket_handler, '_notify_auth_response') as mock_notify:
            message = {
                "type": "auth_response",
                "session_id": session_id,
                "auth_code": "test-auth-code",
                "state": "test-state",
                "_connection_id": connection_id,
                "_timestamp": datetime.now(timezone.utc).isoformat()
            }
            
            await websocket_handler._handle_auth_response(message)
        
        # Should send acknowledgment
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "auth_received"
        assert response["session_id"] == session_id
        
        # Should notify about auth response
        mock_notify.assert_called_once_with(session_id, "test-auth-code", "test-state")
    
    async def test_send_message_to_session_success(self, websocket_handler):
        """Test sending message to session successfully."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._session_connections[session_id] = connection_id
        
        message = {"type": "test", "content": "test message"}
        result = await websocket_handler.send_message_to_session(session_id, message)
        
        assert result is True
        assert len(mock_websocket.sent_messages) == 1
        sent_message = json.loads(mock_websocket.sent_messages[0])
        assert sent_message == message
    
    async def test_send_message_to_session_no_connection(self, websocket_handler):
        """Test sending message to session with no active connection."""
        session_id = "test-session-1"
        message = {"type": "test", "content": "test message"}
        
        result = await websocket_handler.send_message_to_session(session_id, message)
        
        assert result is False
    
    async def test_send_chat_response(self, websocket_handler):
        """Test sending chat response to session."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._session_connections[session_id] = connection_id
        
        result = await websocket_handler.send_chat_response(
            session_id, "Hello, user!", {"tool": "test"}
        )
        
        assert result is True
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "chat_response"
        assert response["content"] == "Hello, user!"
        assert response["session_id"] == session_id
        assert response["metadata"]["tool"] == "test"
    
    async def test_send_auth_request(self, websocket_handler):
        """Test sending authorization request to session."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._session_connections[session_id] = connection_id
        
        result = await websocket_handler.send_auth_request(
            session_id, "https://auth.example.com", "test-state"
        )
        
        assert result is True
        assert len(mock_websocket.sent_messages) == 1
        response = json.loads(mock_websocket.sent_messages[0])
        assert response["type"] == "auth_request"
        assert response["auth_url"] == "https://auth.example.com"
        assert response["state"] == "test-state"
        assert response["session_id"] == session_id
    
    async def test_cleanup_connection(self, websocket_handler):
        """Test connection cleanup."""
        connection_id = "test-conn-1"
        session_id = "test-session-1"
        mock_websocket = MockWebSocket()
        
        # Set up connection data
        websocket_handler._connections[connection_id] = mock_websocket
        websocket_handler._connection_metadata[connection_id] = {
            "session_id": session_id,
            "user_id": "test-user"
        }
        websocket_handler._session_connections[session_id] = connection_id
        
        await websocket_handler._cleanup_connection(connection_id)
        
        # Should remove all connection data
        assert connection_id not in websocket_handler._connections
        assert connection_id not in websocket_handler._connection_metadata
        assert session_id not in websocket_handler._session_connections
    
    async def test_get_active_connections(self, websocket_handler):
        """Test getting active connections."""
        connection_id = "test-conn-1"
        metadata = {
            "connected_at": datetime.now(timezone.utc),
            "path": "/chat",
            "session_id": "test-session-1",
            "user_id": "test-user"
        }
        
        websocket_handler._connection_metadata[connection_id] = metadata
        
        active_connections = websocket_handler.get_active_connections()
        
        assert active_connections == {connection_id: metadata}
        # Should return a copy, not the original
        assert active_connections is not websocket_handler._connection_metadata
    
    async def test_get_active_sessions(self, websocket_handler):
        """Test getting active sessions."""
        session_id = "test-session-1"
        connection_id = "test-conn-1"
        
        websocket_handler._session_connections[session_id] = connection_id
        
        active_sessions = websocket_handler.get_active_sessions()
        
        assert active_sessions == {session_id: connection_id}
        # Should return a copy, not the original
        assert active_sessions is not websocket_handler._session_connections
    
    async def test_broadcast_to_all(self, websocket_handler):
        """Test broadcasting message to all connections."""
        # Set up multiple connections
        mock_websocket1 = MockWebSocket()
        mock_websocket2 = MockWebSocket()
        mock_websocket3 = MockWebSocket()
        
        websocket_handler._connections = {
            "conn-1": mock_websocket1,
            "conn-2": mock_websocket2,
            "conn-3": mock_websocket3
        }
        
        message = {"type": "broadcast", "content": "Hello everyone!"}
        sent_count = await websocket_handler.broadcast_to_all(message)
        
        assert sent_count == 3
        
        # Check all connections received the message
        for websocket in [mock_websocket1, mock_websocket2, mock_websocket3]:
            assert len(websocket.sent_messages) == 1
            sent_message = json.loads(websocket.sent_messages[0])
            assert sent_message == message
    
    async def test_shutdown(self, websocket_handler):
        """Test WebSocket handler shutdown."""
        # Set up connections and data
        mock_websocket1 = MockWebSocket()
        mock_websocket2 = MockWebSocket()
        
        websocket_handler._connections = {
            "conn-1": mock_websocket1,
            "conn-2": mock_websocket2
        }
        websocket_handler._session_connections = {"session-1": "conn-1"}
        websocket_handler._connection_metadata = {"conn-1": {"test": "data"}}
        
        await websocket_handler.shutdown()
        
        # Should close all connections
        assert mock_websocket1.closed
        assert mock_websocket2.closed
        
        # Should clear all data
        assert websocket_handler._connections == {}
        assert websocket_handler._session_connections == {}
        assert websocket_handler._connection_metadata == {}