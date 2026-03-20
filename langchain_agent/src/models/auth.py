"""
Authentication data models.
"""
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional
import re
from enum import Enum


class TokenType(Enum):
    """Supported OAuth token types"""
    BEARER = "Bearer"
    MAC = "MAC"


@dataclass
class ClientCredentials:
    """OAuth client credentials for dynamic client registration"""
    client_id: str
    client_secret: str
    registration_access_token: str
    expires_at: datetime
    
    def __post_init__(self):
        """Validate client credentials after initialization"""
        self.validate()
    
    def validate(self) -> None:
        """Validate client credentials format and expiration"""
        if not self.client_id or not isinstance(self.client_id, str):
            raise ValueError("client_id must be a non-empty string")
        
        if not self.client_secret or not isinstance(self.client_secret, str):
            raise ValueError("client_secret must be a non-empty string")
        
        if not self.registration_access_token or not isinstance(self.registration_access_token, str):
            raise ValueError("registration_access_token must be a non-empty string")
        
        if not isinstance(self.expires_at, datetime):
            raise ValueError("expires_at must be a datetime object")
    
    def is_expired(self) -> bool:
        """Check if client credentials are expired"""
        return datetime.now(timezone.utc) >= self.expires_at
    
    def expires_in_seconds(self) -> int:
        """Get seconds until expiration (negative if expired)"""
        delta = self.expires_at - datetime.now(timezone.utc)
        return int(delta.total_seconds())


@dataclass
class AccessToken:
    """OAuth access token with metadata"""
    token: str
    token_type: str
    expires_in: int
    scope: str
    issued_at: datetime
    
    def __post_init__(self):
        """Validate access token after initialization"""
        self.validate()
    
    def validate(self) -> None:
        """Validate access token format and values"""
        if not self.token or not isinstance(self.token, str):
            raise ValueError("token must be a non-empty string")
        
        # Validate token format (basic JWT or opaque token pattern)
        if not re.match(r'^[A-Za-z0-9\-_\.]+$', self.token):
            raise ValueError("token contains invalid characters")
        
        if not self.token_type or not isinstance(self.token_type, str):
            raise ValueError("token_type must be a non-empty string")
        
        # Normalize token type to proper case
        if self.token_type.lower() == "bearer":
            self.token_type = TokenType.BEARER.value
        
        if not isinstance(self.expires_in, int) or self.expires_in <= 0:
            raise ValueError("expires_in must be a positive integer")
        
        if not self.scope or not isinstance(self.scope, str):
            raise ValueError("scope must be a non-empty string")
        
        if not isinstance(self.issued_at, datetime):
            raise ValueError("issued_at must be a datetime object")
    
    def is_expired(self) -> bool:
        """Check if access token is expired"""
        expiry_time = self.issued_at + timedelta(seconds=self.expires_in)
        return datetime.now(timezone.utc) >= expiry_time
    
    def expires_at(self) -> datetime:
        """Get the exact expiration datetime"""
        return self.issued_at + timedelta(seconds=self.expires_in)
    
    def expires_in_seconds(self) -> int:
        """Get seconds until expiration (negative if expired)"""
        expiry_time = self.expires_at()
        delta = expiry_time - datetime.now(timezone.utc)
        return int(delta.total_seconds())
    
    def authorization_header(self) -> str:
        """Get the Authorization header value"""
        return f"{self.token_type} {self.token}"



@dataclass
class AuthorizationCode:
    """OAuth authorization code for user authorization flow"""
    code: str
    state: str
    session_id: str
    expires_at: datetime
    
    def __post_init__(self):
        """Validate authorization code after initialization"""
        self.validate()
    
    def validate(self) -> None:
        """Validate authorization code format and expiration"""
        if not self.code or not isinstance(self.code, str):
            raise ValueError("code must be a non-empty string")
        
        # Validate code format (alphanumeric with some special chars)
        if not re.match(r'^[A-Za-z0-9\-_\.]+$', self.code):
            raise ValueError("code contains invalid characters")
        
        if not self.state or not isinstance(self.state, str):
            raise ValueError("state must be a non-empty string")
        
        # Validate state format (should be URL-safe)
        if not re.match(r'^[A-Za-z0-9\-_\.]+$', self.state):
            raise ValueError("state contains invalid characters")
        
        if not self.session_id or not isinstance(self.session_id, str):
            raise ValueError("session_id must be a non-empty string")
        
        if not isinstance(self.expires_at, datetime):
            raise ValueError("expires_at must be a datetime object")
    
    def is_expired(self) -> bool:
        """Check if authorization code is expired"""
        return datetime.now(timezone.utc) >= self.expires_at
    
    def expires_in_seconds(self) -> int:
        """Get seconds until expiration (negative if expired)"""
        delta = self.expires_at - datetime.now(timezone.utc)
        return int(delta.total_seconds())


@dataclass
class AgentTokenContext:
    """Context for agent token usage in sessions"""
    agent_token: AccessToken
    session_id: str
    
    def __post_init__(self):
        """Validate agent token context after initialization"""
        self.validate()
    
    def validate(self) -> None:
        """Validate agent token context"""
        if not isinstance(self.agent_token, AccessToken):
            raise ValueError("agent_token must be an AccessToken instance")
        
        if not self.session_id or not isinstance(self.session_id, str):
            raise ValueError("session_id must be a non-empty string")
        
        # Validate that the agent token itself is valid
        self.agent_token.validate()
    
    def is_token_expired(self) -> bool:
        """Check if the agent token is expired"""
        return self.agent_token.is_expired()