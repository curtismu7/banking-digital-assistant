"""Graceful degradation utilities for handling service unavailability."""

import asyncio
from typing import Optional, Dict, Any, Callable, TypeVar, List
from datetime import datetime, timedelta
from enum import Enum
import logging

from .base_errors import RetryableError, NonRetryableError
from .authentication_errors import AuthenticationError
from .mcp_errors import MCPError, MCPServerUnavailableError

T = TypeVar('T')

logger = logging.getLogger(__name__)


class ServiceStatus(Enum):
    """Service availability status."""
    AVAILABLE = "available"
    DEGRADED = "degraded"
    UNAVAILABLE = "unavailable"


class CircuitBreakerState(Enum):
    """Circuit breaker states."""
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Failing, reject requests
    HALF_OPEN = "half_open"  # Testing if service recovered


class CircuitBreaker:
    """Circuit breaker pattern implementation for service calls."""
    
    def __init__(
        self,
        failure_threshold: int = 5,
        recovery_timeout: int = 60,
        expected_exception: type = Exception
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.expected_exception = expected_exception
        
        self.failure_count = 0
        self.last_failure_time: Optional[datetime] = None
        self.state = CircuitBreakerState.CLOSED
    
    async def call(self, func: Callable[..., T], *args, **kwargs) -> T:
        """Execute function with circuit breaker protection."""
        if self.state == CircuitBreakerState.OPEN:
            if self._should_attempt_reset():
                self.state = CircuitBreakerState.HALF_OPEN
            else:
                raise MCPServerUnavailableError(
                    f"Circuit breaker is OPEN. Service unavailable.",
                    details={'failure_count': self.failure_count}
                )
        
        try:
            result = await func(*args, **kwargs)
            self._on_success()
            return result
        except self.expected_exception as e:
            self._on_failure()
            raise
    
    def _should_attempt_reset(self) -> bool:
        """Check if enough time has passed to attempt reset."""
        if not self.last_failure_time:
            return True
        
        return (
            datetime.utcnow() - self.last_failure_time
        ).total_seconds() > self.recovery_timeout
    
    def _on_success(self) -> None:
        """Handle successful call."""
        self.failure_count = 0
        self.state = CircuitBreakerState.CLOSED
    
    def _on_failure(self) -> None:
        """Handle failed call."""
        self.failure_count += 1
        self.last_failure_time = datetime.utcnow()
        
        if self.failure_count >= self.failure_threshold:
            self.state = CircuitBreakerState.OPEN


class GracefulDegradationManager:
    """Manages graceful degradation for various services."""
    
    def __init__(self):
        self.service_status: Dict[str, ServiceStatus] = {}
        self.circuit_breakers: Dict[str, CircuitBreaker] = {}
        self.fallback_handlers: Dict[str, Callable] = {}
        self.service_health_checks: Dict[str, datetime] = {}
    
    def register_service(
        self,
        service_name: str,
        circuit_breaker_config: Optional[Dict[str, Any]] = None,
        fallback_handler: Optional[Callable] = None
    ) -> None:
        """Register a service for degradation management."""
        self.service_status[service_name] = ServiceStatus.AVAILABLE
        
        # Create circuit breaker with custom config
        cb_config = circuit_breaker_config or {}
        self.circuit_breakers[service_name] = CircuitBreaker(**cb_config)
        
        if fallback_handler:
            self.fallback_handlers[service_name] = fallback_handler
    
    async def call_service(
        self,
        service_name: str,
        func: Callable[..., T],
        *args,
        **kwargs
    ) -> T:
        """Call service with graceful degradation."""
        if service_name not in self.circuit_breakers:
            raise ValueError(f"Service {service_name} not registered")
        
        circuit_breaker = self.circuit_breakers[service_name]
        
        try:
            result = await circuit_breaker.call(func, *args, **kwargs)
            self._update_service_status(service_name, ServiceStatus.AVAILABLE)
            return result
            
        except (RetryableError, MCPError) as e:
            logger.warning(f"Service {service_name} failed: {e}")
            self._update_service_status(service_name, ServiceStatus.DEGRADED)
            
            # Try fallback if available
            if service_name in self.fallback_handlers:
                logger.info(f"Using fallback for service {service_name}")
                return await self.fallback_handlers[service_name](*args, **kwargs)
            
            raise
            
        except NonRetryableError as e:
            logger.error(f"Non-retryable error in service {service_name}: {e}")
            self._update_service_status(service_name, ServiceStatus.UNAVAILABLE)
            raise
    
    def _update_service_status(
        self,
        service_name: str,
        status: ServiceStatus
    ) -> None:
        """Update service status and log changes."""
        old_status = self.service_status.get(service_name)
        if old_status != status:
            logger.info(
                f"Service {service_name} status changed: {old_status} -> {status}"
            )
            self.service_status[service_name] = status
            self.service_health_checks[service_name] = datetime.utcnow()
    
    def get_service_status(self, service_name: str) -> ServiceStatus:
        """Get current service status."""
        return self.service_status.get(service_name, ServiceStatus.UNAVAILABLE)
    
    def get_system_health(self) -> Dict[str, Any]:
        """Get overall system health status."""
        total_services = len(self.service_status)
        if total_services == 0:
            return {'status': 'unknown', 'services': {}}
        
        available_count = sum(
            1 for status in self.service_status.values()
            if status == ServiceStatus.AVAILABLE
        )
        degraded_count = sum(
            1 for status in self.service_status.values()
            if status == ServiceStatus.DEGRADED
        )
        
        # Determine overall system status
        if available_count == total_services:
            overall_status = 'healthy'
        elif available_count + degraded_count == total_services:
            overall_status = 'degraded'
        else:
            overall_status = 'unhealthy'
        
        return {
            'status': overall_status,
            'services': dict(self.service_status),
            'summary': {
                'total': total_services,
                'available': available_count,
                'degraded': degraded_count,
                'unavailable': total_services - available_count - degraded_count
            }
        }


class RetryHandler:
    """Handles retry logic with exponential backoff."""
    
    @staticmethod
    async def retry_with_backoff(
        func: Callable[..., T],
        max_retries: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 60.0,
        backoff_factor: float = 2.0,
        retryable_exceptions: tuple = (RetryableError,),
        *args,
        **kwargs
    ) -> T:
        """Retry function with exponential backoff."""
        last_exception = None
        
        for attempt in range(max_retries + 1):
            try:
                return await func(*args, **kwargs)
            except retryable_exceptions as e:
                last_exception = e
                
                if attempt == max_retries:
                    logger.error(f"Max retries ({max_retries}) exceeded for {func.__name__}")
                    break
                
                # Calculate delay with exponential backoff
                delay = min(base_delay * (backoff_factor ** attempt), max_delay)
                
                logger.warning(
                    f"Attempt {attempt + 1} failed for {func.__name__}: {e}. "
                    f"Retrying in {delay:.2f} seconds..."
                )
                
                await asyncio.sleep(delay)
            except Exception as e:
                # Non-retryable exception
                logger.error(f"Non-retryable error in {func.__name__}: {e}")
                raise
        
        # If we get here, all retries failed
        raise last_exception