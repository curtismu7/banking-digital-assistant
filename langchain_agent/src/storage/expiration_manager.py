"""Expiration manager for automatic token cleanup."""

import asyncio
import logging
from typing import Optional, Callable, Awaitable, Set, Dict
from datetime import datetime, timezone, timedelta

from .token_cache import TokenCache
from .secure_storage import SecureStorage


logger = logging.getLogger(__name__)


class ExpirationManager:
    """Manages automatic cleanup of expired tokens from cache and storage."""
    
    def __init__(
        self,
        token_cache: Optional[TokenCache] = None,
        secure_storage: Optional[SecureStorage] = None,
        cleanup_interval_seconds: int = 300,  # 5 minutes
        storage_cleanup_interval_seconds: int = 3600  # 1 hour
    ):
        """
        Initialize expiration manager.
        
        Args:
            token_cache: Token cache instance to manage
            secure_storage: Secure storage instance to manage
            cleanup_interval_seconds: How often to clean up cache (seconds)
            storage_cleanup_interval_seconds: How often to clean up storage (seconds)
        """
        self.token_cache = token_cache
        self.secure_storage = secure_storage
        self.cleanup_interval_seconds = cleanup_interval_seconds
        self.storage_cleanup_interval_seconds = storage_cleanup_interval_seconds
        
        self._cleanup_task: Optional[asyncio.Task] = None
        self._storage_cleanup_task: Optional[asyncio.Task] = None
        self._running = False
        self._cleanup_callbacks: Set[Callable[[str, str], Awaitable[None]]] = set()
    
    def add_cleanup_callback(self, callback: Callable[[str, str], Awaitable[None]]) -> None:
        """
        Add a callback to be called when items are cleaned up.
        
        Args:
            callback: Async function that takes (item_type, key) parameters
                     item_type will be "cache" or "storage"
        """
        self._cleanup_callbacks.add(callback)
    
    def remove_cleanup_callback(self, callback: Callable[[str, str], Awaitable[None]]) -> None:
        """Remove a cleanup callback."""
        self._cleanup_callbacks.discard(callback)
    
    async def start(self) -> None:
        """Start the expiration manager background tasks."""
        if self._running:
            logger.warning("ExpirationManager is already running")
            return
        
        self._running = True
        
        # Start cache cleanup task if cache is provided
        if self.token_cache:
            self._cleanup_task = asyncio.create_task(self._cache_cleanup_loop())
            logger.info(f"Started cache cleanup task with {self.cleanup_interval_seconds}s interval")
        
        # Start storage cleanup task if storage is provided
        if self.secure_storage:
            self._storage_cleanup_task = asyncio.create_task(self._storage_cleanup_loop())
            logger.info(f"Started storage cleanup task with {self.storage_cleanup_interval_seconds}s interval")
    
    async def stop(self) -> None:
        """Stop the expiration manager background tasks."""
        if not self._running:
            return
        
        self._running = False
        
        # Cancel and wait for cleanup tasks
        tasks_to_cancel = []
        
        if self._cleanup_task:
            tasks_to_cancel.append(self._cleanup_task)
        
        if self._storage_cleanup_task:
            tasks_to_cancel.append(self._storage_cleanup_task)
        
        for task in tasks_to_cancel:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
        
        self._cleanup_task = None
        self._storage_cleanup_task = None
        
        logger.info("ExpirationManager stopped")
    
    async def cleanup_now(self) -> Dict[str, int]:
        """
        Perform immediate cleanup of both cache and storage.
        
        Returns:
            Dictionary with cleanup statistics
        """
        results = {}
        
        if self.token_cache:
            cache_cleaned = await self._cleanup_cache()
            results["cache_cleaned"] = cache_cleaned
        
        if self.secure_storage:
            storage_cleaned = await self._cleanup_storage()
            results["storage_cleaned"] = storage_cleaned
        
        return results
    
    async def _cache_cleanup_loop(self) -> None:
        """Background task for cache cleanup."""
        while self._running:
            try:
                await asyncio.sleep(self.cleanup_interval_seconds)
                
                if not self._running:
                    break
                
                await self._cleanup_cache()
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in cache cleanup loop: {e}")
                # Continue running even if cleanup fails
    
    async def _storage_cleanup_loop(self) -> None:
        """Background task for storage cleanup."""
        while self._running:
            try:
                await asyncio.sleep(self.storage_cleanup_interval_seconds)
                
                if not self._running:
                    break
                
                await self._cleanup_storage()
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error in storage cleanup loop: {e}")
                # Continue running even if cleanup fails
    
    async def _cleanup_cache(self) -> int:
        """Clean up expired entries from cache."""
        if not self.token_cache:
            return 0
        
        try:
            # Get list of keys before cleanup to notify callbacks
            stats = await self.token_cache.get_stats()
            expired_count_before = stats.get("expired_entries", 0)
            
            # Perform cleanup
            cleaned_count = await self.token_cache.cleanup_expired()
            
            if cleaned_count > 0:
                logger.info(f"Cleaned up {cleaned_count} expired cache entries")
                
                # Notify callbacks (we don't have specific keys, so use generic notification)
                for callback in self._cleanup_callbacks:
                    try:
                        await callback("cache", f"expired_entries_{cleaned_count}")
                    except Exception as e:
                        logger.error(f"Error in cleanup callback: {e}")
            
            return cleaned_count
            
        except Exception as e:
            logger.error(f"Error cleaning up cache: {e}")
            return 0
    
    async def _cleanup_storage(self) -> int:
        """Clean up expired entries from storage."""
        if not self.secure_storage:
            return 0
        
        try:
            # This is a simplified cleanup - in a real implementation,
            # you might want to check token expiration dates stored in the data
            # For now, we'll just log that storage cleanup was attempted
            
            keys = await self.secure_storage.list_keys()
            cleaned_count = 0
            
            # Check each stored item for expiration
            for key in keys:
                try:
                    data = await self.secure_storage.retrieve(key)
                    if data and self._is_token_expired(data):
                        await self.secure_storage.delete(key)
                        cleaned_count += 1
                        
                        # Notify callbacks
                        for callback in self._cleanup_callbacks:
                            try:
                                await callback("storage", key)
                            except Exception as e:
                                logger.error(f"Error in cleanup callback: {e}")
                
                except Exception as e:
                    logger.error(f"Error checking expiration for storage key '{key}': {e}")
            
            if cleaned_count > 0:
                logger.info(f"Cleaned up {cleaned_count} expired storage entries")
            
            return cleaned_count
            
        except Exception as e:
            logger.error(f"Error cleaning up storage: {e}")
            return 0
    
    def _is_token_expired(self, token_data: dict) -> bool:
        """
        Check if token data indicates expiration.
        
        Args:
            token_data: Token data dictionary
            
        Returns:
            True if token is expired, False otherwise
        """
        try:
            # Check for expires_at field
            if "expires_at" in token_data:
                expires_at_str = token_data["expires_at"]
                expires_at = datetime.fromisoformat(expires_at_str.replace('Z', '+00:00'))
                return datetime.now(timezone.utc) >= expires_at
            
            # Check for expires_in field with issued_at
            if "expires_in" in token_data and "issued_at" in token_data:
                issued_at_str = token_data["issued_at"]
                issued_at = datetime.fromisoformat(issued_at_str.replace('Z', '+00:00'))
                expires_in_seconds = token_data["expires_in"]
                expires_at = issued_at + timedelta(seconds=expires_in_seconds)
                return datetime.now(timezone.utc) >= expires_at
            
            # If no expiration info, assume not expired
            return False
            
        except Exception as e:
            logger.error(f"Error checking token expiration: {e}")
            # If we can't determine expiration, assume not expired to be safe
            return False
    
    async def __aenter__(self):
        """Async context manager entry."""
        await self.start()
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Async context manager exit."""
        await self.stop()