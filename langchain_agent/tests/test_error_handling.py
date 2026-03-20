"""Tests for error handling classes and graceful degradation."""

import pytest
import asyncio
from datetime import datetime, timedelta
from unittest.mock import Mock, AsyncMock

from src.errors import (
    BaseAgentError,
    RetryableError,
    NonRetryableError,
    ConfigurationError,
    ValidationError,
    AuthenticationError,
    ClientRegistrationError,
    TokenAcquisitionError,
    TokenRefreshError,
    AuthorizationError,
    InvalidTokenError,
    TokenExpiredError,
    MCPError,
    MCPConnectionError,
    MCPServerUnavailableError,
    MCPToolExecutionError,
    MCPAuthenticationChallengeError,
    MCPToolNotFoundError,
    MCPTimeoutError
)

from src.errors.graceful_degradation import (
    CircuitBreaker,
    CircuitBreakerState,
    GracefulDegradationManager,
    ServiceStatus,
    RetryHandler
)


class TestBaseErrors:
    """Test base error classes."""
    
    def test_base_agent_error_creation(self):
        """Test BaseAgentError creation and serialization."""
        error = BaseAgentError(
            message="Test error",
            error_code="TEST_ERROR",
            details={"key": "value"},
            cause=ValueError("Original error")
        )
        
        assert error.message == "Test error"
        assert error.error_code == "TEST_ERROR"
        assert error.details == {"key": "value"}
        assert isinstance(error.cause, ValueError)
        assert isinstance(error.timestamp, datetime)
        
        # Test serialization
        error_dict = error.to_dict()
        assert error_dict['error_type'] == 'BaseAgentError'
        assert error_dict['error_code'] == 'TEST_ERROR'
        assert error_dict['message'] == 'Test error'
        assert error_dict['details'] == {"key": "value"}
        assert 'timestamp' in error_dict
        assert error_dict['cause'] == "Original error"
    
    def test_retryable_error_retry_logic(self):
        """Test RetryableError retry logic."""
        error = RetryableError(
            message="Retryable error",
            retry_after=5,
            max_retries=3
        )
        
        assert error.can_retry() is True
        assert error.retry_count == 0
        assert error.retry_after == 5
        assert error.max_retries == 3
        
        # Test retry counting
        error.increment_retry()
        assert error.retry_count == 1
        assert error.can_retry() is True
        
        error.increment_retry()
        error.increment_retry()
        assert error.retry_count == 3
        assert error.can_retry() is False
    
    def test_non_retryable_error(self):
        """Test NonRetryableError."""
        error = NonRetryableError("Non-retryable error")
        assert error.message == "Non-retryable error"
        assert isinstance(error, BaseAgentError)


class TestAuthenticationErrors:
    """Test authentication error classes."""
    
    def test_client_registration_error(self):
        """Test ClientRegistrationError."""
        error = ClientRegistrationError(
            message="Registration failed",
            status_code=400,
            response_body="Invalid request"
        )
        
        assert error.status_code == 400
        assert error.response_body == "Invalid request"
        assert error.details['status_code'] == 400
        assert error.details['has_response_body'] is True
        assert error.can_retry() is True
    
    def test_token_acquisition_error(self):
        """Test TokenAcquisitionError."""
        error = TokenAcquisitionError(
            message="Token acquisition failed",
            grant_type="client_credentials",
            status_code=401,
            error_description="Invalid client"
        )
        
        assert error.grant_type == "client_credentials"
        assert error.status_code == 401
        assert error.error_description == "Invalid client"
        assert error.details['grant_type'] == "client_credentials"
    
    def test_token_expired_error(self):
        """Test TokenExpiredError."""
        expired_time = "2023-01-01T00:00:00Z"
        error = TokenExpiredError(
            message="Token expired",
            token_type="access_token",
            expired_at=expired_time
        )
        
        assert error.token_type == "access_token"
        assert error.expired_at == expired_time
        assert error.details['token_type'] == "access_token"
        assert error.details['expired_at'] == expired_time
        assert error.can_retry() is True
    
    def test_authorization_error(self):
        """Test AuthorizationError."""
        error = AuthorizationError(
            message="Authorization failed",
            error_code="access_denied",
            state="test_state"
        )
        
        assert error.state == "test_state"
        assert error.details['state'] == "test_state"
        assert isinstance(error, NonRetryableError)


