"""
Redis-backed velocity persistence.

When Redis is available, velocity state is stored in Redis sorted sets
(ZRANGEBYSCORE) for O(log N) sliding-window counts across multiple
Vercel / Kubernetes workers. Falls back to in-memory when Redis is down.

Usage:
    from app.core.redis_velocity import redis_velocity_backend
    # Called automatically by VelocityTracker when Redis is connected
"""

import time
import json
import structlog
from typing import Optional

from app.config import get_settings

logger = structlog.get_logger()
settings = get_settings()

# Try to import redis
try:
    import redis.asyncio as aioredis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False


class RedisVelocityBackend:
    """
    Redis sorted-set implementation for distributed velocity tracking.

    Each entity gets a sorted set keyed as:
        cognigate:velocity:{entity_id}

    Members are unique action IDs (timestamps with counter),
    scores are Unix timestamps. Sliding-window counts use ZCOUNT.

    Throttle state is stored in:
        cognigate:throttle:{entity_id}  → JSON {until, reason}
    """

    def __init__(self):
        self._client: Optional[aioredis.Redis] = None
        self._connected = False
        self._prefix = "cognigate:velocity"
        self._throttle_prefix = "cognigate:throttle"
        self._counter_prefix = "cognigate:vcounter"

    async def connect(self, redis_url: str) -> bool:
        """Connect to Redis. Returns True on success."""
        if not REDIS_AVAILABLE:
            return False
        try:
            self._client = aioredis.from_url(
                redis_url, encoding="utf-8", decode_responses=True
            )
            await self._client.ping()
            self._connected = True
            logger.info("redis_velocity_connected")
            return True
        except Exception as e:
            logger.warning("redis_velocity_connect_failed", error=str(e))
            self._connected = False
            return False

    async def disconnect(self):
        if self._client:
            await self._client.close()
            self._connected = False

    @property
    def is_connected(self) -> bool:
        return self._connected

    # ------------------------------------------------------------------
    # Core operations
    # ------------------------------------------------------------------

    async def record_action(self, entity_id: str) -> int:
        """
        Record an action timestamp. Returns total actions in last 24h.
        """
        if not self._connected:
            return -1
        try:
            now = time.time()
            key = f"{self._prefix}:{entity_id}"
            # Use pipeline for atomicity
            pipe = self._client.pipeline(transaction=True)
            # Add with score = timestamp, member = timestamp:counter
            counter_key = f"{self._counter_prefix}:{entity_id}"
            counter = await self._client.incr(counter_key)
            member = f"{now}:{counter}"
            pipe.zadd(key, {member: now})
            # Prune entries older than 24h
            pipe.zremrangebyscore(key, 0, now - 86400)
            # Set key expiry to 25h (auto-cleanup)
            pipe.expire(key, 90000)
            results = await pipe.execute()
            return await self._client.zcard(key)
        except Exception as e:
            logger.warning("redis_velocity_record_error", error=str(e))
            return -1

    async def count_actions_in_window(self, entity_id: str, window_seconds: int) -> int:
        """Count actions within a sliding window."""
        if not self._connected:
            return -1
        try:
            key = f"{self._prefix}:{entity_id}"
            now = time.time()
            cutoff = now - window_seconds
            return await self._client.zcount(key, cutoff, "+inf")
        except Exception as e:
            logger.warning("redis_velocity_count_error", error=str(e))
            return -1

    async def get_total_actions(self, entity_id: str) -> int:
        """Get total action count (last 24h)."""
        if not self._connected:
            return -1
        try:
            key = f"{self._prefix}:{entity_id}"
            return await self._client.zcard(key)
        except Exception:
            return -1

    # ------------------------------------------------------------------
    # Throttle state
    # ------------------------------------------------------------------

    async def set_throttle(self, entity_id: str, duration_seconds: float) -> bool:
        """Set throttle for an entity."""
        if not self._connected:
            return False
        try:
            key = f"{self._throttle_prefix}:{entity_id}"
            until = time.time() + duration_seconds
            await self._client.setex(
                key, int(duration_seconds) + 1,
                json.dumps({"until": until})
            )
            return True
        except Exception as e:
            logger.warning("redis_throttle_set_error", error=str(e))
            return False

    async def get_throttle(self, entity_id: str) -> Optional[float]:
        """Get throttle expiry timestamp, or None if not throttled."""
        if not self._connected:
            return None
        try:
            key = f"{self._throttle_prefix}:{entity_id}"
            data = await self._client.get(key)
            if data:
                parsed = json.loads(data)
                until = parsed.get("until", 0)
                if until > time.time():
                    return until
                # Expired — clean up
                await self._client.delete(key)
            return None
        except Exception:
            return None

    async def clear_throttle(self, entity_id: str) -> bool:
        """Remove throttle for an entity."""
        if not self._connected:
            return False
        try:
            key = f"{self._throttle_prefix}:{entity_id}"
            await self._client.delete(key)
            return True
        except Exception:
            return False

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------

    async def get_stats(self, entity_id: str) -> dict:
        """Get velocity stats for an entity from Redis."""
        if not self._connected:
            return {}
        now = time.time()
        try:
            key = f"{self._prefix}:{entity_id}"
            throttle = await self.get_throttle(entity_id)
            return {
                "entity_id": entity_id,
                "total_actions": await self._client.zcard(key),
                "actions_last_minute": await self._client.zcount(key, now - 60, "+inf"),
                "actions_last_hour": await self._client.zcount(key, now - 3600, "+inf"),
                "actions_last_day": await self._client.zcount(key, now - 86400, "+inf"),
                "is_throttled": throttle is not None,
                "throttle_until": throttle,
                "backend": "redis",
            }
        except Exception as e:
            logger.warning("redis_velocity_stats_error", error=str(e))
            return {}

    async def get_tracked_entities(self) -> list[str]:
        """List all entities with velocity data."""
        if not self._connected:
            return []
        try:
            keys = []
            prefix = f"{self._prefix}:"
            async for key in self._client.scan_iter(match=f"{prefix}*"):
                entity_id = key.removeprefix(prefix)
                keys.append(entity_id)
            return keys
        except Exception:
            return []


# Singleton
redis_velocity_backend = RedisVelocityBackend()
