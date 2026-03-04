"""
AgentAnchor Trust Provider — Remote trust score lookup.

Provides the async callable for TrustService.set_remote_provider()
that fetches live trust scores from the AgentAnchor platform.

Usage at startup:
    from app.core.agentanchor_trust import create_agentanchor_provider
    trust_service.set_remote_provider(create_agentanchor_provider())

Configuration:
    Set AGENTANCHOR_API_URL and AGENTANCHOR_API_KEY env vars.
    Falls back to local trust if AgentAnchor is unreachable.
"""

import structlog
from typing import Optional, Tuple

from app.config import get_settings

logger = structlog.get_logger()

# Try to import httpx for async HTTP
try:
    import httpx
    HTTPX_AVAILABLE = True
except ImportError:
    HTTPX_AVAILABLE = False


class AgentAnchorTrustProvider:
    """
    Async trust lookup against AgentAnchor API.

    Expected AgentAnchor response format:
    {
        "entity_id": "agent_001",
        "trust_score": 450,
        "trust_level": 2,
        "source": "agentanchor",
        "last_evaluated": "2026-03-01T12:00:00Z"
    }
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 5.0,
    ):
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def _ensure_client(self) -> httpx.AsyncClient:
        """Lazy-init the async HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout,
                headers={
                    "X-API-Key": self._api_key,
                    "Accept": "application/json",
                    "User-Agent": "Cognigate/0.2.0",
                },
            )
        return self._client

    async def __call__(self, entity_id: str) -> Tuple[int, int]:
        """
        Fetch trust score from AgentAnchor.

        Args:
            entity_id: The entity to look up

        Returns:
            (trust_score, trust_level) tuple

        Raises:
            Exception on network/API failure (TrustService handles fallback)
        """
        client = await self._ensure_client()

        resp = await client.get(
            f"/v1/trust/{entity_id}",
        )

        if resp.status_code == 404:
            # Entity not registered in AgentAnchor — use defaults
            logger.info(
                "agentanchor_entity_not_found",
                entity_id=entity_id,
            )
            raise LookupError(f"Entity {entity_id} not found in AgentAnchor")

        resp.raise_for_status()
        data = resp.json()

        score = data.get("trust_score", 200)
        level = data.get("trust_level", 1)

        logger.info(
            "agentanchor_trust_fetched",
            entity_id=entity_id,
            score=score,
            level=level,
        )
        return score, level

    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()


def create_agentanchor_provider() -> Optional[AgentAnchorTrustProvider]:
    """
    Create an AgentAnchor trust provider from environment config.

    Returns None if not configured (missing URL or key).
    """
    settings = get_settings()

    # Check for AgentAnchor config — these would be set via env vars
    base_url = getattr(settings, "agentanchor_api_url", "")
    api_key = getattr(settings, "agentanchor_api_key", "")

    if not base_url or not api_key:
        logger.info("agentanchor_provider_not_configured")
        return None

    if not HTTPX_AVAILABLE:
        logger.warning("agentanchor_requires_httpx", hint="pip install httpx")
        return None

    logger.info("agentanchor_provider_created", base_url=base_url)
    return AgentAnchorTrustProvider(
        base_url=base_url,
        api_key=api_key,
    )
