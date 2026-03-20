"""
Conversation memory management for LangChain MCP Agent.
"""
import asyncio
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta
from collections import defaultdict

from langchain_core.messages import BaseMessage, HumanMessage, AIMessage
from langchain.memory import ConversationBufferMemory

from models.chat import ChatMessage, ChatSession


logger = logging.getLogger(__name__)


class ConversationMemory:
    """
    Manages conversation memory and context for chat sessions.
    
    This class handles:
    - Chat history storage and retrieval
    - Context preservation across tool executions
    - Session management and cleanup
    - Memory optimization for long conversations
    """
    
    def __init__(self, 
                 max_messages_per_session: int = 100,
                 session_timeout_hours: int = 24,
                 cleanup_interval_minutes: int = 60):
        """
        Initialize conversation memory.
        
        Args:
            max_messages_per_session: Maximum messages to keep per session
            session_timeout_hours: Hours after which inactive sessions expire
            cleanup_interval_minutes: Minutes between cleanup runs
        """
        self.max_messages_per_session = max_messages_per_session
        self.session_timeout = timedelta(hours=session_timeout_hours)
        self.cleanup_interval = timedelta(minutes=cleanup_interval_minutes)
        
        # In-memory storage (in production, this could be Redis or database)
        self._sessions: Dict[str, ChatSession] = {}
        self._messages: Dict[str, List[ChatMessage]] = defaultdict(list)
        self._langchain_memories: Dict[str, ConversationBufferMemory] = {}
        
        # Cleanup task
        self._cleanup_task: Optional[asyncio.Task] = None
        self._shutdown_event = asyncio.Event()
        
        logger.info(f"Initialized conversation memory with {max_messages_per_session} max messages per session")
    
    async def start_cleanup_task(self) -> None:
        """Start the background cleanup task."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
            logger.info("Started conversation memory cleanup task")
    
    async def stop_cleanup_task(self) -> None:
        """Stop the background cleanup task."""
        self._shutdown_event.set()
        if self._cleanup_task and not self._cleanup_task.done():
            try:
                await asyncio.wait_for(self._cleanup_task, timeout=5.0)
            except asyncio.TimeoutError:
                self._cleanup_task.cancel()
            logger.info("Stopped conversation memory cleanup task")
    
    async def _cleanup_loop(self) -> None:
        """Background cleanup loop for expired sessions."""
        while not self._shutdown_event.is_set():
            try:
                await self._cleanup_expired_sessions()
                await asyncio.wait_for(
                    self._shutdown_event.wait(), 
                    timeout=self.cleanup_interval.total_seconds()
                )
            except asyncio.TimeoutError:
                continue  # Normal timeout, continue cleanup loop
            except Exception as e:
                logger.error(f"Error in cleanup loop: {e}")
                await asyncio.sleep(60)  # Wait before retrying
    
    async def get_or_create_session(self, session_id: str, user_id: Optional[str] = None) -> ChatSession:
        """
        Get existing session or create a new one.
        
        Args:
            session_id: The session identifier
            user_id: Optional user identifier
            
        Returns:
            ChatSession: The session object
        """
        if session_id in self._sessions:
            # Update last activity
            session = self._sessions[session_id]
            session.last_activity = datetime.now()
            return session
        
        # Create new session
        session = ChatSession(
            session_id=session_id,
            user_id=user_id,
            created_at=datetime.now(),
            last_activity=datetime.now(),
            context={}
        )
        
        self._sessions[session_id] = session
        
        # Initialize LangChain memory for this session
        self._langchain_memories[session_id] = ConversationBufferMemory(
            memory_key="chat_history",
            return_messages=True
        )
        
        logger.info(f"Created new chat session: {session_id}")
        return session
    
    async def add_message(self, session_id: str, message: ChatMessage) -> None:
        """
        Add a message to the conversation history.
        
        Args:
            session_id: The session identifier
            message: The chat message to add
        """
        # Ensure session exists
        await self.get_or_create_session(session_id)
        
        # Add message to history
        self._messages[session_id].append(message)
        
        # Add to LangChain memory
        if session_id in self._langchain_memories:
            langchain_memory = self._langchain_memories[session_id]
            
            if message.role == "user":
                langchain_message = HumanMessage(content=message.content)
            elif message.role == "assistant":
                langchain_message = AIMessage(content=message.content)
            else:
                # For other roles, use HumanMessage as fallback
                langchain_message = HumanMessage(content=f"[{message.role}] {message.content}")
            
            # Add to memory
            langchain_memory.chat_memory.add_message(langchain_message)
        
        # Trim messages if we exceed the limit
        await self._trim_session_messages(session_id)
        
        logger.debug(f"Added message to session {session_id}: {message.role}")
    
    async def get_conversation_history(self, session_id: str, limit: Optional[int] = None) -> List[BaseMessage]:
        """
        Get conversation history as LangChain messages.
        
        Args:
            session_id: The session identifier
            limit: Optional limit on number of messages to return
            
        Returns:
            List of LangChain BaseMessage objects
        """
        if session_id not in self._langchain_memories:
            return []
        
        langchain_memory = self._langchain_memories[session_id]
        messages = langchain_memory.chat_memory.messages
        
        if limit:
            messages = messages[-limit:]
        
        return messages
    
    async def get_raw_messages(self, session_id: str, limit: Optional[int] = None) -> List[ChatMessage]:
        """
        Get raw chat messages for a session.
        
        Args:
            session_id: The session identifier
            limit: Optional limit on number of messages to return
            
        Returns:
            List of ChatMessage objects
        """
        messages = self._messages.get(session_id, [])
        
        if limit:
            messages = messages[-limit:]
        
        return messages
    
    async def update_session_context(self, session_id: str, context_updates: Dict[str, Any]) -> None:
        """
        Update session context information.
        
        Args:
            session_id: The session identifier
            context_updates: Dictionary of context updates
        """
        session = await self.get_or_create_session(session_id)
        session.context.update(context_updates)
        session.last_activity = datetime.now()
        
        logger.debug(f"Updated context for session {session_id}: {list(context_updates.keys())}")
    
    async def get_session_context(self, session_id: str) -> Dict[str, Any]:
        """
        Get session context information.
        
        Args:
            session_id: The session identifier
            
        Returns:
            Dictionary of session context
        """
        if session_id in self._sessions:
            return self._sessions[session_id].context.copy()
        return {}
    
    async def is_user_identified(self, session_id: str) -> bool:
        """
        Check if the user has been identified in this session.
        
        Args:
            session_id: The session identifier
            
        Returns:
            True if user is identified, False otherwise
        """
        context = await self.get_session_context(session_id)
        return context.get("user_identified", False)
    
    async def set_user_identified(self, session_id: str, user_email: str, user_id: str) -> None:
        """
        Mark the user as identified in this session.
        
        Args:
            session_id: The session identifier
            user_email: The user's email address
            user_id: The user's unique identifier
        """
        await self.update_session_context(session_id, {
            "user_identified": True,
            "user_email": user_email,
            "user_id": user_id,
            "identification_timestamp": datetime.now().isoformat()
        })
        logger.info(f"User identified in session {session_id}: {user_email}")
    
    async def get_identified_user(self, session_id: str) -> Optional[Dict[str, str]]:
        """
        Get identified user information for this session.
        
        Args:
            session_id: The session identifier
            
        Returns:
            Dictionary with user info if identified, None otherwise
        """
        context = await self.get_session_context(session_id)
        if context.get("user_identified", False):
            return {
                "user_email": context.get("user_email"),
                "user_id": context.get("user_id"),
                "identification_timestamp": context.get("identification_timestamp")
            }
        return None
    
    async def clear_session(self, session_id: str) -> None:
        """
        Clear all data for a specific session.
        
        Args:
            session_id: The session identifier to clear
        """
        # Remove from all storage
        if session_id in self._sessions:
            del self._sessions[session_id]
        
        if session_id in self._messages:
            del self._messages[session_id]
        
        if session_id in self._langchain_memories:
            del self._langchain_memories[session_id]
        
        logger.info(f"Cleared session data: {session_id}")
    
    async def get_active_sessions(self) -> List[str]:
        """
        Get list of active session IDs.
        
        Returns:
            List of active session IDs
        """
        now = datetime.now()
        active_sessions = []
        
        for session_id, session in self._sessions.items():
            if now - session.last_activity < self.session_timeout:
                active_sessions.append(session_id)
        
        return active_sessions
    
    async def get_active_sessions_count(self) -> int:
        """
        Get count of active sessions.
        
        Returns:
            Number of active sessions
        """
        active_sessions = await self.get_active_sessions()
        return len(active_sessions)
    
    async def get_session_stats(self, session_id: str) -> Dict[str, Any]:
        """
        Get statistics for a specific session.
        
        Args:
            session_id: The session identifier
            
        Returns:
            Dictionary of session statistics
        """
        if session_id not in self._sessions:
            return {"exists": False}
        
        session = self._sessions[session_id]
        messages = self._messages.get(session_id, [])
        
        user_messages = [msg for msg in messages if msg.role == "user"]
        assistant_messages = [msg for msg in messages if msg.role == "assistant"]
        
        return {
            "exists": True,
            "created_at": session.created_at,
            "last_activity": session.last_activity,
            "total_messages": len(messages),
            "user_messages": len(user_messages),
            "assistant_messages": len(assistant_messages),
            "context_keys": list(session.context.keys()),
            "is_active": datetime.now() - session.last_activity < self.session_timeout
        }
    
    async def _trim_session_messages(self, session_id: str) -> None:
        """
        Trim messages for a session if it exceeds the limit.
        
        Args:
            session_id: The session identifier
        """
        messages = self._messages[session_id]
        
        if len(messages) > self.max_messages_per_session:
            # Keep the most recent messages
            messages_to_keep = messages[-self.max_messages_per_session:]
            self._messages[session_id] = messages_to_keep
            
            # Also trim LangChain memory
            if session_id in self._langchain_memories:
                langchain_memory = self._langchain_memories[session_id]
                langchain_messages = langchain_memory.chat_memory.messages
                
                if len(langchain_messages) > self.max_messages_per_session:
                    # Clear and rebuild with trimmed messages
                    langchain_memory.chat_memory.clear()
                    
                    # Add back the kept messages
                    for message in messages_to_keep:
                        if message.role == "user":
                            langchain_message = HumanMessage(content=message.content)
                        elif message.role == "assistant":
                            langchain_message = AIMessage(content=message.content)
                        else:
                            langchain_message = HumanMessage(content=f"[{message.role}] {message.content}")
                        
                        langchain_memory.chat_memory.add_message(langchain_message)
            
            logger.info(f"Trimmed session {session_id} to {len(messages_to_keep)} messages")
    
    async def _cleanup_expired_sessions(self) -> None:
        """Clean up expired sessions."""
        now = datetime.now()
        expired_sessions = []
        
        for session_id, session in self._sessions.items():
            if now - session.last_activity > self.session_timeout:
                expired_sessions.append(session_id)
        
        for session_id in expired_sessions:
            await self.clear_session(session_id)
        
        if expired_sessions:
            logger.info(f"Cleaned up {len(expired_sessions)} expired sessions")
    
    async def get_memory_stats(self) -> Dict[str, Any]:
        """
        Get overall memory statistics.
        
        Returns:
            Dictionary of memory statistics
        """
        total_messages = sum(len(messages) for messages in self._messages.values())
        active_sessions = await self.get_active_sessions()
        
        return {
            "total_sessions": len(self._sessions),
            "active_sessions": len(active_sessions),
            "total_messages": total_messages,
            "max_messages_per_session": self.max_messages_per_session,
            "session_timeout_hours": self.session_timeout.total_seconds() / 3600,
            "cleanup_running": self._cleanup_task is not None and not self._cleanup_task.done()
        }
    
    async def cleanup(self) -> None:
        """Clean up resources and stop background tasks."""
        await self.stop_cleanup_task()
        
        # Clear all data
        self._sessions.clear()
        self._messages.clear()
        self._langchain_memories.clear()
        
        logger.info("Conversation memory cleanup complete")