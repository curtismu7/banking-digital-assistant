"""
OAuth authentication manager implementation for PingOne Advanced Identity Cloud (ForgeRock).
"""
import asyncio
import json
import secrets
import string
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from urllib.parse import urlencode, urlparse, parse_qs
import aiohttp
import logging

from .interfaces import AuthenticationProvider
from models.auth import ClientCredentials, AccessToken
from config.settings import get_config


logger = logging.getLogger(__name__)


class DynamicClientRegistration:
    """Handles dynamic client registration with PingOne Advanced Identity Cloud (ForgeRock)."""
    
    def __init__(self, config=None):
        self.config = config or get_config()
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def __aenter__(self):
        """Async context manager entry."""
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        if self.session:
            await self.session.close()
    
    async def register_client(self, additional_scopes: Optional[List[str]] = None) -> ClientCredentials:
        """
        Register a new OAuth client with PingOne Advanced Identity Cloud (ForgeRock).
        
        Args:
            additional_scopes: Optional list of additional scopes to request beyond default
        
        Returns:
            ClientCredentials: The registered client credentials
            
        Raises:
            aiohttp.ClientError: If registration request fails
            ValueError: If response is invalid
        """
        if not self.session:
            raise RuntimeError("DynamicClientRegistration must be used as async context manager")
        
        # Build scope string with additional scopes
        scopes = [self.config.pingone.default_scope, "ai_agent"]
        if additional_scopes:
            scopes.extend(additional_scopes)
        scope_string = " ".join(scopes)
        
        # ForgeRock Dynamic Client Registration payload
        registration_data = {
            "client_name": "LangChain MCP OAuth Agent",
            "client_uri": "https://github.com/langchain/mcp-oauth-agent",
            "redirect_uris": [self.config.pingone.redirect_uri],
            "grant_types": ["client_credentials", "authorization_code"],
            "response_types": ["code"],
            "token_endpoint_auth_method": "client_secret_basic",
            "scope": scope_string,
            "application_type": "web",
            "subject_type": "public"
        }
        
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json"
        }
        
        max_retries = self.config.security.max_retry_attempts
        backoff_seconds = self.config.security.retry_backoff_seconds
        
        for attempt in range(max_retries):
            try:
                logger.info(f"Attempting client registration (attempt {attempt + 1}/{max_retries})")
                
                async with self.session.post(
                    self.config.pingone.client_registration_endpoint,
                    json=registration_data,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    
                    if response.status == 201:
                        response_data = await response.json()
                        return self._parse_registration_response(response_data)
                    
                    elif response.status in [429, 500, 502, 503, 504]:
                        # Retryable errors
                        if attempt < max_retries - 1:
                            wait_time = backoff_seconds * (2 ** attempt)
                            logger.warning(f"Registration failed with status {response.status}, retrying in {wait_time}s")
                            await asyncio.sleep(wait_time)
                            continue
                    
                    # Non-retryable error or max retries reached
                    error_text = await response.text()
                    logger.error(f"Client registration failed with status {response.status}: {error_text}")
                    raise aiohttp.ClientResponseError(
                        request_info=response.request_info,
                        history=response.history,
                        status=response.status,
                        message=f"Client registration failed: {error_text}"
                    )
            
            except aiohttp.ClientError as e:
                if attempt < max_retries - 1:
                    wait_time = backoff_seconds * (2 ** attempt)
                    logger.warning(f"Registration request failed: {e}, retrying in {wait_time}s")
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    logger.error(f"Client registration failed after {max_retries} attempts: {e}")
                    raise
        
        raise RuntimeError("Client registration failed after all retry attempts")
    
    async def delete_client(self, client_credentials: ClientCredentials) -> bool:
        """
        Delete a dynamically registered OAuth client from ForgeRock.
        
        Args:
            client_credentials: The client credentials containing registration_access_token
            
        Returns:
            bool: True if deletion was successful
            
        Raises:
            aiohttp.ClientError: If deletion request fails
            ValueError: If registration_access_token is missing
        """
        if not self.session:
            raise RuntimeError("DynamicClientRegistration must be used as async context manager")
        
        if not client_credentials.registration_access_token:
            raise ValueError("Missing registration_access_token required for client deletion")
        
        # Build the registration client URI
        registration_uri = f"{self.config.pingone.client_registration_endpoint}?client_id={client_credentials.client_id}"
        
        headers = {
            "Authorization": f"Bearer {client_credentials.registration_access_token}",
            "Accept": "application/json"
        }
        
        max_retries = self.config.security.max_retry_attempts
        backoff_seconds = self.config.security.retry_backoff_seconds
        
        for attempt in range(max_retries):
            try:
                logger.info(f"Attempting client deletion for {client_credentials.client_id} (attempt {attempt + 1}/{max_retries})")
                
                async with self.session.delete(
                    registration_uri,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    
                    if response.status == 204:
                        # 204 No Content = successful deletion
                        logger.info(f"Successfully deleted client {client_credentials.client_id}")
                        return True
                    
                    elif response.status == 404:
                        # Client already deleted or doesn't exist
                        logger.warning(f"Client {client_credentials.client_id} not found (may already be deleted)")
                        return True
                    
                    elif response.status in [429, 500, 502, 503, 504]:
                        # Retryable errors
                        if attempt < max_retries - 1:
                            wait_time = backoff_seconds * (2 ** attempt)
                            logger.warning(f"Deletion failed with status {response.status}, retrying in {wait_time}s")
                            await asyncio.sleep(wait_time)
                            continue
                    
                    # Non-retryable error or max retries reached
                    error_text = await response.text()
                    logger.error(f"Client deletion failed with status {response.status}: {error_text}")
                    raise aiohttp.ClientResponseError(
                        request_info=response.request_info,
                        history=response.history,
                        status=response.status,
                        message=f"Client deletion failed: {error_text}"
                    )
            
            except aiohttp.ClientError as e:
                if attempt < max_retries - 1:
                    wait_time = backoff_seconds * (2 ** attempt)
                    logger.warning(f"Deletion request failed: {e}, retrying in {wait_time}s")
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    logger.error(f"Client deletion failed after {max_retries} attempts: {e}")
                    raise
        
        raise RuntimeError("Client deletion failed after all retry attempts")
    
    def _parse_registration_response(self, response_data: Dict[str, Any]) -> ClientCredentials:
        """
        Parse the client registration response from ForgeRock.
        
        Args:
            response_data: The JSON response from the registration endpoint
            
        Returns:
            ClientCredentials: Parsed client credentials
            
        Raises:
            ValueError: If response format is invalid
        """
        try:
            client_id = response_data["client_id"]
            client_secret = response_data["client_secret"]
            registration_access_token = response_data.get("registration_access_token", "")
            
            # ForgeRock uses client_secret_expires_at (Unix timestamp) or no expiration
            expires_in = response_data.get("client_secret_expires_at", 0)
            if expires_in == 0:
                # No expiration specified, set to 1 year from now (ForgeRock default)
                expires_at = datetime.now(timezone.utc) + timedelta(days=365)
            else:
                # Convert Unix timestamp to datetime
                expires_at = datetime.fromtimestamp(expires_in, tz=timezone.utc)
            
            credentials = ClientCredentials(
                client_id=client_id,
                client_secret=client_secret,
                registration_access_token=registration_access_token,
                expires_at=expires_at
            )
            
            logger.info(f"Successfully registered ForgeRock client {client_id}, expires at {expires_at}")
            return credentials
            
        except KeyError as e:
            logger.error(f"Missing required field in ForgeRock registration response: {e}")
            raise ValueError(f"Invalid registration response: missing {e}")
        except Exception as e:
            logger.error(f"Failed to parse ForgeRock registration response: {e}")
            raise ValueError(f"Invalid registration response format: {e}")


class TokenManager:
    """Manages OAuth token acquisition and refresh for agent authentication."""
    
    def __init__(self, config=None):
        self.config = config or get_config()
        self.session: Optional[aiohttp.ClientSession] = None
        self._current_token: Optional[AccessToken] = None
        self._current_credentials: Optional[ClientCredentials] = None
    
    async def __aenter__(self):
        """Async context manager entry."""
        self.session = aiohttp.ClientSession()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        if self.session:
            await self.session.close()
    
    async def get_client_credentials_token(self, client_credentials: ClientCredentials, 
                                         additional_scopes: Optional[List[str]] = None) -> AccessToken:
        """
        Obtain an access token using client credentials flow.
        
        Args:
            client_credentials: The client credentials to use for authentication
            additional_scopes: Optional list of additional scopes to request beyond default
            
        Returns:
            AccessToken: The obtained access token
            
        Raises:
            aiohttp.ClientError: If token request fails
            ValueError: If credentials are expired or response is invalid
        """
        if not self.session:
            raise RuntimeError("TokenManager must be used as async context manager")
        
        if client_credentials.is_expired():
            raise ValueError("Client credentials are expired")
        
        # Build scope string with additional scopes
        scopes = [self.config.pingone.default_scope]
        if additional_scopes:
            scopes.extend(additional_scopes)
        scope_string = " ".join(scopes)
        
        token_data = {
            "grant_type": "client_credentials",
            "scope": scope_string
        }
        
        # Use HTTP Basic authentication with client credentials
        auth = aiohttp.BasicAuth(
            login=client_credentials.client_id,
            password=client_credentials.client_secret
        )
        
        headers = {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json"
        }
        
        max_retries = self.config.security.max_retry_attempts
        backoff_seconds = self.config.security.retry_backoff_seconds
        
        for attempt in range(max_retries):
            try:
                logger.info(f"Requesting client credentials token (attempt {attempt + 1}/{max_retries})")
                
                async with self.session.post(
                    self.config.pingone.token_endpoint,
                    data=token_data,
                    auth=auth,
                    headers=headers,
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    
                    if response.status == 200:
                        response_data = await response.json()
                        return self._parse_token_response(response_data)
                    
                    elif response.status in [429, 500, 502, 503, 504]:
                        # Retryable errors
                        if attempt < max_retries - 1:
                            wait_time = backoff_seconds * (2 ** attempt)
                            logger.warning(f"Token request failed with status {response.status}, retrying in {wait_time}s")
                            await asyncio.sleep(wait_time)
                            continue
                    
                    # Non-retryable error or max retries reached
                    error_text = await response.text()
                    logger.error(f"Token request failed with status {response.status}: {error_text}")
                    raise aiohttp.ClientResponseError(
                        request_info=response.request_info,
                        history=response.history,
                        status=response.status,
                        message=f"Token request failed: {error_text}"
                    )
            
            except aiohttp.ClientResponseError as e:
                # Don't retry client response errors (they already went through status code handling above)
                logger.error(f"Token request failed with client response error: {e}")
                raise
            except aiohttp.ClientError as e:
                # Retry other client errors (connection issues, timeouts, etc.)
                if attempt < max_retries - 1:
                    wait_time = backoff_seconds * (2 ** attempt)
                    logger.warning(f"Token request failed: {e}, retrying in {wait_time}s")
                    await asyncio.sleep(wait_time)
                    continue
                else:
                    logger.error(f"Token request failed after {max_retries} attempts: {e}")
                    raise
        
        raise RuntimeError("Token request failed after all retry attempts")
    
    def _parse_token_response(self, response_data: Dict[str, Any]) -> AccessToken:
        """
        Parse the token response from ForgeRock.
        
        Args:
            response_data: The JSON response from the token endpoint
            
        Returns:
            AccessToken: Parsed access token
            
        Raises:
            ValueError: If response format is invalid
        """
        try:
            access_token = response_data["access_token"]
            token_type = response_data.get("token_type", "Bearer")
            expires_in = int(response_data.get("expires_in", 3600))
            scope = response_data.get("scope", self.config.pingone.default_scope)
            
            token = AccessToken(
                token=access_token,
                token_type=token_type,
                expires_in=expires_in,
                scope=scope,
                issued_at=datetime.now(timezone.utc)
            )
            
            logger.info(f"Successfully obtained ForgeRock access token, expires in {expires_in} seconds")
            return token
            
        except (KeyError, ValueError) as e:
            logger.error(f"Failed to parse ForgeRock token response: {e}")
            raise ValueError(f"Invalid token response format: {e}")
    
    async def get_valid_token(self, client_credentials: ClientCredentials, 
                            additional_scopes: Optional[List[str]] = None) -> AccessToken:
        """
        Get a valid access token, refreshing if necessary.
        
        Args:
            client_credentials: The client credentials to use for authentication
            additional_scopes: Optional list of additional scopes to request beyond default
            
        Returns:
            AccessToken: A valid access token
            
        Raises:
            aiohttp.ClientError: If token acquisition fails
            ValueError: If credentials are expired or response is invalid
        """
        # Build scope key for cache validation
        scopes = [self.config.pingone.default_scope]
        if additional_scopes:
            scopes.extend(additional_scopes)
        scope_key = " ".join(sorted(scopes))
        
        # Check if we have a current token and if it's still valid
        if (self._current_token and 
            self._current_credentials and 
            self._current_credentials.client_id == client_credentials.client_id and
            not self._is_token_near_expiry(self._current_token) and
            self._current_token.scope == scope_key):
            logger.debug("Using cached access token")
            return self._current_token
        
        # Need to get a new token
        logger.info("Acquiring new access token")
        token = await self.get_client_credentials_token(client_credentials, additional_scopes)
        
        # Cache the token and credentials
        self._current_token = token
        self._current_credentials = client_credentials
        
        return token
    
    def _is_token_near_expiry(self, token: AccessToken) -> bool:
        """
        Check if token is near expiry (within the configured buffer time).
        
        Args:
            token: The access token to check
            
        Returns:
            bool: True if token is near expiry or expired
        """
        buffer_seconds = self.config.security.token_expiry_buffer_seconds
        return token.expires_in_seconds() <= buffer_seconds
    
    def clear_cached_token(self) -> None:
        """Clear any cached token and credentials."""
        self._current_token = None
        self._current_credentials = None
        logger.debug("Cleared cached access token")


class UserAuthorizationFacilitator:
    """
    Facilitates OAuth authorization code flow between users and MCP servers.
    
    This class handles the user authorization flow by:
    1. Generating authorization URLs when MCP servers request user auth
    2. Receiving authorization codes from OAuth redirects
    3. Passing authorization codes to requesting MCP servers
    
    Note: This class does NOT exchange authorization codes for tokens.
    That is handled by the MCP servers directly with the authorization server.
    """
    
    def __init__(self, config=None):
        self.config = config or get_config()
        self._pending_authorizations: Dict[str, Dict[str, Any]] = {}
    
    def generate_authorization_url(self, client_id: str, scope: str, session_id: str, mcp_server_id: str) -> str:
        """
        Generate authorization URL for user to visit.
        
        Args:
            client_id: The OAuth client ID (from registered client)
            scope: The OAuth scope requested by the MCP server
            session_id: The user session ID
            mcp_server_id: The ID of the MCP server requesting authorization
            
        Returns:
            str: The authorization URL for the user to visit
        """
        # Generate cryptographically secure state parameter
        state = self._generate_state()
        
        # Store authorization request information for callback handling
        self._pending_authorizations[state] = {
            "session_id": session_id,
            "mcp_server_id": mcp_server_id,
            "scope": scope,
            "client_id": client_id,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=10)
        }
        
        # Build authorization URL
        auth_params = {
            "response_type": "code",
            "client_id": client_id,
            "redirect_uri": self.config.pingone.redirect_uri,
            "scope": scope,
            "state": state
        }
        
        auth_url = f"{self.config.pingone.authorization_endpoint}?{urlencode(auth_params)}"
        
        logger.info(f"Generated authorization URL for MCP server {mcp_server_id}, session {session_id}")
        return auth_url
    
    def handle_authorization_callback(self, auth_code: str, state: str) -> Dict[str, Any]:
        """
        Handle authorization callback and prepare data for MCP server.
        
        Args:
            auth_code: The authorization code from the callback
            state: The state parameter from the callback
            
        Returns:
            Dict containing authorization info for the MCP server
            
        Raises:
            ValueError: If state is invalid or expired
        """
        # Validate state parameter
        if state not in self._pending_authorizations:
            logger.error(f"Invalid state parameter: {state}")
            raise ValueError("Invalid or expired state parameter")
        
        auth_info = self._pending_authorizations[state]
        
        # Check if state has expired
        if datetime.now(timezone.utc) > auth_info["expires_at"]:
            del self._pending_authorizations[state]
            logger.error(f"Expired state parameter: {state}")
            raise ValueError("State parameter has expired")
        
        # Prepare authorization data for MCP server
        authorization_data = {
            "authorization_code": auth_code,
            "state": state,
            "session_id": auth_info["session_id"],
            "mcp_server_id": auth_info["mcp_server_id"],
            "scope": auth_info["scope"],
            "client_id": auth_info["client_id"],
            "redirect_uri": self.config.pingone.redirect_uri,
            "received_at": datetime.now(timezone.utc)
        }
        
        # Clean up state
        del self._pending_authorizations[state]
        
        logger.info(f"Successfully received authorization code for MCP server {auth_info['mcp_server_id']}")
        return authorization_data
    
    def validate_state(self, state: str, session_id: str) -> bool:
        """
        Validate state parameter for CSRF protection.
        
        Args:
            state: The state parameter to validate
            session_id: The expected session ID
            
        Returns:
            bool: True if state is valid, False otherwise
        """
        if state not in self._pending_authorizations:
            return False
        
        auth_info = self._pending_authorizations[state]
        
        # Check expiration
        if datetime.now(timezone.utc) > auth_info["expires_at"]:
            del self._pending_authorizations[state]
            return False
        
        # Check session ID match
        return auth_info["session_id"] == session_id
    
    def get_pending_authorization_info(self, state: str) -> Optional[Dict[str, Any]]:
        """
        Get information about a pending authorization request.
        
        Args:
            state: The state parameter
            
        Returns:
            Dict with authorization info or None if not found
        """
        return self._pending_authorizations.get(state)
    
    def _generate_state(self) -> str:
        """Generate a cryptographically secure state parameter."""
        alphabet = string.ascii_letters + string.digits + "-_"
        return ''.join(secrets.choice(alphabet) for _ in range(32))
    
    def cleanup_expired_authorizations(self) -> None:
        """Clean up expired authorization requests."""
        now = datetime.now(timezone.utc)
        expired_states = [
            state for state, info in self._pending_authorizations.items()
            if now > info["expires_at"]
        ]
        
        for state in expired_states:
            del self._pending_authorizations[state]
        
        if expired_states:
            logger.info(f"Cleaned up {len(expired_states)} expired authorization requests")


class OAuthAuthenticationManager(AuthenticationProvider):
    """
    OAuth authentication manager for ForgeRock integration.
    
    This class handles:
    1. Agent authentication via client credentials flow
    2. User authorization facilitation for MCP servers
    3. Automatic client cleanup on context exit
    
    Note: User token exchange is handled by MCP servers, not this manager.
    """
    
    def __init__(self, config=None, auto_cleanup: bool = True, auto_register: bool = True):
        """
        Initialize OAuth authentication manager.
        
        Args:
            config: Optional configuration object
            auto_cleanup: If True, automatically delete registered client on context exit
            auto_register: If True, automatically register client on context entry
        """
        self.config = config or get_config()
        self._client_registration = None
        self._token_manager = None
        self._user_auth_facilitator = None
        self._registered_credentials: Optional[ClientCredentials] = None
        self._auto_cleanup = auto_cleanup
        self._auto_register = auto_register
    
    async def __aenter__(self):
        """Async context manager entry."""
        self._client_registration = DynamicClientRegistration(self.config)
        self._token_manager = TokenManager(self.config)
        self._user_auth_facilitator = UserAuthorizationFacilitator(self.config)
        
        await self._client_registration.__aenter__()
        await self._token_manager.__aenter__()
        
        # Auto-register client if enabled
        if self._auto_register:
            logger.info("Auto-registering OAuth client on context entry")
            await self.register_client()
        
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit with automatic client cleanup."""
        try:
            # Automatically delete the registered client if enabled and credentials exist
            if self._auto_cleanup and self._registered_credentials and self._client_registration:
                try:
                    logger.info("Auto-cleanup: Deleting registered OAuth client")
                    await self._client_registration.delete_client(self._registered_credentials)
                except Exception as cleanup_error:
                    logger.error(f"Failed to auto-cleanup client {self._registered_credentials.client_id}: {cleanup_error}")
                    # Don't raise - we want to continue with other cleanup
        finally:
            # Always clean up session resources
            if self._client_registration:
                await self._client_registration.__aexit__(exc_type, exc_val, exc_tb)
            if self._token_manager:
                await self._token_manager.__aexit__(exc_type, exc_val, exc_tb)
    
    async def register_client(self, additional_scopes: Optional[List[str]] = None) -> ClientCredentials:
        """
        Register a new OAuth client with ForgeRock.
        
        Args:
            additional_scopes: Optional list of additional scopes to request beyond default
        
        Returns:
            ClientCredentials: The registered client credentials
        """
        if not self._client_registration:
            raise RuntimeError("OAuthAuthenticationManager must be used as async context manager")
        
        self._registered_credentials = await self._client_registration.register_client(additional_scopes)
        logger.info(f"Successfully registered OAuth client: {self._registered_credentials.client_id}")
        return self._registered_credentials
    
    async def delete_client(self, client_credentials: Optional[ClientCredentials] = None) -> bool:
        """
        Delete a dynamically registered OAuth client.
        
        Args:
            client_credentials: Optional client credentials. If not provided, uses registered credentials.
            
        Returns:
            bool: True if deletion was successful
            
        Raises:
            ValueError: If no credentials available or missing registration_access_token
            RuntimeError: If manager not properly initialized
        """
        if not self._client_registration:
            raise RuntimeError("OAuthAuthenticationManager must be used as async context manager")
        
        credentials = client_credentials or self._registered_credentials
        if not credentials:
            raise ValueError("No client credentials available to delete")
        
        result = await self._client_registration.delete_client(credentials)
        
        # Clear registered credentials if we just deleted them
        if credentials == self._registered_credentials:
            self._registered_credentials = None
            self._token_manager.clear_cached_token()
        
        return result
    
    async def get_client_credentials_token(self, client_credentials: ClientCredentials = None, 
                                         additional_scopes: Optional[List[str]] = None) -> AccessToken:
        """
        Obtain an access token using client credentials flow for agent authentication.
        
        Args:
            client_credentials: Optional client credentials. If not provided, uses registered credentials.
            additional_scopes: Optional list of additional scopes to request beyond default
            
        Returns:
            AccessToken: The obtained access token for the agent
        """
        if not self._token_manager:
            raise RuntimeError("OAuthAuthenticationManager must be used as async context manager")
        
        credentials = client_credentials or self._registered_credentials
        if not credentials:
            raise ValueError("No client credentials available. Register client first.")
        
        return await self._token_manager.get_valid_token(credentials, additional_scopes)
    
    async def refresh_token(self, refresh_token: str) -> AccessToken:
        """
        Refresh an expired access token.
        
        Note: ForgeRock client credentials flow doesn't use refresh tokens.
        This method is included for interface compatibility.
        
        Args:
            refresh_token: The refresh token (not used in client credentials flow)
            
        Returns:
            AccessToken: A new access token
        """
        if not self._registered_credentials:
            raise ValueError("No client credentials available. Register client first.")
        
        # For client credentials flow, we just get a new token
        return await self.get_client_credentials_token()
    
    def generate_user_authorization_url(self, scope: str, session_id: str, mcp_server_id: str) -> str:
        """
        Generate authorization URL for user authorization when requested by MCP server.
        
        Args:
            scope: The OAuth scope requested by the MCP server
            session_id: The user session ID
            mcp_server_id: The ID of the MCP server requesting authorization
            
        Returns:
            str: The authorization URL for the user to visit
        """
        if not self._user_auth_facilitator or not self._registered_credentials:
            raise RuntimeError("OAuth manager not properly initialized")
        
        return self._user_auth_facilitator.generate_authorization_url(
            client_id=self._registered_credentials.client_id,
            scope=scope,
            session_id=session_id,
            mcp_server_id=mcp_server_id
        )
    
    def handle_user_authorization_callback(self, auth_code: str, state: str) -> Dict[str, Any]:
        """
        Handle authorization callback and prepare data for MCP server.
        
        Args:
            auth_code: The authorization code from the callback
            state: The state parameter from the callback
            
        Returns:
            Dict containing authorization info for the MCP server
        """
        if not self._user_auth_facilitator:
            raise RuntimeError("OAuthAuthenticationManager must be used as async context manager")
        
        return self._user_auth_facilitator.handle_authorization_callback(auth_code, state)
    
    def validate_authorization_state(self, state: str, session_id: str) -> bool:
        """
        Validate state parameter for CSRF protection.
        
        Args:
            state: The state parameter to validate
            session_id: The expected session ID
            
        Returns:
            bool: True if state is valid, False otherwise
        """
        if not self._user_auth_facilitator:
            raise RuntimeError("OAuthAuthenticationManager must be used as async context manager")
        
        return self._user_auth_facilitator.validate_state(state, session_id)
    
    def get_pending_authorization_info(self, state: str) -> Optional[Dict[str, Any]]:
        """
        Get information about a pending authorization request.
        
        Args:
            state: The state parameter
            
        Returns:
            Dict with authorization info or None if not found
        """
        if not self._user_auth_facilitator:
            raise RuntimeError("OAuthAuthenticationManager must be used as async context manager")
        
        return self._user_auth_facilitator.get_pending_authorization_info(state)
    
    # Legacy interface compatibility methods (deprecated)
    async def generate_authorization_url(self, client_id: str, scope: str, state: str) -> str:
        """Legacy method for interface compatibility."""
        logger.warning("generate_authorization_url is deprecated, use generate_user_authorization_url")
        return self.generate_user_authorization_url(scope, state, "unknown_mcp_server")
    
    def cleanup_expired_states(self) -> None:
        """Clean up expired authorization requests."""
        if self._user_auth_facilitator:
            self._user_auth_facilitator.cleanup_expired_authorizations()
    
    def clear_cached_token(self) -> None:
        """Clear any cached agent tokens."""
        if self._token_manager:
            self._token_manager.clear_cached_token()
    
    @property
    def registered_credentials(self) -> Optional[ClientCredentials]:
        """Get the currently registered client credentials."""
        return self._registered_credentials