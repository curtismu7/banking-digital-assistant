"""Unit tests for storage components."""

import os
import asyncio
import tempfile
import shutil
from pathlib import Path
from datetime import datetime, timezone, timedelta
from unittest.mock import patch, MagicMock, AsyncMock
import pytest

from src.storage.secure_storage import SecureStorage, SecureStorageError
from src.storage.token_cache import TokenCache, CacheEntry
from src.storage.expiration_manager import ExpirationManager
from src.security.encryption import EncryptionManager


class TestSecureStorage:
    """Test cases for SecureStorage class."""
    
    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for testing."""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)
    
    @pytest.fixture
    def encryption_manager(self):
        """Create an encryption manager for testing."""
        return EncryptionManager("test-master-key-12345")
    
    @pytest.fixture
    def secure_storage(self, temp_dir, encryption_manager):
        """Create a SecureStorage instance for testing."""
        return SecureStorage(storage_path=temp_dir, encryption_manager=encryption_manager)
    
    @pytest.mark.asyncio
    async def test_store_and_retrieve_data(self, secure_storage):
        """Test storing and retrieving data."""
        test_data = {
            "access_token": "secret-token-123",
            "refresh_token": "refresh-456",
            "expires_in": 3600
        }
        
        await secure_storage.store("test_key", test_data)
        retrieved_data = await secure_storage.retrieve("test_key")
        
        assert retrieved_data == test_data
    
    @pytest.mark.asyncio
    async def test_retrieve_nonexistent_key(self, secure_storage):
        """Test retrieving data for a key that doesn't exist."""
        result = await secure_storage.retrieve("nonexistent_key")
        assert result is None
    
    @pytest.mark.asyncio
    async def test_delete_data(self, secure_storage):
        """Test deleting stored data."""
        test_data = {"token": "test-token"}
        
        await secure_storage.store("delete_test", test_data)
        assert await secure_storage.exists("delete_test")
        
        deleted = await secure_storage.delete("delete_test")
        assert deleted is True
        assert not await secure_storage.exists("delete_test")
        
        # Try to delete again
        deleted_again = await secure_storage.delete("delete_test")
        assert deleted_again is False
    
    @pytest.mark.asyncio
    async def test_exists_check(self, secure_storage):
        """Test checking if keys exist."""
        test_data = {"token": "test-token"}
        
        assert not await secure_storage.exists("test_exists")
        
        await secure_storage.store("test_exists", test_data)
        assert await secure_storage.exists("test_exists")
    
    @pytest.mark.asyncio
    async def test_list_keys(self, secure_storage):
        """Test listing all stored keys."""
        test_data = {"token": "test-token"}
        
        # Initially empty
        keys = await secure_storage.list_keys()
        assert keys == []
        
        # Add some keys
        await secure_storage.store("key1", test_data)
        await secure_storage.store("key2", test_data)
        await secure_storage.store("key3", test_data)
        
        keys = await secure_storage.list_keys()
        assert set(keys) == {"key1", "key2", "key3"}
    
    @pytest.mark.asyncio
    async def test_clear_all(self, secure_storage):
        """Test clearing all stored data."""
        test_data = {"token": "test-token"}
        
        # Add some data
        await secure_storage.store("clear1", test_data)
        await secure_storage.store("clear2", test_data)
        await secure_storage.store("clear3", test_data)
        
        # Clear all
        count = await secure_storage.clear_all()
        assert count == 3
        
        # Verify empty
        keys = await secure_storage.list_keys()
        assert keys == []
    
    @pytest.mark.asyncio
    async def test_invalid_key_names(self, secure_storage):
        """Test that invalid key names raise errors."""
        test_data = {"token": "test-token"}
        
        invalid_keys = [
            "../malicious",
            "/absolute/path",
            "key with spaces",
            "key/with/slashes",
            ""
        ]
        
        for invalid_key in invalid_keys:
            with pytest.raises(SecureStorageError, match="Invalid storage key"):
                await secure_storage.store(invalid_key, test_data)
    
    @pytest.mark.asyncio
    async def test_concurrent_access(self, secure_storage):
        """Test concurrent access to storage."""
        test_data = {"token": "concurrent-test"}
        
        # Run multiple concurrent operations
        tasks = []
        for i in range(10):
            tasks.append(secure_storage.store(f"concurrent_{i}", {**test_data, "id": i}))
        
        await asyncio.gather(*tasks)
        
        # Verify all data was stored correctly
        for i in range(10):
            data = await secure_storage.retrieve(f"concurrent_{i}")
            assert data["id"] == i
    
    @pytest.mark.asyncio
    async def test_file_permissions(self, secure_storage, temp_dir):
        """Test that stored files have secure permissions."""
        test_data = {"token": "permission-test"}
        
        await secure_storage.store("permission_test", test_data)
        
        file_path = Path(temp_dir) / "permission_test.enc"
        assert file_path.exists()
        
        # Check file permissions (should be 0o600 - read/write for owner only)
        file_stat = file_path.stat()
        permissions = oct(file_stat.st_mode)[-3:]
        assert permissions == "600"


