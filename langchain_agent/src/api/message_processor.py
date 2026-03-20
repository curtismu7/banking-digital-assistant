"""
Message processor for coordinating between chat interface and agent.
"""
import asyncio
import logging
from typing import Dict, Any, Optional, Callable
from datetime import datetime, timezone
import uuid

from models.chat import ChatMessage, ChatSession
from models.auth import AuthorizationCode
from agent.langchain_mcp_agent import LangChainMCPAgent
from .session_manager import SessionManager
from .websocket_handler import ChatWebSocketHandler
from config.settings import get_config


logger = logging.getLogger(__name__)


class MessageProcessor:
    """
    Coordinates message processing between chat interface and LangChain agent.
    
    Handles message routing, authorization flow coordination, and response delivery
    for the chat interface backend.
    """
    
    def __init__(self, 
                 agent: LangChainMCPAgent,
                 session_manager: SessionManager,
                 websocket_handler: ChatWebSocketHandler,
                 config=None):
        """
        Initialize the message processor.
        
        Args:
            agent: The LangChain MCP agent
            session_manager: The session manager
            websocket_handler: The WebSocket handler
            config: Optional configuration object
        """
        self.config = config or get_config()
        self.agent = agent
        self.session_manager = session_manager
        self.websocket_handler = websocket_handler
        
        # Pending authorization requests: state -> session_id
        self._pending_auth_requests: Dict[str, str] = {}
        
        # Authorization callbacks: session_id -> callback
        self._auth_callbacks: Dict[str, Callable] = {}
        
        # Processing queue for messages
        self._message_queue: asyncio.Queue = asyncio.Queue()
        self._processing_task: Optional[asyncio.Task] = None
        self._shutdown_event = asyncio.Event()
        
        logger.info("Initialized MessageProcessor")
    
    async def start(self) -> None:
        """Start the message processor and background processing task."""
        if self._processing_task is None or self._processing_task.done():
            self._processing_task = asyncio.create_task(self._process_message_queue())
            logger.info("Started message processing task")
    
    async def stop(self) -> None:
        """Stop the message processor and processing task."""
        self._shutdown_event.set()
        
        if self._processing_task and not self._processing_task.done():
            try:
                await asyncio.wait_for(self._processing_task, timeout=5.0)
            except asyncio.TimeoutError:
                logger.warning("Message processing task did not stop gracefully")
                self._processing_task.cancel()
        
        logger.info("Stopped MessageProcessor")
    
    async def process_chat_message(self, chat_message: ChatMessage) -> None:
        """
        Process a chat message from a user.
        
        Args:
            chat_message: The chat message to process
        """
        try:
            # Validate session exists and is active
            if not await self.session_manager.is_session_active(chat_message.session_id):
                logger.warning(f"Received message for inactive session {chat_message.session_id}")
                await self._send_error_response(
                    chat_message.session_id,
                    "Session expired or invalid. Please refresh and try again."
                )
                return
            
            # Add message to session history
            await self.session_manager.add_message_to_session(chat_message.session_id, chat_message)
            
            # Queue message for processing
            await self._message_queue.put({
                "type": "chat_message",
                "message": chat_message,
                "timestamp": datetime.now(timezone.utc)
            })
            
            logger.debug(f"Queued chat message {chat_message.id} for processing")
            
        except Exception as e:
            logger.error(f"Error processing chat message {chat_message.id}: {e}")
            await self._send_error_response(
                chat_message.session_id,
                "Failed to process your message. Please try again."
            )
    
    async def process_auth_response(self, session_id: str, auth_code: str, state: str) -> None:
        """
        Process an authorization response from a user.
        
        Args:
            session_id: The session ID
            auth_code: The authorization code
            state: The state parameter
        """
        try:
            # Validate state parameter
            if state not in self._pending_auth_requests:
                logger.warning(f"Received auth response with unknown state {state}")
                await self._send_error_response(
                    session_id,
                    "Invalid authorization state. Please try again."
                )
                return
            
            # Validate session matches
            expected_session_id = self._pending_auth_requests[state]
            if session_id != expected_session_id:
                logger.warning(f"Session ID mismatch for auth response: expected {expected_session_id}, got {session_id}")
                await self._send_error_response(
                    session_id,
                    "Session mismatch for authorization. Please try again."
                )
                return
            
            # Create authorization code object
            auth_code_obj = AuthorizationCode(
                code=auth_code,
                state=state,
                session_id=session_id,
                expires_at=datetime.now(timezone.utc)  # Will be validated by MCP server
            )
            
            # Queue auth response for processing
            await self._message_queue.put({
                "type": "auth_response",
                "session_id": session_id,
                "auth_code": auth_code_obj,
                "timestamp": datetime.now(timezone.utc)
            })
            
            # Clean up pending request
            del self._pending_auth_requests[state]
            
            logger.info(f"Queued auth response for session {session_id}")
            
        except Exception as e:
            logger.error(f"Error processing auth response for session {session_id}: {e}")
            await self._send_error_response(
                session_id,
                "Failed to process authorization response. Please try again."
            )
    
    async def request_user_authorization(self, session_id: str, auth_url: str, scope: str) -> str:
        """
        Request user authorization and return state parameter.
        
        Args:
            session_id: The session ID
            auth_url: The authorization URL
            scope: The requested scope
            
        Returns:
            str: The state parameter for tracking the request
        """
        try:
            # Generate state parameter
            state = str(uuid.uuid4())
            
            # Store pending request
            self._pending_auth_requests[state] = session_id
            
            # Send authorization request to user
            success = await self.websocket_handler.send_auth_request(session_id, auth_url, state)
            
            if not success:
                # Clean up if sending failed
                del self._pending_auth_requests[state]
                raise RuntimeError("Failed to send authorization request to user")
            
            logger.info(f"Sent authorization request to session {session_id} with state {state}")
            return state
            
        except Exception as e:
            logger.error(f"Error requesting user authorization for session {session_id}: {e}")
            raise
    
    async def _process_message_queue(self) -> None:
        """Background task for processing queued messages."""
        logger.info("Started message queue processing")
        
        while not self._shutdown_event.is_set():
            try:
                # Wait for message or shutdown
                try:
                    message_data = await asyncio.wait_for(
                        self._message_queue.get(),
                        timeout=1.0
                    )
                except asyncio.TimeoutError:
                    continue  # Check shutdown event
                
                # Process the message
                await self._handle_queued_message(message_data)
                
            except Exception as e:
                logger.error(f"Error in message queue processing: {e}")
        
        logger.info("Message queue processing stopped")
    
    async def _handle_queued_message(self, message_data: Dict[str, Any]) -> None:
        """
        Handle a queued message.
        
        Args:
            message_data: The message data from the queue
        """
        message_type = message_data.get("type")
        
        try:
            if message_type == "chat_message":
                await self._handle_chat_message(message_data["message"])
            elif message_type == "auth_response":
                await self._handle_auth_response(
                    message_data["session_id"],
                    message_data["auth_code"]
                )
            else:
                logger.warning(f"Unknown message type in queue: {message_type}")
        
        except Exception as e:
            logger.error(f"Error handling queued message of type {message_type}: {e}")
    
    async def _handle_chat_message(self, chat_message: ChatMessage) -> None:
        """
        Handle a chat message by processing it with the agent.
        
        Args:
            chat_message: The chat message to handle
        """
        session_id = chat_message.session_id
        
        try:
            logger.info(f"Processing chat message {chat_message.id} from session {session_id}")
            
            # Send typing indicator
            await self.websocket_handler.send_message_to_session(session_id, {
                "type": "typing_start",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            # Process message with agent (with real-time tracing)
            response = await self.agent.process_message_with_tracing(chat_message.content, session_id)
            
            # Stop typing indicator
            await self.websocket_handler.send_message_to_session(session_id, {
                "type": "typing_stop",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            # Create assistant message
            assistant_message = ChatMessage.create_assistant_message(
                session_id=session_id,
                content=response,
                metadata={
                    "processing_time": datetime.now(timezone.utc).isoformat(),
                    "agent_version": "1.0"
                }
            )
            
            # Add to session history
            await self.session_manager.add_message_to_session(session_id, assistant_message)
            
            # Send response to user
            await self.websocket_handler.send_chat_response(
                session_id,
                response,
                metadata=assistant_message.metadata
            )
            
            logger.info(f"Successfully processed chat message {chat_message.id}")
            
        except Exception as e:
            logger.error(f"Error handling chat message {chat_message.id}: {e}")
            
            # Stop typing indicator
            await self.websocket_handler.send_message_to_session(session_id, {
                "type": "typing_stop",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            # Send error response
            await self._send_error_response(
                session_id,
                "I encountered an error while processing your message. Please try again."
            )
    
    async def _handle_auth_response(self, session_id: str, auth_code: AuthorizationCode) -> None:
        """
        Handle an authorization response by notifying waiting callbacks.
        
        Args:
            session_id: The session ID
            auth_code: The authorization code
        """
        try:
            logger.info(f"Handling auth response for session {session_id}")
            
            # Check if there's a callback waiting for this session
            callback = self._auth_callbacks.get(session_id)
            if callback:
                # Remove callback and execute it
                del self._auth_callbacks[session_id]
                await callback(auth_code)
            else:
                # Store auth code in session context for later use
                await self.session_manager.add_session_context(
                    session_id,
                    "pending_auth_code",
                    {
                        "code": auth_code.code,
                        "state": auth_code.state,
                        "received_at": datetime.now(timezone.utc).isoformat()
                    }
                )
            
            # Send confirmation to user
            await self.websocket_handler.send_message_to_session(session_id, {
                "type": "auth_confirmed",
                "message": "Authorization received successfully.",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            logger.info(f"Successfully handled auth response for session {session_id}")
            
        except Exception as e:
            logger.error(f"Error handling auth response for session {session_id}: {e}")
            await self._send_error_response(
                session_id,
                "Failed to process authorization response. Please try again."
            )
    
    async def _send_error_response(self, session_id: str, error_message: str) -> None:
        """
        Send an error response to a session.
        
        Args:
            session_id: The session ID
            error_message: The error message to send
        """
        try:
            await self.websocket_handler.send_message_to_session(session_id, {
                "type": "error_response",
                "message": error_message,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
        except Exception as e:
            logger.error(f"Failed to send error response to session {session_id}: {e}")
    
    async def register_auth_callback(self, session_id: str, callback: Callable) -> None:
        """
        Register a callback for authorization responses.
        
        Args:
            session_id: The session ID
            callback: The callback function to call when auth response is received
        """
        self._auth_callbacks[session_id] = callback
        logger.debug(f"Registered auth callback for session {session_id}")
    
    async def get_pending_auth_code(self, session_id: str) -> Optional[Dict[str, Any]]:
        """
        Get pending authorization code for a session.
        
        Args:
            session_id: The session ID
            
        Returns:
            Dict with auth code data or None if not found
        """
        auth_code_data = await self.session_manager.get_session_context(
            session_id,
            "pending_auth_code"
        )
        
        if auth_code_data:
            # Clear the pending auth code after retrieving
            await self.session_manager.add_session_context(
                session_id,
                "pending_auth_code",
                None
            )
        
        return auth_code_data
    
    async def get_processor_stats(self) -> Dict[str, Any]:
        """
        Get statistics about the message processor.
        
        Returns:
            Dict containing processor statistics
        """
        return {
            "queue_size": self._message_queue.qsize(),
            "pending_auth_requests": len(self._pending_auth_requests),
            "active_auth_callbacks": len(self._auth_callbacks),
            "processing_task_running": (
                self._processing_task is not None and 
                not self._processing_task.done()
            )
        }
    
    async def process_session_init_with_email(self, session_id: str, user_email: str, user_id: str = None) -> None:
        """
        Pre-identify user directly from their email address.
        No API call needed — email came from the authenticated frontend session.
        """
        try:
            await self.agent.initialize_session_with_email(session_id, user_email, user_id)
            logger.info(f"Pre-identified user '{user_email}' for session {session_id}")
        except Exception as e:
            logger.warning(f"Email pre-identification failed for session {session_id}: {e}")

    async def process_session_init_with_user_id(self, session_id: str, user_id: str) -> None:
        """
        Pre-identify user from their user_id (received in session_init message).
        Looks up the user via the banking API using the agent's service credentials.
        
        Args:
            session_id: The chat session ID
            user_id: The user ID from the widget's session_init message
        """
        try:
            logger.info(f"Pre-identifying user {user_id} for session {session_id}")
            await self.agent.initialize_session_with_user_id(session_id, user_id)
            logger.info(f"Successfully pre-identified user {user_id} for session {session_id}")
        except Exception as e:
            logger.warning(f"Could not pre-identify user {user_id} for session {session_id}: {e}")

    async def clear_session_data(self, session_id: str) -> None:
        """
        Clear all processor data for a session.
        
        Args:
            session_id: The session ID to clear
        """
        # Remove auth callback if exists
        if session_id in self._auth_callbacks:
            del self._auth_callbacks[session_id]
        
        # Remove pending auth requests for this session
        states_to_remove = [
            state for state, sid in self._pending_auth_requests.items()
            if sid == session_id
        ]
        for state in states_to_remove:
            del self._pending_auth_requests[state]
        
        logger.debug(f"Cleared processor data for session {session_id}")
    
    async def shutdown(self) -> None:
        """Shutdown the message processor and clean up resources."""
        await self.stop()
        
        # Clear all pending data
        self._pending_auth_requests.clear()
        self._auth_callbacks.clear()
        
        # Clear message queue
        while not self._message_queue.empty():
            try:
                self._message_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        
        logger.info("MessageProcessor shutdown complete")