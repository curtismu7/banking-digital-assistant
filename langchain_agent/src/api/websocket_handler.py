"""
WebSocket handler for real-time chat communication.
"""
import asyncio
import json
import logging
from typing import Dict, Any, Optional, Set
from datetime import datetime, timezone
import uuid

import websockets
from websockets.server import WebSocketServerProtocol
from websockets.exceptions import ConnectionClosed, WebSocketException

from models.chat import ChatMessage, ChatSession, MessageRole
from config.settings import get_config


logger = logging.getLogger(__name__)


class ChatWebSocketHandler:
    """
    WebSocket handler for browser-backend real-time communication.
    
    Manages WebSocket connections, message routing, and session management
    for the chat interface.
    """
    
    def __init__(self, config=None):
        """
        Initialize the WebSocket handler.
        
        Args:
            config: Optional configuration object
        """
        self.config = config or get_config()
        
        # Active connections: session_id -> websocket
        self._connections: Dict[str, WebSocketServerProtocol] = {}
        
        # Session to connection mapping: session_id -> connection_id
        self._session_connections: Dict[str, str] = {}
        
        # Connection metadata: connection_id -> metadata
        self._connection_metadata: Dict[str, Dict[str, Any]] = {}
        
        # Session manager reference (will be set by message processor)
        self._session_manager = None
        
        # Message handlers
        self._message_handlers: Dict[str, callable] = {
            "chat_message": self._handle_chat_message,
            "session_init": self._handle_session_init,
            "session_close": self._handle_session_close,
            "ping": self._handle_ping,
            "auth_response": self._handle_auth_response
        }
        
        logger.info("Initialized ChatWebSocketHandler")
    
    async def handle_connection(self, websocket: WebSocketServerProtocol) -> None:
        """
        Handle a new WebSocket connection.
        
        Args:
            websocket: The WebSocket connection
        """
        connection_id = str(uuid.uuid4())

        # Extract token from WebSocket URL query string: ws://host/ws?token=xxx
        user_token = None
        try:
            from urllib.parse import urlparse, parse_qs
            raw_path = getattr(websocket, 'path', '') or ''
            query_params = parse_qs(urlparse(raw_path).query)
            user_token = query_params.get("token", [None])[0]
            if user_token:
                logger.info(f"Auth token received in WebSocket URL for connection {connection_id}")
            else:
                logger.debug(f"No auth token in WebSocket URL for connection {connection_id}")
        except Exception as e:
            logger.warning(f"Could not extract token from WebSocket URL: {e}")

        try:
            # Register connection
            self._connections[connection_id] = websocket
            self._connection_metadata[connection_id] = {
                "connected_at": datetime.now(timezone.utc),
                "path": getattr(websocket, 'path', '/'),
                "session_id": None,
                "user_id": None,
                "user_token": user_token
            }
            
            logger.info(f"New WebSocket connection: {connection_id}")
            
            # Send connection acknowledgment
            await self._send_message(websocket, {
                "type": "connection_ack",
                "connection_id": connection_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            # Handle messages
            async for message in websocket:
                try:
                    await self._process_message(connection_id, message)
                except Exception as e:
                    logger.error(f"Error processing message from {connection_id}: {e}")
                    await self._send_error(websocket, "message_processing_error", str(e))
        
        except ConnectionClosed:
            logger.info(f"WebSocket connection closed: {connection_id}")
        except WebSocketException as e:
            logger.error(f"WebSocket error for connection {connection_id}: {e}")
        except Exception as e:
            logger.error(f"Unexpected error for connection {connection_id}: {e}")
        finally:
            # Clean up connection
            await self._cleanup_connection(connection_id)
    
    async def _process_message(self, connection_id: str, raw_message: str) -> None:
        """
        Process an incoming WebSocket message.
        
        Args:
            connection_id: The connection ID
            raw_message: The raw message string
        """
        try:
            # Parse message
            message = json.loads(raw_message)
            
            if not isinstance(message, dict):
                raise ValueError("Message must be a JSON object")
            
            message_type = message.get("type")
            if not message_type:
                raise ValueError("Message must have a 'type' field")
            
            # Get handler
            handler = self._message_handlers.get(message_type)
            if not handler:
                raise ValueError(f"Unknown message type: {message_type}")
            
            # Add connection context
            message["_connection_id"] = connection_id
            message["_timestamp"] = datetime.now(timezone.utc).isoformat()
            
            # Handle message
            await handler(message)
            
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON from connection {connection_id}: {e}")
            websocket = self._connections.get(connection_id)
            if websocket:
                await self._send_error(websocket, "invalid_json", "Message must be valid JSON")
        
        except ValueError as e:
            logger.error(f"Invalid message from connection {connection_id}: {e}")
            websocket = self._connections.get(connection_id)
            if websocket:
                await self._send_error(websocket, "invalid_message", str(e))
        
        except Exception as e:
            logger.error(f"Error processing message from connection {connection_id}: {e}")
            websocket = self._connections.get(connection_id)
            if websocket:
                await self._send_error(websocket, "processing_error", "Failed to process message")
    
    async def _handle_chat_message(self, message: Dict[str, Any]) -> None:
        """
        Handle a chat message from the user.
        
        Args:
            message: The message data
        """
        connection_id = message["_connection_id"]
        websocket = self._connections.get(connection_id)
        
        if not websocket:
            logger.error(f"No websocket found for connection {connection_id}")
            return
        
        try:
            # Validate required fields
            content = message.get("content")
            session_id = message.get("session_id")
            
            if not content or not isinstance(content, str):
                await self._send_error(websocket, "invalid_content", "Message content is required")
                return
            
            if not session_id or not isinstance(session_id, str):
                await self._send_error(websocket, "invalid_session", "Session ID is required")
                return
            
            # Validate message length
            if len(content) > self.config.chat.max_message_length:
                await self._send_error(websocket, "message_too_long", 
                                     f"Message exceeds maximum length of {self.config.chat.max_message_length}")
                return
            
            # Update connection metadata
            if connection_id in self._connection_metadata:
                self._connection_metadata[connection_id]["session_id"] = session_id
                self._session_connections[session_id] = connection_id
            
            # Create chat message
            chat_message = ChatMessage.create_user_message(
                session_id=session_id,
                content=content.strip(),
                metadata={
                    "connection_id": connection_id,
                    "message_id": message.get("message_id", str(uuid.uuid4()))
                }
            )
            
            # Send acknowledgment
            await self._send_message(websocket, {
                "type": "message_received",
                "message_id": chat_message.id,
                "session_id": session_id,
                "timestamp": chat_message.timestamp.isoformat()
            })
            
            # Notify message processor (this will be implemented in task 7.3)
            await self._notify_message_processor(chat_message)
            
            logger.info(f"Processed chat message from session {session_id}")
            
        except Exception as e:
            logger.error(f"Error handling chat message: {e}")
            await self._send_error(websocket, "chat_error", "Failed to process chat message")
    
    async def _handle_session_init(self, message: Dict[str, Any]) -> None:
        """
        Handle session initialization request.
        
        Args:
            message: The message data
        """
        connection_id = message["_connection_id"]
        websocket = self._connections.get(connection_id)
        
        if not websocket:
            return
        
        try:
            # Get or create session ID
            session_id = message.get("session_id")
            user_id = message.get("user_id")
            user_email = message.get("userEmail")  # Injected by App.js WebSocket interceptor

            # Create session in session manager if we have one
            if self._session_manager:
                if session_id:
                    # Check if session exists
                    existing_session = await self._session_manager.get_session(session_id)
                    if not existing_session:
                        # Session doesn't exist, create new one with provided ID
                        session = await self._session_manager.create_session(user_id=user_id, session_id=session_id)
                        logger.info(f"Created new session with provided ID: {session_id}")
                else:
                    # Create new session
                    session = await self._session_manager.create_session(user_id=user_id)
                    session_id = session.session_id
            else:
                # Fallback: generate session ID if no session manager
                if not session_id:
                    session_id = str(uuid.uuid4())
            
            # Update connection metadata
            if connection_id in self._connection_metadata:
                self._connection_metadata[connection_id]["session_id"] = session_id
                self._connection_metadata[connection_id]["user_id"] = user_id
                self._session_connections[session_id] = connection_id
            
            # Send session initialization response
            await self._send_message(websocket, {
                "type": "session_initialized",
                "session_id": session_id,
                "user_id": user_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            # If we have the user's email, pre-identify them directly — no API call needed
            if user_email and hasattr(self, '_message_processor') and self._message_processor:
                try:
                    await self._message_processor.process_session_init_with_email(session_id, user_email, user_id)
                    logger.info(f"Pre-identified user '{user_email}' for session {session_id}")
                except Exception as e:
                    logger.warning(f"Email pre-identification failed for session {session_id}: {e}")
            elif user_id and hasattr(self, '_message_processor') and self._message_processor:
                try:
                    await self._message_processor.process_session_init_with_user_id(session_id, user_id)
                except Exception as e:
                    logger.warning(f"User_id pre-identification failed for session {session_id}: {e}")

            logger.info(f"Initialized session {session_id} for connection {connection_id}")
            
        except Exception as e:
            logger.error(f"Error handling session init: {e}")
            await self._send_error(websocket, "session_error", "Failed to initialize session")
    
    async def _handle_session_close(self, message: Dict[str, Any]) -> None:
        """
        Handle session close request.
        
        Args:
            message: The message data
        """
        connection_id = message["_connection_id"]
        websocket = self._connections.get(connection_id)
        
        if not websocket:
            return
        
        try:
            session_id = message.get("session_id")
            
            if session_id and session_id in self._session_connections:
                del self._session_connections[session_id]
            
            # Update connection metadata
            if connection_id in self._connection_metadata:
                self._connection_metadata[connection_id]["session_id"] = None
            
            # Send acknowledgment
            await self._send_message(websocket, {
                "type": "session_closed",
                "session_id": session_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            logger.info(f"Closed session {session_id} for connection {connection_id}")
            
        except Exception as e:
            logger.error(f"Error handling session close: {e}")
            await self._send_error(websocket, "session_error", "Failed to close session")
    
    async def _handle_ping(self, message: Dict[str, Any]) -> None:
        """
        Handle ping message for connection health check.
        
        Args:
            message: The message data
        """
        connection_id = message["_connection_id"]
        websocket = self._connections.get(connection_id)
        
        if websocket:
            await self._send_message(websocket, {
                "type": "pong",
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
    
    async def _handle_auth_response(self, message: Dict[str, Any]) -> None:
        """
        Handle authorization response from user.
        
        Args:
            message: The message data
        """
        connection_id = message["_connection_id"]
        websocket = self._connections.get(connection_id)
        
        if not websocket:
            return
        
        try:
            session_id = message.get("session_id")
            auth_code = message.get("auth_code")
            state = message.get("state")
            
            if not session_id or not auth_code:
                await self._send_error(websocket, "invalid_auth", "Session ID and auth code are required")
                return
            
            # Send acknowledgment
            await self._send_message(websocket, {
                "type": "auth_received",
                "session_id": session_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })
            
            # Notify message processor about auth response
            await self._notify_auth_response(session_id, auth_code, state)
            
            logger.info(f"Processed auth response for session {session_id}")
            
        except Exception as e:
            logger.error(f"Error handling auth response: {e}")
            await self._send_error(websocket, "auth_error", "Failed to process authorization response")
    
    async def send_message_to_session(self, session_id: str, message: Dict[str, Any]) -> bool:
        """
        Send a message to a specific session.
        
        Args:
            session_id: The session ID
            message: The message to send
            
        Returns:
            bool: True if message was sent successfully
        """
        connection_id = self._session_connections.get(session_id)
        if not connection_id:
            logger.warning(f"No active connection for session {session_id}")
            return False
        
        websocket = self._connections.get(connection_id)
        if not websocket:
            logger.warning(f"No websocket for connection {connection_id}")
            return False
        
        try:
            await self._send_message(websocket, message)
            return True
        except Exception as e:
            logger.error(f"Error sending message to session {session_id}: {e}")
            return False
    
    async def send_chat_response(self, session_id: str, response: str, metadata: Optional[Dict[str, Any]] = None) -> bool:
        """
        Send a chat response to a session.
        
        Args:
            session_id: The session ID
            response: The response content
            metadata: Optional metadata
            
        Returns:
            bool: True if response was sent successfully
        """
        message = {
            "type": "chat_response",
            "session_id": session_id,
            "content": response,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "metadata": metadata or {}
        }
        
        return await self.send_message_to_session(session_id, message)
    
    async def send_auth_request(self, session_id: str, auth_url: str, state: str) -> bool:
        """
        Send an authorization request to a session.
        
        Args:
            session_id: The session ID
            auth_url: The authorization URL
            state: The state parameter
            
        Returns:
            bool: True if request was sent successfully
        """
        message = {
            "type": "auth_request",
            "session_id": session_id,
            "auth_url": auth_url,
            "state": state,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        return await self.send_message_to_session(session_id, message)
    
    async def _send_message(self, websocket: WebSocketServerProtocol, message: Dict[str, Any]) -> None:
        """
        Send a message through a WebSocket connection.
        
        Args:
            websocket: The WebSocket connection
            message: The message to send
        """
        try:
            await websocket.send(json.dumps(message))
        except ConnectionClosed:
            logger.debug("Attempted to send message to closed connection")
        except Exception as e:
            logger.error(f"Error sending WebSocket message: {e}")
            raise
    
    async def _send_error(self, websocket: WebSocketServerProtocol, error_code: str, error_message: str) -> None:
        """
        Send an error message through a WebSocket connection.
        
        Args:
            websocket: The WebSocket connection
            error_code: The error code
            error_message: The error message
        """
        error_response = {
            "type": "error",
            "error_code": error_code,
            "error_message": error_message,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
        
        await self._send_message(websocket, error_response)
    
    async def _cleanup_connection(self, connection_id: str) -> None:
        """
        Clean up a connection and its associated data.
        
        Args:
            connection_id: The connection ID to clean up
        """
        try:
            # Remove from connections
            if connection_id in self._connections:
                del self._connections[connection_id]
            
            # Remove from metadata and session mapping
            if connection_id in self._connection_metadata:
                session_id = self._connection_metadata[connection_id].get("session_id")
                if session_id and session_id in self._session_connections:
                    del self._session_connections[session_id]
                del self._connection_metadata[connection_id]
            
            logger.debug(f"Cleaned up connection {connection_id}")
            
        except Exception as e:
            logger.error(f"Error cleaning up connection {connection_id}: {e}")
    
    def set_message_processor(self, message_processor) -> None:
        """
        Set the message processor for handling messages.
        
        Args:
            message_processor: The MessageProcessor instance
        """
        self._message_processor = message_processor
        logger.info("Set message processor for WebSocket handler")
    
    def set_session_manager(self, session_manager) -> None:
        """
        Set the session manager for handling sessions.
        
        Args:
            session_manager: The SessionManager instance
        """
        self._session_manager = session_manager
        logger.info("Set session manager for WebSocket handler")
    
    async def _notify_message_processor(self, chat_message: ChatMessage) -> None:
        """
        Notify the message processor about a new chat message.
        
        Args:
            chat_message: The chat message to process
        """
        if hasattr(self, '_message_processor') and self._message_processor:
            try:
                await self._message_processor.process_chat_message(chat_message)
            except Exception as e:
                logger.error(f"Error notifying message processor about message {chat_message.id}: {e}")
        else:
            logger.debug(f"No message processor set, cannot process message {chat_message.id}")
    
    async def _notify_auth_response(self, session_id: str, auth_code: str, state: str) -> None:
        """
        Notify about an authorization response.
        
        Args:
            session_id: The session ID
            auth_code: The authorization code
            state: The state parameter
        """
        if hasattr(self, '_message_processor') and self._message_processor:
            try:
                await self._message_processor.process_auth_response(session_id, auth_code, state)
            except Exception as e:
                logger.error(f"Error notifying message processor about auth response for session {session_id}: {e}")
        else:
            logger.debug(f"No message processor set, cannot process auth response for session {session_id}")
    
    def get_active_connections(self) -> Dict[str, Dict[str, Any]]:
        """
        Get information about active connections.
        
        Returns:
            Dict mapping connection IDs to connection metadata
        """
        return self._connection_metadata.copy()
    
    def get_active_sessions(self) -> Dict[str, str]:
        """
        Get active session to connection mapping.
        
        Returns:
            Dict mapping session IDs to connection IDs
        """
        return self._session_connections.copy()
    
    async def broadcast_to_all(self, message: Dict[str, Any]) -> int:
        """
        Broadcast a message to all active connections.
        
        Args:
            message: The message to broadcast
            
        Returns:
            int: Number of connections the message was sent to
        """
        sent_count = 0
        
        for connection_id, websocket in self._connections.items():
            try:
                await self._send_message(websocket, message)
                sent_count += 1
            except Exception as e:
                logger.error(f"Error broadcasting to connection {connection_id}: {e}")
        
        return sent_count
    
    async def shutdown(self) -> None:
        """Shutdown the WebSocket handler and close all connections."""
        logger.info("Shutting down WebSocket handler")
        
        # Close all connections
        for connection_id, websocket in self._connections.items():
            try:
                await websocket.close()
            except Exception as e:
                logger.error(f"Error closing connection {connection_id}: {e}")
        
        # Clear all data
        self._connections.clear()
        self._session_connections.clear()
        self._connection_metadata.clear()
        
        logger.info("WebSocket handler shutdown complete")