class TestMCPErrors:
    """Test MCP error classes."""
    
    def test_mcp_connection_error(self):
        """Test MCPConnectionError."""
        error = MCPConnectionError(
            message="Connection failed",
            server_name="test_server",
            endpoint="http://localhost:8080",
            connection_timeout=30
        )
        
        assert error.server_name == "test_server"
        assert error.endpoint == "http://localhost:8080"
        assert error.connection_timeout == 30
        assert error.details['server_name'] == "test_server"
        assert error.can_retry() is True
    
    def test_mcp_tool_execution_error(self):
        """Test MCPToolExecutionError."""
        error = MCPToolExecutionError(
            message="Tool execution failed",
            tool_name="test_tool",
            server_name="test_server",
            execution_id="exec_123"
        )
        
        assert error.tool_name == "test_tool"
        assert error.server_name == "test_server"
        assert error.execution_id == "exec_123"
        assert error.details['tool_name'] == "test_tool"
    
    def test_mcp_authentication_challenge_error(self):
        """Test MCPAuthenticationChallengeError."""
        error = MCPAuthenticationChallengeError(
            message="Auth challenge failed",
            challenge_type="oauth_authorization_code",
            server_name="test_server",
            required_scopes=["read", "write"]
        )
        
        assert error.challenge_type == "oauth_authorization_code"
        assert error.server_name == "test_server"
        assert error.required_scopes == ["read", "write"]
        assert error.details['required_scopes'] == ["read", "write"]
        assert isinstance(error, NonRetryableError)
    
    def test_mcp_tool_not_found_error(self):
        """Test MCPToolNotFoundError."""
        error = MCPToolNotFoundError(
            message="Tool not found",
            tool_name="missing_tool",
            server_name="test_server",
            available_tools=["tool1", "tool2"]
        )
        
        assert error.tool_name == "missing_tool"
        assert error.available_tools == ["tool1", "tool2"]
        assert error.details['available_tools_count'] == 2


class TestCircuitBreaker:
    """Test CircuitBreaker functionality."""
    
    @pytest.fixture
    def circuit_breaker(self):
        """Create a circuit breaker for testing."""
        return CircuitBreaker(
            failure_threshold=3,
            recovery_timeout=5,
            expected_exception=Exception
        )
    
    @pytest.mark.asyncio
    async def test_circuit_breaker_success(self, circuit_breaker):
        """Test circuit breaker with successful calls."""
        async def success_func():
            return "success"
        
        result = await circuit_breaker.call(success_func)
        assert result == "success"
        assert circuit_breaker.state == CircuitBreakerState.CLOSED
        assert circuit_breaker.failure_count == 0
    
    @pytest.mark.asyncio
    async def test_circuit_breaker_failure_threshold(self, circuit_breaker):
        """Test circuit breaker opening after failure threshold."""
        async def failing_func():
            raise Exception("Test failure")
        
        # Fail up to threshold
        for i in range(3):
            with pytest.raises(Exception):
                await circuit_breaker.call(failing_func)
            assert circuit_breaker.failure_count == i + 1
        
        # Circuit should be open now
        assert circuit_breaker.state == CircuitBreakerState.OPEN
        
        # Next call should fail immediately
        with pytest.raises(MCPServerUnavailableError):
            await circuit_breaker.call(failing_func)
    
    @pytest.mark.asyncio
    async def test_circuit_breaker_recovery(self, circuit_breaker):
        """Test circuit breaker recovery after timeout."""
        async def failing_func():
            raise Exception("Test failure")
        
        async def success_func():
            return "recovered"
        
        # Trip the circuit breaker
        for _ in range(3):
            with pytest.raises(Exception):
                await circuit_breaker.call(failing_func)
        
        assert circuit_breaker.state == CircuitBreakerState.OPEN
        
        # Simulate time passing
        circuit_breaker.last_failure_time = datetime.utcnow() - timedelta(seconds=10)
        
        # Should attempt recovery
        result = await circuit_breaker.call(success_func)
        assert result == "recovered"
        assert circuit_breaker.state == CircuitBreakerState.CLOSED
        assert circuit_breaker.failure_count == 0


