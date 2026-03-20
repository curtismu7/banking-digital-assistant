"""Encryption utilities for secure token storage."""

import os
import base64
import logging
from typing import Union, Optional
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


class EncryptionError(Exception):
    """Exception raised for encryption/decryption errors."""
    pass


class EncryptionManager:
    """Manages encryption and decryption of sensitive data using Fernet symmetric encryption."""
    
    def __init__(self, master_key: Optional[str] = None):
        """
        Initialize the encryption manager.
        
        Args:
            master_key: Optional master key. If not provided, will be derived from environment.
        """
        self._fernet = self._initialize_fernet(master_key)
    
    def _initialize_fernet(self, master_key: Optional[str] = None) -> Fernet:
        """Initialize Fernet cipher with a derived key."""
        if master_key is None:
            master_key = self._get_master_key_from_env()
        
        # Generate a salt for key derivation
        salt = self._get_or_generate_salt()
        
        # Derive encryption key from master key using PBKDF2
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=100000,
        )
        key = base64.urlsafe_b64encode(kdf.derive(master_key.encode()))
        return Fernet(key)
    
    def _get_master_key_from_env(self) -> str:
        """Get master key from environment variables."""
        master_key = os.getenv('ENCRYPTION_MASTER_KEY')
        if not master_key:
            raise EncryptionError(
                "ENCRYPTION_MASTER_KEY environment variable is required for encryption"
            )
        return master_key
    
    def _get_or_generate_salt(self) -> bytes:
        """Get salt from environment or generate a new one."""
        salt_b64 = os.getenv('ENCRYPTION_SALT')
        if salt_b64:
            try:
                return base64.urlsafe_b64decode(salt_b64)
            except Exception as e:
                raise EncryptionError(f"Invalid ENCRYPTION_SALT format: {e}")
        
        # Generate new salt if not provided
        salt = os.urandom(16)
        salt_b64 = base64.urlsafe_b64encode(salt).decode()
        
        # Log warning about generated salt (in production, this should be persisted)
        logging.warning(
            f"Generated new encryption salt: {salt_b64}. "
            "Set ENCRYPTION_SALT environment variable to persist this salt."
        )
        
        return salt
    
    def encrypt(self, data: Union[str, bytes]) -> str:
        """
        Encrypt data and return base64-encoded encrypted string.
        
        Args:
            data: Data to encrypt (string or bytes)
            
        Returns:
            Base64-encoded encrypted data
            
        Raises:
            EncryptionError: If encryption fails
        """
        try:
            if isinstance(data, str):
                data = data.encode('utf-8')
            
            encrypted_data = self._fernet.encrypt(data)
            return base64.urlsafe_b64encode(encrypted_data).decode('utf-8')
        
        except Exception as e:
            raise EncryptionError(f"Encryption failed: {e}")
    
    def decrypt(self, encrypted_data: str) -> str:
        """
        Decrypt base64-encoded encrypted data.
        
        Args:
            encrypted_data: Base64-encoded encrypted data
            
        Returns:
            Decrypted data as string
            
        Raises:
            EncryptionError: If decryption fails
        """
        try:
            encrypted_bytes = base64.urlsafe_b64decode(encrypted_data.encode('utf-8'))
            decrypted_data = self._fernet.decrypt(encrypted_bytes)
            return decrypted_data.decode('utf-8')
        
        except Exception as e:
            raise EncryptionError(f"Decryption failed: {e}")
    
    def encrypt_dict(self, data: dict) -> str:
        """
        Encrypt a dictionary by converting it to JSON first.
        
        Args:
            data: Dictionary to encrypt
            
        Returns:
            Base64-encoded encrypted JSON string
        """
        import json
        json_data = json.dumps(data, separators=(',', ':'))
        return self.encrypt(json_data)
    
    def decrypt_dict(self, encrypted_data: str) -> dict:
        """
        Decrypt data and parse as JSON dictionary.
        
        Args:
            encrypted_data: Base64-encoded encrypted JSON data
            
        Returns:
            Decrypted dictionary
            
        Raises:
            EncryptionError: If decryption or JSON parsing fails
        """
        import json
        try:
            json_data = self.decrypt(encrypted_data)
            return json.loads(json_data)
        except json.JSONDecodeError as e:
            raise EncryptionError(f"Failed to parse decrypted data as JSON: {e}")


def generate_master_key() -> str:
    """
    Generate a secure random master key for encryption.
    
    Returns:
        Base64-encoded random key suitable for use as ENCRYPTION_MASTER_KEY
    """
    key_bytes = os.urandom(32)  # 256-bit key
    return base64.urlsafe_b64encode(key_bytes).decode('utf-8')


def generate_salt() -> str:
    """
    Generate a secure random salt for key derivation.
    
    Returns:
        Base64-encoded random salt suitable for use as ENCRYPTION_SALT
    """
    salt_bytes = os.urandom(16)  # 128-bit salt
    return base64.urlsafe_b64encode(salt_bytes).decode('utf-8')