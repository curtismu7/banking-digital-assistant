"""
Unit tests for Conversation Memory.
"""
import pytest
import asyncio
from unittest.mock import Mock, AsyncMock, patch
from datetime import datetime, timedelta

from langchain_core.messages import HumanMessage, AIMessage

from src.agent.conversation_memory import ConversationMemory
from src.models.chat import ChatMessage, ChatSession


@pytest.fixture
def conversation_memory():
    """Create conversation memory for testing."""
    return ConversationMemory(
        max_messages_per_session=5,  # Small limit for testing
        session_timeout_hours=1,     # Short timeout for testing
        cleanup_interval_minutes=1   # Short interval for testing
    )


@pytest.fixture
def sample_chat_message():
    """Sample chat message for testing."""
    return ChatMessage(
        id="msg-123",
        session_id="session-123",
        content="Hello, how are you?",
        role="user",
        timestamp=datetime.now(),
        metadata={}
    )


@pytest.fixture
def sample_chat_session():
    """Sample chat session for testing."""
    return ChatSession(
        session_id="session-123",
        user_id="user-456",
        created_at=datetime.now(),
        last_activity=datetime.now(),
        context={"key": "value"}
    )


class TestConversationMemory:
    """Test cases for ConversationMemory."""
    
    def test_initialization(self):
        """Test conversation memory initialization."""
        memory = ConversationMemory(
            max_messages_per_session=100,
            session_timeout_hours=24,
            cleanup_interval_minutes=60
        )
        
        assert memory.max_messages_per_session == 100
        assert memory.session_timeout == timedelta(hours=24)
        assert memory.cleanup_interval == timedelta(minutes=60)
        assert memory._sessions == {}
        assert memory._messages == {}
        assert memory._langchain_memories == {}
        assert memory._cleanup_task is None
    
    @pytest.mark.asyncio
    async def test_start_stop_cleanup_task(self, conversation_memory):
        """Test starting and stopping cleanup task."""
        # Start cleanup task
        await conversation_memory.start_cleanup_task()
        
        assert conversation_memory._cleanup_task is not None
        assert not conversation_memory._cleanup_task.done()
        
        # Stop cleanup task
        await conversation_memory.stop_cleanup_task()
        
        assert conversation_memory._cleanup_task.done()
    
    @pytest.mark.asyncio
    async def test_get_or_create_session_new(self, conversation_memory):
        """Test creating a new session."""
        session_id = "new-session-123"
        user_id = "user-456"
        
        session = await conversation_memory.get_or_create_session(session_id, user_id)
        
        assert session.session_id == session_id
        assert session.user_id == user_id
        assert session.created_at is not None
        assert session.last_activity is not None
        assert session.context == {}
        
        # Check that session is stored
        assert session_id in conversation_memory._sessions
        assert session_id in conversation_memory._langchain_memories
    
    @pytest.mark.asyncio
    async def test_get_or_create_session_existing(self, conversation_memory, sample_chat_session):
        """Test getting an existing session."""
        session_id = sample_chat_session.session_id
        
        # Store existing session
        conversation_memory._sessions[session_id] = sample_chat_session
        original_activity = sample_chat_session.last_activity
        
        # Wait a bit to ensure time difference
        await asyncio.sleep(0.01)
        
        session = await conversation_memory.get_or_create_session(session_id)
        
        assert session == sample_chat_session
        assert session.last_activity > original_activity  # Should be updated
    
    @pytest.mark.asyncio
    async def test_add_message(self, conversation_memory, sample_chat_message):
        """Test adding a message to conversation."""
        await conversation_memory.add_message(
            session_id=sample_chat_message.session_id,
            message=sample_chat_message
        )
        
        # Check message is stored
        messages = conversation_memory._messages[sample_chat_message.session_id]
        assert len(messages) == 1
        assert messages[0] == sample_chat_message
        
        # Check LangChain memory
        langchain_memory = conversation_memory._langchain_memories[sample_chat_message.session_id]
        langchain_messages = langchain_memory.chat_memory.messages
        assert len(langchain_messages) == 1
        assert isinstance(langchain_messages[0], HumanMessage)
        assert langchain_messages[0].content == sample_chat_message.content
    
    @pytest.mark.asyncio
    async def test_add_assistant_message(self, conversation_memory):
        """Test adding an assistant message."""
        session_id = "session-123"
        message = ChatMessage(
            id="msg-456",
            session_id=session_id,
            content="I'm doing well, thank you!",
            role="assistant",
            timestamp=datetime.now(),
            metadata={}
        )
        
        await conversation_memory.add_message(session_id, message)
        
        # Check LangChain memory has AIMessage
        langchain_memory = conversation_memory._langchain_memories[session_id]
        langchain_messages = langchain_memory.chat_memory.messages
        assert len(langchain_messages) == 1
        assert isinstance(langchain_messages[0], AIMessage)
        assert langchain_messages[0].content == message.content
    
    @pytest.mark.asyncio
    async def test_add_message_with_trimming(self, conversation_memory):
        """Test adding messages with automatic trimming."""
        session_id = "session-123"
        
        # Add more messages than the limit
        for i in range(7):  # Limit is 5
            message = ChatMessage(
                id=f"msg-{i}",
                session_id=session_id,
                content=f"Message {i}",
                role="user",
                timestamp=datetime.now(),
                metadata={}
            )
            await conversation_memory.add_message(session_id, message)
        
        # Check that only the last 5 messages are kept
        messages = conversation_memory._messages[session_id]
        assert len(messages) == 5
        assert messages[0].content == "Message 2"  # First kept message
        assert messages[-1].content == "Message 6"  # Last message
        
        # Check LangChain memory is also trimmed
        langchain_memory = conversation_memory._langchain_memories[session_id]
        langchain_messages = langchain_memory.chat_memory.messages
        assert len(langchain_messages) == 5
    
    @pytest.mark.asyncio
    async def test_get_conversation_history(self, conversation_memory):
        """Test getting conversation history."""
        session_id = "session-123"
        
        # Add some messages
        messages = [
            ChatMessage(id="1", session_id=session_id, content="Hello", role="user", timestamp=datetime.now(), metadata={}),
            ChatMessage(id="2", session_id=session_id, content="Hi there!", role="assistant", timestamp=datetime.now(), metadata={}),
            ChatMessage(id="3", session_id=session_id, content="How are you?", role="user", timestamp=datetime.now(), metadata={})
        ]
        
        for message in messages:
            await conversation_memory.add_message(session_id, message)
        
        # Get history
        history = await conversation_memory.get_conversation_history(session_id)
        
        assert len(history) == 3
        assert isinstance(history[0], HumanMessage)
        assert isinstance(history[1], AIMessage)
        assert isinstance(history[2], HumanMessage)
        assert history[0].content == "Hello"
        assert history[1].content == "Hi there!"
        assert history[2].content == "How are you?"
    
    @pytest.mark.asyncio
    async def test_get_conversation_history_with_limit(self, conversation_memory):
        """Test getting conversation history with limit."""
        session_id = "session-123"
        
        # Add some messages
        for i in range(5):
            message = ChatMessage(
                id=f"msg-{i}",
                session_id=session_id,
                content=f"Message {i}",
                role="user",
                timestamp=datetime.now(),
                metadata={}
            )
            await conversation_memory.add_message(session_id, message)
        
        # Get limited history
        history = await conversation_memory.get_conversation_history(session_id, limit=2)
        
        assert len(history) == 2
        assert history[0].content == "Message 3"  # Last 2 messages
        assert history[1].content == "Message 4"
    
    @pytest.mark.asyncio
    async def test_get_conversation_history_nonexistent_session(self, conversation_memory):
        """Test getting history for nonexistent session."""
        history = await conversation_memory.get_conversation_history("nonexistent")
        assert history == []
    
    @pytest.mark.asyncio
    async def test_get_raw_messages(self, conversation_memory, sample_chat_message):
        """Test getting raw chat messages."""
        await conversation_memory.add_message(
            session_id=sample_chat_message.session_id,
            message=sample_chat_message
        )
        
        messages = await conversation_memory.get_raw_messages(sample_chat_message.session_id)
        
        assert len(messages) == 1
        assert messages[0] == sample_chat_message
    
    @pytest.mark.asyncio
    async def test_get_raw_messages_with_limit(self, conversation_memory):
        """Test getting raw messages with limit."""
        session_id = "session-123"
        
        # Add some messages
        for i in range(5):
            message = ChatMessage(
                id=f"msg-{i}",
                session_id=session_id,
                content=f"Message {i}",
                role="user",
                timestamp=datetime.now(),
                metadata={}
            )
            await conversation_memory.add_message(session_id, message)
        
        # Get limited messages
        messages = await conversation_memory.get_raw_messages(session_id, limit=2)
        
        assert len(messages) == 2
        assert messages[0].content == "Message 3"  # Last 2 messages
        assert messages[1].content == "Message 4"
    
    @pytest.mark.asyncio
    async def test_update_session_context(self, conversation_memory):
        """Test updating session context."""
        session_id = "session-123"
        
        # Create session
        await conversation_memory.get_or_create_session(session_id)
        
        # Update context
        context_updates = {"key1": "value1", "key2": "value2"}
        await conversation_memory.update_session_context(session_id, context_updates)
        
        # Check context is updated
        session = conversation_memory._sessions[session_id]
        assert session.context["key1"] == "value1"
        assert session.context["key2"] == "value2"
    
    @pytest.mark.asyncio
    async def test_get_session_context(self, conversation_memory):
        """Test getting session context."""
        session_id = "session-123"
        
        # Create session with context
        await conversation_memory.get_or_create_session(session_id)
        await conversation_memory.update_session_context(session_id, {"key": "value"})
        
        context = await conversation_memory.get_session_context(session_id)
        
        assert context == {"key": "value"}
    
    @pytest.mark.asyncio
    async def test_get_session_context_nonexistent(self, conversation_memory):
        """Test getting context for nonexistent session."""
        context = await conversation_memory.get_session_context("nonexistent")
        assert context == {}
    
    @pytest.mark.asyncio
    async def test_clear_session(self, conversation_memory, sample_chat_message):
        """Test clearing a session."""
        session_id = sample_chat_message.session_id
        
        # Add session and message
        await conversation_memory.add_message(session_id, sample_chat_message)
        
        # Verify session exists
        assert session_id in conversation_memory._sessions
        assert session_id in conversation_memory._messages
        assert session_id in conversation_memory._langchain_memories
        
        # Clear session
        await conversation_memory.clear_session(session_id)
        
        # Verify session is cleared
        assert session_id not in conversation_memory._sessions
        assert session_id not in conversation_memory._messages
        assert session_id not in conversation_memory._langchain_memories
    
    @pytest.mark.asyncio
    async def test_get_active_sessions(self, conversation_memory):
        """Test getting active sessions."""
        # Create sessions with different activity times
        now = datetime.now()
        
        # Active session
        active_session = ChatSession(
            session_id="active-session",
            user_id=None,
            created_at=now,
            last_activity=now,
            context={}
        )
        conversation_memory._sessions["active-session"] = active_session
        
        # Expired session
        expired_session = ChatSession(
            session_id="expired-session",
            user_id=None,
            created_at=now - timedelta(hours=2),
            last_activity=now - timedelta(hours=2),
            context={}
        )
        conversation_memory._sessions["expired-session"] = expired_session
        
        active_sessions = await conversation_memory.get_active_sessions()
        
        assert "active-session" in active_sessions
        assert "expired-session" not in active_sessions
    
    @pytest.mark.asyncio
    async def test_get_active_sessions_count(self, conversation_memory):
        """Test getting active sessions count."""
        # Create an active session
        await conversation_memory.get_or_create_session("active-session")
        
        count = await conversation_memory.get_active_sessions_count()
        assert count == 1
    
    @pytest.mark.asyncio
    async def test_get_session_stats(self, conversation_memory):
        """Test getting session statistics."""
        session_id = "session-123"
        
        # Create session and add messages
        await conversation_memory.get_or_create_session(session_id)
        
        user_message = ChatMessage(id="1", session_id=session_id, content="Hello", role="user", timestamp=datetime.now(), metadata={})
        assistant_message = ChatMessage(id="2", session_id=session_id, content="Hi", role="assistant", timestamp=datetime.now(), metadata={})
        
        await conversation_memory.add_message(session_id, user_message)
        await conversation_memory.add_message(session_id, assistant_message)
        await conversation_memory.update_session_context(session_id, {"key": "value"})
        
        stats = await conversation_memory.get_session_stats(session_id)
        
        assert stats["exists"] is True
        assert stats["total_messages"] == 2
        assert stats["user_messages"] == 1
        assert stats["assistant_messages"] == 1
        assert stats["context_keys"] == ["key"]
        assert stats["is_active"] is True
    
    @pytest.mark.asyncio
    async def test_get_session_stats_nonexistent(self, conversation_memory):
        """Test getting stats for nonexistent session."""
        stats = await conversation_memory.get_session_stats("nonexistent")
        assert stats == {"exists": False}
    
    @pytest.mark.asyncio
    async def test_cleanup_expired_sessions(self, conversation_memory):
        """Test cleanup of expired sessions."""
        now = datetime.now()
        
        # Create expired session
        expired_session = ChatSession(
            session_id="expired-session",
            user_id=None,
            created_at=now - timedelta(hours=2),
            last_activity=now - timedelta(hours=2),
            context={}
        )
        conversation_memory._sessions["expired-session"] = expired_session
        
        # Create active session
        active_session = ChatSession(
            session_id="active-session",
            user_id=None,
            created_at=now,
            last_activity=now,
            context={}
        )
        conversation_memory._sessions["active-session"] = active_session
        
        # Run cleanup
        await conversation_memory._cleanup_expired_sessions()
        
        # Check that expired session is removed
        assert "expired-session" not in conversation_memory._sessions
        assert "active-session" in conversation_memory._sessions
    
    @pytest.mark.asyncio
    async def test_get_memory_stats(self, conversation_memory):
        """Test getting memory statistics."""
        # Create session and add messages
        session_id = "session-123"
        await conversation_memory.get_or_create_session(session_id)
        
        message = ChatMessage(id="1", session_id=session_id, content="Hello", role="user", timestamp=datetime.now(), metadata={})
        await conversation_memory.add_message(session_id, message)
        
        stats = await conversation_memory.get_memory_stats()
        
        assert stats["total_sessions"] == 1
        assert stats["active_sessions"] == 1
        assert stats["total_messages"] == 1
        assert stats["max_messages_per_session"] == 5
        assert stats["session_timeout_hours"] == 1
        assert stats["cleanup_running"] is False
    
    @pytest.mark.asyncio
    async def test_cleanup(self, conversation_memory):
        """Test cleanup of conversation memory."""
        # Create session and add data
        session_id = "session-123"
        await conversation_memory.get_or_create_session(session_id)
        
        message = ChatMessage(id="1", session_id=session_id, content="Hello", role="user", timestamp=datetime.now(), metadata={})
        await conversation_memory.add_message(session_id, message)
        
        # Start cleanup task
        await conversation_memory.start_cleanup_task()
        
        # Run cleanup
        await conversation_memory.cleanup()
        
        # Check that all data is cleared
        assert conversation_memory._sessions == {}
        assert conversation_memory._messages == {}
        assert conversation_memory._langchain_memories == {}
        assert conversation_memory._cleanup_task.done()


if __name__ == "__main__":
    pytest.main([__file__])