class TestGracefulDegradationManager:
    """Test GracefulDegradationManager functionality."""
    
    @pytest.fixture
    def degradation_manager(self):
        """Create a degradation manager for testing."""
        return GracefulDegradationManager()
    
    def test_service_registration(self, degradation_manager):
        """Test service registration."""
        async def fallback_handler():
            return "fallback"
        
        degradation_manager.register_service(
            "test_service",
            circuit_breaker_config={"failure_threshold": 2},
            fallback_handler=fallback_handler
        )
        
        assert "test_service" in degradation_manager.service_status
        assert degradation_manager.service_status["test_service"] == ServiceStatus.AVAILABLE
        assert "test_service" in degradation_manager.circuit_breakers
        assert "test_service" in degradation_manager.fallback_handlers
    
    @pytest.mark.asyncio
    async def test_successful_service_call(self, degradation_manager):
        """Test successful service call."""
        degradation_manager.register_service("test_service")
        
        async def success_func():
            return "success"
        
        result = await degradation_manager.call_service("test_service", success_func)
        assert result == "success"
        assert degradation_manager.get_service_status("test_service") == ServiceStatus.AVAILABLE
    
    @pytest.mark.asyncio
    async def test_service_call_with_fallback(self, degradation_manager):
        """Test service call with fallback handler."""
        async def fallback_handler():
            return "fallback_result"
        
        degradation_manager.register_service(
            "test_service",
            fallback_handler=fallback_handler
        )
        
        async def failing_func():
            raise MCPConnectionError("Connection failed")
        
        result = await degradation_manager.call_service("test_service", failing_func)
        assert result == "fallback_result"
        assert degradation_manager.get_service_status("test_service") == ServiceStatus.DEGRADED
    
    def test_system_health_reporting(self, degradation_manager):
        """Test system health reporting."""
        degradation_manager.register_service("service1")
        degradation_manager.register_service("service2")
        degradation_manager.register_service("service3")
        
        # Set different statuses
        degradation_manager.service_status["service1"] = ServiceStatus.AVAILABLE
        degradation_manager.service_status["service2"] = ServiceStatus.DEGRADED
        degradation_manager.service_status["service3"] = ServiceStatus.UNAVAILABLE
        
        health = degradation_manager.get_system_health()
        
        assert health['status'] == 'unhealthy'
        assert health['summary']['total'] == 3
        assert health['summary']['available'] == 1
        assert health['summary']['degraded'] == 1
        assert health['summary']['unavailable'] == 1


class TestRetryHandler:
    """Test RetryHandler functionality."""
    
    @pytest.mark.asyncio
    async def test_successful_retry(self):
        """Test successful function call without retries."""
        async def success_func():
            return "success"
        
        result = await RetryHandler.retry_with_backoff(success_func)
        assert result == "success"
    
    @pytest.mark.asyncio
    async def test_retry_with_eventual_success(self):
        """Test retry with eventual success."""
        call_count = 0
        
        async def eventually_success_func():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise RetryableError("Temporary failure")
            return "success"
        
        result = await RetryHandler.retry_with_backoff(
            eventually_success_func,
            max_retries=3,
            base_delay=0.01  # Fast for testing
        )
        assert result == "success"
        assert call_count == 3
    
    @pytest.mark.asyncio
    async def test_retry_exhaustion(self):
        """Test retry exhaustion."""
        async def always_fail_func():
            raise RetryableError("Always fails")
        
        with pytest.raises(RetryableError):
            await RetryHandler.retry_with_backoff(
                always_fail_func,
                max_retries=2,
                base_delay=0.01
            )
    
    @pytest.mark.asyncio
    async def test_non_retryable_exception(self):
        """Test non-retryable exception handling."""
        async def non_retryable_fail_func():
            raise NonRetryableError("Non-retryable failure")
        
        with pytest.raises(NonRetryableError):
            await RetryHandler.retry_with_backoff(
                non_retryable_fail_func,
                max_retries=3,
                base_delay=0.01
            )