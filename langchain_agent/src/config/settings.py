"""
Configuration management for environment-specific settings.
"""
import os
import json
from typing import Optional, Dict, Any, Type
from dataclasses import dataclass, asdict
from pathlib import Path
from abc import ABC, abstractmethod

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    # dotenv not available, skip loading
    pass


@dataclass
class PingOneConfig:
    """Configuration for PingOne Advanced Identity Cloud (ForgeRock)."""
    base_url: str
    client_registration_endpoint: str
    token_endpoint: str
    authorization_endpoint: str
    default_scope: str
    redirect_uri: str
    realm: str = "alpha"  # ForgeRock realm (default: alpha)


@dataclass
class SecurityConfig:
    """Security-related configuration."""
    encryption_master_key: str
    encryption_salt: str
    token_expiry_buffer_seconds: int = 300  # 5 minutes buffer before expiry
    session_timeout_minutes: int = 60
    max_retry_attempts: int = 3
    retry_backoff_seconds: int = 2


@dataclass
class MCPConfig:
    """Configuration for MCP server connections."""
    connection_timeout_seconds: int = 30
    max_connections_per_server: int = 5
    retry_attempts: int = 3
    heartbeat_interval_seconds: int = 30


@dataclass
class LangChainConfig:
    """Configuration for LangChain agent."""
    model_name: str = "gpt-3.5-turbo"
    temperature: float = 0.7
    max_tokens: int = 1000
    openai_api_key: str = ""
    verbose: bool = False
    max_iterations: int = 10
    max_execution_time: int = 60  # seconds


@dataclass
class ChatConfig:
    """Configuration for chat interface."""
    websocket_port: int = 8080
    max_message_length: int = 4096
    conversation_history_limit: int = 100
    session_cleanup_interval_minutes: int = 15


@dataclass
class AppConfig:
    """Main application configuration."""
    environment: str
    debug: bool
    log_level: str
    pingone: PingOneConfig
    security: SecurityConfig
    mcp: MCPConfig
    chat: ChatConfig
    langchain: LangChainConfig


class BaseEnvironmentConfig(ABC):
    """Base class for environment-specific configurations."""
    
    @abstractmethod
    def get_environment_name(self) -> str:
        """Get the environment name."""
        pass
    
    @abstractmethod
    def get_default_values(self) -> Dict[str, Any]:
        """Get default configuration values for this environment."""
        pass
    
    @abstractmethod
    def validate_config(self, config: AppConfig) -> None:
        """Validate configuration for this environment."""
        pass


class DevelopmentConfig(BaseEnvironmentConfig):
    """Development environment configuration."""
    
    def get_environment_name(self) -> str:
        return "development"
    
    def get_default_values(self) -> Dict[str, Any]:
        return {
            "DEBUG": "true",
            "LOG_LEVEL": "DEBUG",
            "WEBSOCKET_PORT": "8080",
            "LANGCHAIN_VERBOSE": "true",
            "LANGCHAIN_MODEL_NAME": "gpt-3.5-turbo",
            "PINGONE_REDIRECT_URI": "http://localhost:8080/auth/callback",
            "SESSION_TIMEOUT_MINUTES": "30",  # Shorter timeout for development
        }
    
    def validate_config(self, config: AppConfig) -> None:
        """Validate development configuration."""
        if not config.pingone.base_url.startswith(("http://localhost", "https://localhost", "http://127.0.0.1")):
            if not config.pingone.base_url.endswith(".forgeblocks.com"):
                raise ValueError("Development environment should use localhost or ForgeRock cloud URLs")


class StagingConfig(BaseEnvironmentConfig):
    """Staging environment configuration."""
    
    def get_environment_name(self) -> str:
        return "staging"
    
    def get_default_values(self) -> Dict[str, Any]:
        return {
            "DEBUG": "false",
            "LOG_LEVEL": "INFO",
            "WEBSOCKET_PORT": "8080",
            "LANGCHAIN_VERBOSE": "false",
            "LANGCHAIN_MODEL_NAME": "gpt-3.5-turbo",
            "SESSION_TIMEOUT_MINUTES": "60",
            "MAX_RETRY_ATTEMPTS": "5",  # More retries in staging
        }
    
    def validate_config(self, config: AppConfig) -> None:
        """Validate staging configuration."""
        if config.debug:
            raise ValueError("Debug mode should be disabled in staging environment")
        
        if not config.pingone.base_url.startswith("https://"):
            raise ValueError("Staging environment must use HTTPS for PingOne")


