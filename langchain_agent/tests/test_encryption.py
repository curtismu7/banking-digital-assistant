"""Unit tests for encryption utilities."""

import os
import pytest
from unittest.mock import patch, MagicMock
import base64

from src.security.encryption import EncryptionManager, EncryptionError, generate_master_key, generate_salt


class TestEncryptionManager:
    """Test cases for EncryptionManager class."""
    
    def test_encrypt_decrypt_string(self):
        """Test basic string encryption and decryption."""
        manager = EncryptionManager("test-master-key-12345")
        
        original_data = "sensitive token data"
        encrypted = manager.encrypt(original_data)
        decrypted = manager.decrypt(encrypted)
        
        assert decrypted == original_data
        assert encrypted != original_data
        assert isinstance(encrypted, str)
    
    def test_encrypt_decrypt_bytes(self):
        """Test encryption and decryption of bytes data."""
        manager = EncryptionManager("test-master-key-12345")
        
        original_data = b"binary token data"
        encrypted = manager.encrypt(original_data)
        decrypted = manager.decrypt(encrypted)
        
        assert decrypted == original_data.decode('utf-8')
        assert encrypted != original_data.decode('utf-8')
    
    def test_encrypt_decrypt_dict(self):
        """Test dictionary encryption and decryption."""
        manager = EncryptionManager("test-master-key-12345")
        
        original_dict = {
            "access_token": "secret-token-123",
            "refresh_token": "refresh-456",
            "expires_in": 3600,
            "scope": "read write"
        }
        
        encrypted = manager.encrypt_dict(original_dict)
        decrypted = manager.decrypt_dict(encrypted)
        
        assert decrypted == original_dict
        assert isinstance(encrypted, str)
    
    def test_encryption_produces_different_results(self):
        """Test that encrypting the same data twice produces different results."""
        manager = EncryptionManager("test-master-key-12345")
        
        data = "same data"
        encrypted1 = manager.encrypt(data)
        encrypted2 = manager.encrypt(data)
        
        # Should be different due to random IV in Fernet
        assert encrypted1 != encrypted2
        
        # But both should decrypt to the same original data
        assert manager.decrypt(encrypted1) == data
        assert manager.decrypt(encrypted2) == data
    
    def test_different_keys_produce_different_encryption(self):
        """Test that different master keys produce different encrypted results."""
        manager1 = EncryptionManager("master-key-1")
        manager2 = EncryptionManager("master-key-2")
        
        data = "test data"
        encrypted1 = manager1.encrypt(data)
        encrypted2 = manager2.encrypt(data)
        
        assert encrypted1 != encrypted2
        
        # Each manager should only be able to decrypt its own encryption
        assert manager1.decrypt(encrypted1) == data
        assert manager2.decrypt(encrypted2) == data
        
        with pytest.raises(EncryptionError):
            manager1.decrypt(encrypted2)
        
        with pytest.raises(EncryptionError):
            manager2.decrypt(encrypted1)
    
    @patch.dict(os.environ, {'ENCRYPTION_MASTER_KEY': 'env-master-key'})
    def test_master_key_from_environment(self):
        """Test getting master key from environment variable."""
        manager = EncryptionManager()
        
        data = "test data"
        encrypted = manager.encrypt(data)
        decrypted = manager.decrypt(encrypted)
        
        assert decrypted == data
    
    @patch.dict(os.environ, {}, clear=True)
    def test_missing_master_key_raises_error(self):
        """Test that missing master key raises EncryptionError."""
        with pytest.raises(EncryptionError, match="ENCRYPTION_MASTER_KEY environment variable is required"):
            EncryptionManager()
    
    @patch.dict(os.environ, {
        'ENCRYPTION_MASTER_KEY': 'test-key',
        'ENCRYPTION_SALT': base64.urlsafe_b64encode(b'test-salt-16byte').decode()
    })
    def test_salt_from_environment(self):
        """Test using salt from environment variable."""
        manager = EncryptionManager()
        
        data = "test data"
        encrypted = manager.encrypt(data)
        decrypted = manager.decrypt(encrypted)
        
        assert decrypted == data
    
    @patch.dict(os.environ, {
        'ENCRYPTION_MASTER_KEY': 'test-key',
        'ENCRYPTION_SALT': 'invalid-base64!'
    })
    def test_invalid_salt_raises_error(self):
        """Test that invalid salt format raises EncryptionError."""
        with pytest.raises(EncryptionError, match="Invalid ENCRYPTION_SALT format"):
            EncryptionManager()
    
    @patch('src.security.encryption.logging')
    @patch.dict(os.environ, {'ENCRYPTION_MASTER_KEY': 'test-key'})
    def test_generated_salt_warning(self, mock_logging):
        """Test that a warning is logged when salt is generated."""
        EncryptionManager()
        
        mock_logging.warning.assert_called_once()
        warning_call = mock_logging.warning.call_args[0][0]
        assert "Generated new encryption salt" in warning_call
        assert "Set ENCRYPTION_SALT environment variable" in warning_call
    
    def test_decrypt_invalid_data_raises_error(self):
        """Test that decrypting invalid data raises EncryptionError."""
        manager = EncryptionManager("test-master-key-12345")
        
        with pytest.raises(EncryptionError, match="Decryption failed"):
            manager.decrypt("invalid-encrypted-data")
    
    def test_decrypt_dict_invalid_json_raises_error(self):
        """Test that decrypting invalid JSON raises EncryptionError."""
        manager = EncryptionManager("test-master-key-12345")
        
        # Encrypt non-JSON data
        encrypted = manager.encrypt("not json data")
        
        with pytest.raises(EncryptionError, match="Failed to parse decrypted data as JSON"):
            manager.decrypt_dict(encrypted)
    
    def test_encrypt_empty_string(self):
        """Test encrypting and decrypting empty string."""
        manager = EncryptionManager("test-master-key-12345")
        
        encrypted = manager.encrypt("")
        decrypted = manager.decrypt(encrypted)
        
        assert decrypted == ""
    
    def test_encrypt_unicode_data(self):
        """Test encrypting and decrypting unicode data."""
        manager = EncryptionManager("test-master-key-12345")
        
        unicode_data = "🔐 Secure token with émojis and ñoñ-ASCII çharacters"
        encrypted = manager.encrypt(unicode_data)
        decrypted = manager.decrypt(encrypted)
        
        assert decrypted == unicode_data