class TestTokenCache:
    """Test cases for TokenCache class."""
    
    @pytest.fixture
    def token_cache(self):
        """Create a TokenCache instance for testing."""
        return TokenCache(default_ttl_seconds=60)  # 1 minute default TTL
    
    @pytest.mark.asyncio
    async def test_set_and_get_data(self, token_cache):
        """Test setting and getting cached data."""
        test_data = {"access_token": "cached-token-123"}
        
        await token_cache.set("test_key", test_data)
        retrieved_data = await token_cache.get("test_key")
        
        assert retrieved_data == test_data
    
    @pytest.mark.asyncio
    async def test_get_nonexistent_key(self, token_cache):
        """Test getting data for a key that doesn't exist."""
        result = await token_cache.get("nonexistent_key")
        assert result is None
    
    @pytest.mark.asyncio
    async def test_data_expiration(self, token_cache):
        """Test that data expires after TTL."""
        test_data = {"token": "expiring-token"}
        
        # Set with very short TTL
        await token_cache.set("expiring_key", test_data, ttl_seconds=1)
        
        # Should be available immediately
        result = await token_cache.get("expiring_key")
        assert result == test_data
        
        # Wait for expiration
        await asyncio.sleep(1.1)
        
        # Should be None after expiration
        result = await token_cache.get("expiring_key")
        assert result is None
    
    @pytest.mark.asyncio
    async def test_delete_data(self, token_cache):
        """Test deleting cached data."""
        test_data = {"token": "delete-test"}
        
        await token_cache.set("delete_key", test_data)
        assert await token_cache.exists("delete_key")
        
        deleted = await token_cache.delete("delete_key")
        assert deleted is True
        assert not await token_cache.exists("delete_key")
        
        # Try to delete again
        deleted_again = await token_cache.delete("delete_key")
        assert deleted_again is False
    
    @pytest.mark.asyncio
    async def test_clear_cache(self, token_cache):
        """Test clearing all cached data."""
        test_data = {"token": "clear-test"}
        
        # Add some data
        await token_cache.set("clear1", test_data)
        await token_cache.set("clear2", test_data)
        await token_cache.set("clear3", test_data)
        
        # Clear all
        count = await token_cache.clear()
        assert count == 3
        
        # Verify empty
        assert not await token_cache.exists("clear1")
        assert not await token_cache.exists("clear2")
        assert not await token_cache.exists("clear3")
    
    @pytest.mark.asyncio
    async def test_cleanup_expired(self, token_cache):
        """Test cleaning up expired entries."""
        test_data = {"token": "cleanup-test"}
        
        # Add data with different TTLs
        await token_cache.set("short_ttl", test_data, ttl_seconds=1)
        await token_cache.set("long_ttl", test_data, ttl_seconds=60)
        
        # Wait for short TTL to expire
        await asyncio.sleep(1.1)
        
        # Cleanup expired entries
        cleaned_count = await token_cache.cleanup_expired()
        assert cleaned_count == 1
        
        # Verify only expired entry was removed
        assert not await token_cache.exists("short_ttl")
        assert await token_cache.exists("long_ttl")
    
    @pytest.mark.asyncio
    async def test_get_stats(self, token_cache):
        """Test getting cache statistics."""
        test_data = {"token": "stats-test"}
        
        # Add some data
        await token_cache.set("stats1", test_data, ttl_seconds=60)
        await token_cache.set("stats2", test_data, ttl_seconds=1)
        
        # Wait for one to expire
        await asyncio.sleep(1.1)
        
        stats = await token_cache.get_stats()
        
        assert stats["total_entries"] == 2
        assert stats["valid_entries"] == 1
        assert stats["expired_entries"] == 1
        assert stats["default_ttl_seconds"] == 60
    
    @pytest.mark.asyncio
    async def test_get_entry_info(self, token_cache):
        """Test getting entry information."""
        test_data = {"token": "info-test"}
        
        await token_cache.set("info_key", test_data, ttl_seconds=60)
        
        info = await token_cache.get_entry_info("info_key")
        
        assert info is not None
        assert "created_at" in info
        assert "expires_at" in info
        assert info["is_expired"] is False
        assert info["ttl_remaining_seconds"] > 0
        
        # Test nonexistent key
        info = await token_cache.get_entry_info("nonexistent")
        assert info is None
    
    @pytest.mark.asyncio
    async def test_data_isolation(self, token_cache):
        """Test that cached data is isolated from external modifications."""
        original_data = {"token": "isolation-test", "mutable_list": [1, 2, 3]}
        
        await token_cache.set("isolation_key", original_data)
        
        # Modify the original data
        original_data["token"] = "modified"
        original_data["mutable_list"].append(4)
        
        # Retrieved data should be unchanged
        retrieved_data = await token_cache.get("isolation_key")
        assert retrieved_data["token"] == "isolation-test"
        assert retrieved_data["mutable_list"] == [1, 2, 3]
        
        # Modify retrieved data
        retrieved_data["token"] = "modified-again"
        retrieved_data["mutable_list"].append(5)
        
        # Get again - should still be original
        retrieved_again = await token_cache.get("isolation_key")
        assert retrieved_again["token"] == "isolation-test"
        assert retrieved_again["mutable_list"] == [1, 2, 3]