class ProductionConfig(BaseEnvironmentConfig):
    """Production environment configuration."""
    
    def get_environment_name(self) -> str:
        return "production"
    
    def get_default_values(self) -> Dict[str, Any]:
        return {
            "DEBUG": "false",
            "LOG_LEVEL": "WARNING",
            "WEBSOCKET_PORT": "8080",
            "LANGCHAIN_VERBOSE": "false",
            "LANGCHAIN_MODEL_NAME": "gpt-4",  # Use more capable model in production
            "SESSION_TIMEOUT_MINUTES": "120",  # Longer timeout for production
            "MAX_RETRY_ATTEMPTS": "5",
            "TOKEN_EXPIRY_BUFFER_SECONDS": "600",  # 10 minutes buffer in production
        }
    
    def validate_config(self, config: AppConfig) -> None:
        """Validate production configuration."""
        if config.debug:
            raise ValueError("Debug mode must be disabled in production environment")
        
        if config.log_level not in ["WARNING", "ERROR", "CRITICAL"]:
            raise ValueError("Production log level should be WARNING or higher")
        
        if not config.pingone.base_url.startswith("https://"):
            raise ValueError("Production environment must use HTTPS for PingOne")
        
        if len(config.security.encryption_master_key) < 32:
            raise ValueError("Production encryption key must be at least 32 characters")


class TestConfig(BaseEnvironmentConfig):
    """Test environment configuration."""
    
    def get_environment_name(self) -> str:
        return "test"
    
    def get_default_values(self) -> Dict[str, Any]:
        return {
            "DEBUG": "true",
            "LOG_LEVEL": "DEBUG",
            "WEBSOCKET_PORT": "8081",  # Different port for tests
            "LANGCHAIN_VERBOSE": "false",  # Keep test output clean
            "LANGCHAIN_MODEL_NAME": "gpt-3.5-turbo",
            "PINGONE_BASE_URL": "https://test.forgeblocks.com",
            "SESSION_TIMEOUT_MINUTES": "5",  # Short timeout for tests
            "MCP_CONNECTION_TIMEOUT_SECONDS": "5",  # Fast timeouts for tests
        }
    
    def validate_config(self, config: AppConfig) -> None:
        """Validate test configuration."""
        # Tests can be more lenient with validation
        pass