class TestUtilityFunctions:
    """Test cases for utility functions."""
    
    def test_generate_master_key(self):
        """Test master key generation."""
        key1 = generate_master_key()
        key2 = generate_master_key()
        
        # Keys should be different
        assert key1 != key2
        
        # Keys should be valid base64
        assert isinstance(key1, str)
        assert isinstance(key2, str)
        
        # Should be able to decode as base64
        decoded1 = base64.urlsafe_b64decode(key1)
        decoded2 = base64.urlsafe_b64decode(key2)
        
        # Should be 32 bytes (256 bits)
        assert len(decoded1) == 32
        assert len(decoded2) == 32
    
    def test_generate_salt(self):
        """Test salt generation."""
        salt1 = generate_salt()
        salt2 = generate_salt()
        
        # Salts should be different
        assert salt1 != salt2
        
        # Salts should be valid base64
        assert isinstance(salt1, str)
        assert isinstance(salt2, str)
        
        # Should be able to decode as base64
        decoded1 = base64.urlsafe_b64decode(salt1)
        decoded2 = base64.urlsafe_b64decode(salt2)
        
        # Should be 16 bytes (128 bits)
        assert len(decoded1) == 16
        assert len(decoded2) == 16
    
    def test_generated_keys_work_with_encryption_manager(self):
        """Test that generated keys work with EncryptionManager."""
        master_key = generate_master_key()
        manager = EncryptionManager(master_key)
        
        data = "test data with generated key"
        encrypted = manager.encrypt(data)
        decrypted = manager.decrypt(encrypted)
        
        assert decrypted == data


class TestEncryptionIntegration:
    """Integration tests for encryption functionality."""
    
    @patch.dict(os.environ, {
        'ENCRYPTION_MASTER_KEY': generate_master_key(),
        'ENCRYPTION_SALT': generate_salt()
    })
    def test_full_environment_setup(self):
        """Test complete setup with environment variables."""
        manager = EncryptionManager()
        
        # Test various data types
        test_cases = [
            "simple string",
            {"token": "secret", "expires": 3600},
            "",
            "unicode: 🔐 émojis ñoñ-ASCII",
            {"complex": {"nested": {"data": ["with", "arrays", 123]}}}
        ]
        
        for data in test_cases:
            if isinstance(data, dict):
                encrypted = manager.encrypt_dict(data)
                decrypted = manager.decrypt_dict(encrypted)
            else:
                encrypted = manager.encrypt(data)
                decrypted = manager.decrypt(encrypted)
            
            assert decrypted == data
    
    @patch.dict(os.environ, {
        'ENCRYPTION_MASTER_KEY': 'shared-master-key',
        'ENCRYPTION_SALT': generate_salt()
    })
    def test_cross_manager_compatibility_with_same_keys(self):
        """Test that managers with same keys can decrypt each other's data."""
        # Both managers will use the same environment variables
        manager1 = EncryptionManager()
        manager2 = EncryptionManager()
        
        data = "cross-manager test data"
        encrypted_by_1 = manager1.encrypt(data)
        decrypted_by_2 = manager2.decrypt(encrypted_by_1)
        
        assert decrypted_by_2 == data
        
        encrypted_by_2 = manager2.encrypt(data)
        decrypted_by_1 = manager1.decrypt(encrypted_by_2)
        
        assert decrypted_by_1 == data