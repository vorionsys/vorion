"""
Trust Service — Entity trust score management.

Provides a pluggable trust lookup system. On startup, uses a local
in-memory store. In production, this will be backed by AgentAnchor
or a PostgreSQL trust ledger.

Trust Levels:
  T0 = Untrusted     (0-99)     — Unknown or revoked
  T1 = Provisional   (100-299)  — New, limited access
  T2 = Trusted        (300-599)  — Established track record
  T3 = Verified       (600-899)  — Verified identity + history
  T4 = Autonomous     (900-1000) — Full self-governance

The TrustService is a singleton created at module load. Import
`trust_service` or use the convenience function `get_entity_trust()`.
"""

import structlog
from typing import Optional
from dataclasses import dataclass, field
from threading import Lock

from app.models.common import TrustLevel

logger = structlog.get_logger()


@dataclass
class TrustRecord:
    """Trust state for a single entity."""
    entity_id: str
    trust_score: int            # 0-1000
    trust_level: TrustLevel     # 0-4
    source: str = "local"       # "local", "agentanchor", "db"
    adjustments: int = 0        # number of adjustments made


def _score_to_level(score: int) -> TrustLevel:
    """Convert a numeric trust score (0-1000) to a trust level (0-4)."""
    if score < 100:
        return 0
    elif score < 300:
        return 1
    elif score < 600:
        return 2
    elif score < 900:
        return 3
    return 4


class TrustService:
    """
    Pluggable trust score lookup and adjustment.

    Local store is the default. In production, wire up
    `set_remote_provider()` to delegate to AgentAnchor API.
    """

    def __init__(self):
        self._lock = Lock()
        self._store: dict[str, TrustRecord] = {}
        self._default_score: int = 200   # Provisional by default
        self._remote_provider = None     # Optional async callable

        # Seed some well-known entities for dev/test
        self._seed_defaults()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_trust(self, entity_id: str) -> tuple[int, TrustLevel]:
        """
        Get (trust_score, trust_level) for an entity.

        Returns default (200, 1) for unknown entities.
        """
        with self._lock:
            rec = self._store.get(entity_id)
            if rec:
                return rec.trust_score, rec.trust_level
            return self._default_score, _score_to_level(self._default_score)

    def set_trust(self, entity_id: str, score: int, source: str = "local") -> TrustRecord:
        """
        Set (or create) the trust score for an entity.
        Level is computed automatically from score.
        """
        score = max(0, min(1000, score))
        with self._lock:
            rec = self._store.get(entity_id)
            if rec:
                old = rec.trust_score
                rec.trust_score = score
                rec.trust_level = _score_to_level(score)
                rec.source = source
                rec.adjustments += 1
                logger.info(
                    "trust_updated",
                    entity_id=entity_id,
                    old_score=old,
                    new_score=score,
                    level=rec.trust_level,
                )
            else:
                rec = TrustRecord(
                    entity_id=entity_id,
                    trust_score=score,
                    trust_level=_score_to_level(score),
                    source=source,
                )
                self._store[entity_id] = rec
                logger.info(
                    "trust_created",
                    entity_id=entity_id,
                    score=score,
                    level=rec.trust_level,
                )
            return rec

    def adjust_trust(self, entity_id: str, delta: int, reason: str = "") -> tuple[int, TrustLevel]:
        """
        Adjust an entity's trust by delta (+/-).
        Returns the new (score, level).
        """
        current_score, _ = self.get_trust(entity_id)
        new_score = max(0, min(1000, current_score + delta))
        rec = self.set_trust(entity_id, new_score)
        if reason:
            logger.info(
                "trust_adjusted",
                entity_id=entity_id,
                delta=delta,
                reason=reason,
                new_score=new_score,
            )
        return rec.trust_score, rec.trust_level

    def get_all_records(self) -> dict[str, dict]:
        """Return all trust records (for admin/debug)."""
        with self._lock:
            return {
                eid: {
                    "trust_score": rec.trust_score,
                    "trust_level": rec.trust_level,
                    "source": rec.source,
                    "adjustments": rec.adjustments,
                }
                for eid, rec in self._store.items()
            }

    def set_remote_provider(self, provider):
        """
        Set a remote trust provider (async callable).

        Example:
            async def agentanchor_lookup(entity_id: str) -> tuple[int, int]:
                ...
            trust_service.set_remote_provider(agentanchor_lookup)
        """
        self._remote_provider = provider
        logger.info("trust_remote_provider_set", provider=str(provider))

    async def get_trust_async(self, entity_id: str) -> tuple[int, TrustLevel]:
        """
        Async trust lookup — tries remote provider first, falls back to local.
        """
        if self._remote_provider:
            try:
                score, level = await self._remote_provider(entity_id)
                # Cache in local store
                self.set_trust(entity_id, score, source="agentanchor")
                return score, level
            except Exception as e:
                logger.warning(
                    "trust_remote_fallback",
                    entity_id=entity_id,
                    error=str(e),
                )
        return self.get_trust(entity_id)

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _seed_defaults(self):
        """Seed well-known entities for dev/testing."""
        seeds = {
            "agent_001": 450,   # Trusted (T2)
            "agent_002": 250,   # Provisional (T1)
            "agent_003": 750,   # Verified (T3)
        }
        for eid, score in seeds.items():
            self._store[eid] = TrustRecord(
                entity_id=eid,
                trust_score=score,
                trust_level=_score_to_level(score),
                source="seed",
            )


# ──────────────────────────────────────────────────────────────────────
# Module-level singleton
# ──────────────────────────────────────────────────────────────────────
trust_service = TrustService()


def get_entity_trust(entity_id: str) -> tuple[int, TrustLevel]:
    """Convenience function — returns (score, level)."""
    return trust_service.get_trust(entity_id)