class ConfigManager:
    """Manages application configuration from environment variables and files."""
    
    def __init__(self, config_file: Optional[Path] = None):
        self.config_file = config_file
        self._config: Optional[AppConfig] = None
        self._environment_configs = {
            "development": DevelopmentConfig(),
            "staging": StagingConfig(),
            "production": ProductionConfig(),
            "test": TestConfig(),
        }
    
    def load_config(self, environment: Optional[str] = None) -> AppConfig:
        """Load configuration from environment variables and optional config file."""
        if self._config is None or environment is not None:
            self._config = self._build_config(environment)
        return self._config
    
    def reload_config(self, environment: Optional[str] = None) -> AppConfig:
        """Force reload configuration."""
        self._config = None
        return self.load_config(environment)
    
    def export_config_template(self, environment: str, output_path: Path) -> None:
        """Export configuration template for specified environment."""
        if environment not in self._environment_configs:
            raise ValueError(f"Unknown environment: {environment}")
        
        env_config = self._environment_configs[environment]
        defaults = env_config.get_default_values()
        
        template_lines = [
            f"# Configuration template for {environment} environment",
            f"# Generated automatically - customize as needed",
            "",
            f"ENVIRONMENT={environment}",
        ]
        
        for key, value in defaults.items():
            template_lines.append(f"{key}={value}")
        
        # Add required variables that don't have defaults
        required_vars = [
            "PINGONE_BASE_URL=https://your-tenant.forgeblocks.com",
            "PINGONE_CLIENT_REGISTRATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/register",
            "PINGONE_TOKEN_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/access_token",
            "PINGONE_AUTHORIZATION_ENDPOINT=https://your-tenant.forgeblocks.com/am/oauth2/realms/alpha/authorize",
            "ENCRYPTION_MASTER_KEY=your-base64-encoded-master-key-here",
            "ENCRYPTION_SALT=your-base64-encoded-salt-here",
            "OPENAI_API_KEY=your-openai-api-key-here",
        ]
        
        template_lines.extend(["", "# Required variables - must be set"])
        template_lines.extend(required_vars)
        
        output_path.write_text("\n".join(template_lines))
    
    def validate_environment_config(self, config: AppConfig) -> None:
        """Validate configuration for the current environment."""
        env_config = self._environment_configs.get(config.environment)
        if env_config:
            env_config.validate_config(config)
    
    def _build_config(self, environment: Optional[str] = None) -> AppConfig:
        """Build configuration from environment variables with environment-specific defaults."""
        # Load environment from parameter or environment variable
        env_name = environment or os.getenv("ENVIRONMENT", "development")
        
        # Get environment-specific defaults
        env_config = self._environment_configs.get(env_name)
        if not env_config:
            raise ValueError(f"Unknown environment: {env_name}")
        
        defaults = env_config.get_default_values()
        
        # Load configuration file if specified
        file_config = {}
        if self.config_file and self.config_file.exists():
            file_config = self._load_config_file()
        
        # Helper function to get value with environment-specific defaults
        def get_env_value(key: str, default: Optional[str] = None) -> str:
            # Priority: environment variable > config file > environment defaults > provided default
            return (os.getenv(key) or 
                   file_config.get(key) or 
                   defaults.get(key) or 
                   default or "")
        
        # PingOne Advanced Identity Cloud (ForgeRock) configuration
        pingone_config = PingOneConfig(
            base_url=self._get_required_env("PINGONE_BASE_URL", file_config, defaults),
            client_registration_endpoint=self._get_required_env("PINGONE_CLIENT_REGISTRATION_ENDPOINT", file_config, defaults),
            token_endpoint=self._get_required_env("PINGONE_TOKEN_ENDPOINT", file_config, defaults),
            authorization_endpoint=self._get_required_env("PINGONE_AUTHORIZATION_ENDPOINT", file_config, defaults),
            default_scope=get_env_value("PINGONE_DEFAULT_SCOPE", "openid profile"),
            redirect_uri=self._get_required_env("PINGONE_REDIRECT_URI", file_config, defaults),
            realm=get_env_value("PINGONE_REALM", "alpha")
        )
        
        # Security configuration
        security_config = SecurityConfig(
            encryption_master_key=self._get_required_env("ENCRYPTION_MASTER_KEY", file_config, defaults),
            encryption_salt=self._get_required_env("ENCRYPTION_SALT", file_config, defaults),
            token_expiry_buffer_seconds=int(get_env_value("TOKEN_EXPIRY_BUFFER_SECONDS", "300")),
            session_timeout_minutes=int(get_env_value("SESSION_TIMEOUT_MINUTES", "60")),
            max_retry_attempts=int(get_env_value("MAX_RETRY_ATTEMPTS", "3")),
            retry_backoff_seconds=int(get_env_value("RETRY_BACKOFF_SECONDS", "2"))
        )
        
        # MCP configuration
        mcp_config = MCPConfig(
            connection_timeout_seconds=int(get_env_value("MCP_CONNECTION_TIMEOUT_SECONDS", "30")),
            max_connections_per_server=int(get_env_value("MCP_MAX_CONNECTIONS_PER_SERVER", "5")),
            retry_attempts=int(get_env_value("MCP_RETRY_ATTEMPTS", "3")),
            heartbeat_interval_seconds=int(get_env_value("MCP_HEARTBEAT_INTERVAL_SECONDS", "30"))
        )
        
        # LangChain configuration
        langchain_config = LangChainConfig(
            model_name=get_env_value("LANGCHAIN_MODEL_NAME", "gpt-3.5-turbo"),
            temperature=float(get_env_value("LANGCHAIN_TEMPERATURE", "0.7")),
            max_tokens=int(get_env_value("LANGCHAIN_MAX_TOKENS", "1000")),
            openai_api_key=self._get_required_env("OPENAI_API_KEY", file_config, defaults),
            verbose=get_env_value("LANGCHAIN_VERBOSE", "false").lower() == "true",
            max_iterations=int(get_env_value("LANGCHAIN_MAX_ITERATIONS", "10")),
            max_execution_time=int(get_env_value("LANGCHAIN_MAX_EXECUTION_TIME", "60"))
        )
        
        # Chat configuration
        chat_config = ChatConfig(
            websocket_port=int(get_env_value("WEBSOCKET_PORT", "8080")),
            max_message_length=int(get_env_value("MAX_MESSAGE_LENGTH", "4096")),
            conversation_history_limit=int(get_env_value("CONVERSATION_HISTORY_LIMIT", "100")),
            session_cleanup_interval_minutes=int(get_env_value("SESSION_CLEANUP_INTERVAL_MINUTES", "15"))
        )
        
        config = AppConfig(
            environment=env_name,
            debug=get_env_value("DEBUG", "false").lower() == "true",
            log_level=get_env_value("LOG_LEVEL", "INFO"),
            pingone=pingone_config,
            security=security_config,
            mcp=mcp_config,
            chat=chat_config,
            langchain=langchain_config
        )
        
        # Validate configuration for the environment
        self.validate_environment_config(config)
        
        return config
    
    def _load_config_file(self) -> Dict[str, str]:
        """Load configuration from JSON file."""
        try:
            with open(self.config_file, 'r') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError) as e:
            raise ValueError(f"Failed to load configuration file {self.config_file}: {e}")
    
    def save_config_to_file(self, config: AppConfig, output_path: Path) -> None:
        """Save current configuration to JSON file (excluding sensitive data)."""
        config_dict = asdict(config)
        
        # Remove sensitive information
        if 'security' in config_dict:
            config_dict['security']['encryption_master_key'] = "[REDACTED]"
            config_dict['security']['encryption_salt'] = "[REDACTED]"
        
        if 'langchain' in config_dict:
            config_dict['langchain']['openai_api_key'] = "[REDACTED]"
        
        with open(output_path, 'w') as f:
            json.dump(config_dict, f, indent=2, default=str)
    
    def _get_required_env(self, key: str, file_config: Dict[str, str], defaults: Dict[str, Any]) -> str:
        """Get required environment variable from multiple sources or raise error."""
        value = (os.getenv(key) or 
                file_config.get(key) or 
                defaults.get(key))
        
        if not value:
            raise ValueError(f"Required configuration value {key} is not set in environment variables, config file, or defaults")
        return value
    
    def get_mcp_server_configs(self) -> Dict[str, Dict[str, Any]]:
        """Load MCP server configurations from environment variables."""
        configs = {}
        
        # Look for MCP server configurations in format: MCP_SERVER_{NAME}_ENDPOINT
        for key, value in os.environ.items():
            if key.startswith("MCP_SERVER_") and key.endswith("_ENDPOINT"):
                # Extract server name from environment variable
                server_name = key.replace("MCP_SERVER_", "").replace("_ENDPOINT", "").lower()
                
                configs[server_name] = {
                    "endpoint": value,
                    "capabilities": os.getenv(f"MCP_SERVER_{server_name.upper()}_CAPABILITIES", "").split(","),
                    "auth_required": os.getenv(f"MCP_SERVER_{server_name.upper()}_AUTH_REQUIRED", "false").lower() == "true"
                }
        
        return configs


# Global configuration instance
config_manager = ConfigManager()


def get_config() -> AppConfig:
    """Get the application configuration."""
    return config_manager.load_config()


def get_mcp_server_configs() -> Dict[str, Dict[str, Any]]:
    """Get MCP server configurations."""
    return config_manager.get_mcp_server_configs()