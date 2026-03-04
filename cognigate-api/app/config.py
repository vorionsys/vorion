"""
Application configuration using Pydantic Settings.
"""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Application
    app_name: str = "Cognigate Engine"
    app_version: str = "0.2.0"
    debug: bool = False
    environment: str = "development"

    # API
    api_prefix: str = "/v1"
    api_key_header: str = "X-API-Key"

    # Security
    secret_key: str = "CHANGE_ME_IN_PRODUCTION"
    access_token_expire_minutes: int = 30
    admin_api_key: str = "CHANGE_ME_IN_PRODUCTION"  # API key for admin endpoints

    # Trust Engine
    default_trust_level: int = 1
    trust_decay_rate: float = 0.01

    # Logging
    log_level: str = "INFO"
    log_format: str = "json"

    # Critic Pattern - AI Provider Configuration
    # Supported: "anthropic" (Claude), "openai" (GPT), "google" (Gemini), "xai" (Grok)
    critic_provider: str = "anthropic"  # Default to Claude

    # API Keys (set the one matching your provider)
    anthropic_api_key: str = ""  # Claude
    openai_api_key: str = ""     # GPT
    google_api_key: str = ""     # Gemini
    xai_api_key: str = ""        # Grok

    # Model settings per provider
    critic_model_anthropic: str = "claude-3-5-sonnet-20241022"
    critic_model_openai: str = "gpt-4o-mini"
    critic_model_google: str = "gemini-1.5-flash"
    critic_model_xai: str = "grok-2-latest"

    critic_temperature: float = 0.3
    critic_enabled: bool = True

    # External Services
    database_url: str = "postgresql+asyncpg://localhost:5432/cognigate"
    redis_url: str = "redis://localhost:6379"
    redis_enabled: bool = True

    # Logic API - External governance evaluation service
    logic_api_url: str = ""              # e.g. "https://logic.vorion.org/v1"
    logic_api_key: str = ""              # API key for Logic service
    logic_enabled: bool = False          # Feature flag — enable when Logic API is deployed
    logic_timeout_seconds: float = 5.0   # Timeout for Logic API calls

    # Signature System
    signature_enabled: bool = True
    signature_private_key: str = ""  # Base64-encoded PEM private key (optional)
    signature_key_path: str = ""     # Path to PEM private key file (optional)

    # AgentAnchor — remote trust provider
    agentanchor_api_url: str = ""     # e.g. "https://app.agentanchorai.com/api"
    agentanchor_api_key: str = ""     # API key for AgentAnchor

    # Cache TTLs (seconds)
    cache_ttl_policy_results: int = 60        # Policy evaluation results
    cache_ttl_trust_scores: int = 300         # Trust scores
    cache_ttl_velocity_state: int = 0         # Velocity state (no expiry, but Redis will evict on memory pressure)


    def validate_production_secrets(self) -> list[str]:
        """Validate that production secrets are not default values."""
        issues = []
        if self.environment != "development":
            if self.secret_key == "CHANGE_ME_IN_PRODUCTION":
                issues.append("secret_key is still set to default — set a strong secret via SECRET_KEY env var")
            if self.admin_api_key == "CHANGE_ME_IN_PRODUCTION":
                issues.append("admin_api_key is still set to default — set a strong key via ADMIN_API_KEY env var")
        return issues


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    settings = Settings()
    issues = settings.validate_production_secrets()
    if issues:
        import warnings
        for issue in issues:
            warnings.warn(f"SECURITY: {issue}", stacklevel=2)
    return settings