class TestExpirationManager:
    """Test cases for ExpirationManager class."""
    
    @pytest.fixture
    def token_cache(self):
        """Create a TokenCache instance for testing."""
        return TokenCache(default_ttl_seconds=60)
    
    @pytest.fixture
    def secure_storage(self):
        """Create a SecureStorage instance for testing."""
        temp_dir = tempfile.mkdtemp()
        encryption_manager = EncryptionManager("test-master-key-12345")
        storage = SecureStorage(storage_path=temp_dir, encryption_manager=encryption_manager)
        yield storage
        shutil.rmtree(temp_dir)
    
    @pytest.fixture
    def expiration_manager(self, token_cache, secure_storage):
        """Create an ExpirationManager instance for testing."""
        return ExpirationManager(
            token_cache=token_cache,
            secure_storage=secure_storage,
            cleanup_interval_seconds=1,  # Fast cleanup for testing
            storage_cleanup_interval_seconds=2
        )
    
    @pytest.mark.asyncio
    async def test_cleanup_now(self, expiration_manager, token_cache):
        """Test immediate cleanup."""
        test_data = {"token": "cleanup-test"}
        
        # Add expired data to cache
        await token_cache.set("expired_key", test_data, ttl_seconds=1)
        await asyncio.sleep(1.1)  # Wait for expiration
        
        # Perform cleanup
        results = await expiration_manager.cleanup_now()
        
        assert "cache_cleaned" in results
        assert results["cache_cleaned"] >= 0  # Should clean up expired entries
    
    @pytest.mark.asyncio
    async def test_start_stop_manager(self, expiration_manager):
        """Test starting and stopping the expiration manager."""
        # Start the manager
        await expiration_manager.start()
        assert expiration_manager._running is True
        
        # Stop the manager
        await expiration_manager.stop()
        assert expiration_manager._running is False
    
    @pytest.mark.asyncio
    async def test_context_manager(self, expiration_manager):
        """Test using expiration manager as context manager."""
        async with expiration_manager as manager:
            assert manager._running is True
        
        assert expiration_manager._running is False
    
    @pytest.mark.asyncio
    async def test_cleanup_callbacks(self, expiration_manager, token_cache):
        """Test cleanup callbacks."""
        callback_calls = []
        
        async def test_callback(item_type: str, key: str):
            callback_calls.append((item_type, key))
        
        expiration_manager.add_cleanup_callback(test_callback)
        
        # Add and expire some cache data
        test_data = {"token": "callback-test"}
        await token_cache.set("callback_key", test_data, ttl_seconds=1)
        await asyncio.sleep(1.1)
        
        # Trigger cleanup
        await expiration_manager.cleanup_now()
        
        # Should have received callback
        assert len(callback_calls) > 0
        assert callback_calls[0][0] == "cache"
    
    @pytest.mark.asyncio
    async def test_token_expiration_check(self, expiration_manager):
        """Test token expiration checking logic."""
        # Test with expires_at field
        expired_token = {
            "access_token": "expired",
            "expires_at": (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
        }
        assert expiration_manager._is_token_expired(expired_token) is True
        
        # Test with valid expires_at field
        valid_token = {
            "access_token": "valid",
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        }
        assert expiration_manager._is_token_expired(valid_token) is False
        
        # Test with expires_in and issued_at fields
        expired_token_with_issued = {
            "access_token": "expired",
            "expires_in": 3600,
            "issued_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
        }
        assert expiration_manager._is_token_expired(expired_token_with_issued) is True
        
        # Test with no expiration info
        no_expiry_token = {"access_token": "no_expiry"}
        assert expiration_manager._is_token_expired(no_expiry_token) is False


class TestStorageIntegration:
    """Integration tests for storage components."""
    
    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for testing."""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)
    
    @pytest.mark.asyncio
    async def test_full_storage_workflow(self, temp_dir):
        """Test complete workflow with all storage components."""
        # Create components
        encryption_manager = EncryptionManager("integration-test-key")
        secure_storage = SecureStorage(storage_path=temp_dir, encryption_manager=encryption_manager)
        token_cache = TokenCache(default_ttl_seconds=60)
        expiration_manager = ExpirationManager(
            token_cache=token_cache,
            secure_storage=secure_storage,
            cleanup_interval_seconds=10
        )
        
        # Test data
        token_data = {
            "access_token": "integration-token-123",
            "refresh_token": "refresh-456",
            "expires_in": 3600,
            "issued_at": datetime.now(timezone.utc).isoformat()
        }
        
        # Store in both cache and persistent storage
        await token_cache.set("integration_key", token_data, ttl_seconds=30)
        await secure_storage.store("integration_key", token_data)
        
        # Verify data in both storages
        cached_data = await token_cache.get("integration_key")
        stored_data = await secure_storage.retrieve("integration_key")
        
        assert cached_data == token_data
        assert stored_data == token_data
        
        # Test expiration manager
        async with expiration_manager:
            results = await expiration_manager.cleanup_now()
            assert "cache_cleaned" in results
            assert "storage_cleaned" in results
        
        # Verify data still exists (not expired yet)
        assert await token_cache.exists("integration_key")
        assert await secure_storage.exists("integration_key")
    
    @pytest.mark.asyncio
    async def test_cache_and_storage_consistency(self, temp_dir):
        """Test consistency between cache and storage."""
        encryption_manager = EncryptionManager("consistency-test-key")
        secure_storage = SecureStorage(storage_path=temp_dir, encryption_manager=encryption_manager)
        token_cache = TokenCache()
        
        token_data = {"access_token": "consistency-test"}
        
        # Store in both
        await token_cache.set("consistency_key", token_data)
        await secure_storage.store("consistency_key", token_data)
        
        # Modify cache data
        modified_data = {"access_token": "modified-token"}
        await token_cache.set("consistency_key", modified_data)
        
        # Cache should have modified data, storage should have original
        cached_data = await token_cache.get("consistency_key")
        stored_data = await secure_storage.retrieve("consistency_key")
        
        assert cached_data == modified_data
        assert stored_data == token_data