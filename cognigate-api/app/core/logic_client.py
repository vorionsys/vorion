"""
Logic API Client - External governance evaluation service.

Calls the Logic API to get additional policy evaluation from the centralized
governance engine. Results are merged with local policy engine evaluation.

Feature-flagged: disabled by default (logic_enabled=False).
When the Logic API is unavailable, enforcement falls back to local-only evaluation.
"""

import time
import structlog
import httpx
from typing import Optional

from app.config import get_settings

logger = structlog.get_logger()
settings = get_settings()


class LogicViolation:
    """A violation returned by the Logic API."""

    __slots__ = (
        "policy_id", "constraint_id", "severity",
        "message", "blocked", "requires_approval", "remediation",
    )

    def __init__(
        self,
        policy_id: str,
        constraint_id: str,
        severity: str,
        message: str,
        blocked: bool,
        requires_approval: bool = False,
        remediation: Optional[str] = None,
    ):
        self.policy_id = policy_id
        self.constraint_id = constraint_id
        self.severity = severity
        self.message = message
        self.blocked = blocked
        self.requires_approval = requires_approval
        self.remediation = remediation


class LogicResult:
    """Result from a Logic API evaluation call."""

    __slots__ = ("violations", "constraints_evaluated", "duration_ms", "source")

    def __init__(
        self,
        violations: list[LogicViolation],
        constraints_evaluated: int,
        duration_ms: float,
        source: str = "logic-api",
    ):
        self.violations = violations
        self.constraints_evaluated = constraints_evaluated
        self.duration_ms = duration_ms
        self.source = source


async def evaluate_with_logic(
    entity_id: str,
    plan_id: str,
    trust_level: int,
    risk_score: float,
    tools_required: list[str],
    data_classifications: list[str],
    policy_ids: list[str] | None = None,
) -> Optional[LogicResult]:
    """
    Call the Logic API for external governance evaluation.

    Returns LogicResult on success, None if Logic is disabled or unavailable.
    Non-blocking: errors are logged and return None (local evaluation continues).
    """
    if not settings.logic_enabled or not settings.logic_api_url:
        return None

    start_time = time.perf_counter()
    payload = {
        "entity_id": entity_id,
        "plan_id": plan_id,
        "trust_level": trust_level,
        "risk_score": risk_score,
        "tools_required": tools_required,
        "data_classifications": data_classifications,
    }
    if policy_ids:
        payload["policy_ids"] = policy_ids

    headers = {
        "Content-Type": "application/json",
        "X-API-Key": settings.logic_api_key,
    }

    try:
        async with httpx.AsyncClient(timeout=settings.logic_timeout_seconds) as client:
            response = await client.post(
                f"{settings.logic_api_url.rstrip('/')}/evaluate",
                json=payload,
                headers=headers,
            )
            response.raise_for_status()

        data = response.json()
        duration_ms = (time.perf_counter() - start_time) * 1000

        violations = [
            LogicViolation(
                policy_id=v.get("policy_id", "logic-unknown"),
                constraint_id=v.get("constraint_id", "unknown"),
                severity=v.get("severity", "medium"),
                message=v.get("message", "Logic API violation"),
                blocked=v.get("blocked", False),
                requires_approval=v.get("requires_approval", False),
                remediation=v.get("remediation"),
            )
            for v in data.get("violations", [])
        ]

        result = LogicResult(
            violations=violations,
            constraints_evaluated=data.get("constraints_evaluated", 0),
            duration_ms=duration_ms,
        )

        logger.info(
            "logic_api_completed",
            entity_id=entity_id,
            plan_id=plan_id,
            violations_count=len(violations),
            constraints_evaluated=result.constraints_evaluated,
            duration_ms=duration_ms,
        )

        return result

    except httpx.TimeoutException:
        duration_ms = (time.perf_counter() - start_time) * 1000
        logger.warning(
            "logic_api_timeout",
            entity_id=entity_id,
            plan_id=plan_id,
            timeout_s=settings.logic_timeout_seconds,
            duration_ms=duration_ms,
        )
        return None

    except httpx.HTTPStatusError as e:
        duration_ms = (time.perf_counter() - start_time) * 1000
        logger.warning(
            "logic_api_http_error",
            entity_id=entity_id,
            plan_id=plan_id,
            status_code=e.response.status_code,
            duration_ms=duration_ms,
        )
        return None

    except Exception as e:
        duration_ms = (time.perf_counter() - start_time) * 1000
        logger.error(
            "logic_api_error",
            entity_id=entity_id,
            plan_id=plan_id,
            error=str(e),
            duration_ms=duration_ms,
        )
        return None
