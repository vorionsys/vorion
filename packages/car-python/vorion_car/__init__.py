"""
Vorion CAR Python SDK

Python client for the Vorion CAR (Categorical Agentic Registry) Trust Engine.

Example:
    >>> from vorion_car import CARClient
    >>> client = CARClient("https://api.vorion.dev", api_key="...")
    >>> stats = await client.get_stats()
    >>> print(stats.context_stats.agents)
"""

from .client import CARClient, CARClientConfig
from .types import (
    TrustTier,
    AgentRole,
    CreationType,
    RoleGateDecision,
    ComplianceStatus,
    AlertSeverity,
    AlertStatus,
    DashboardStats,
    ContextStats,
    CeilingStats,
    RoleGateStats,
    PresetStats,
    ProvenanceStats,
    RoleGateRequest,
    RoleGateResponse,
    CeilingCheckRequest,
    CeilingCheckResponse,
    ProvenanceCreateRequest,
    ProvenanceRecord,
    GamingAlert,
)
from .utils import (
    get_tier_from_score,
    is_role_allowed_for_tier,
    apply_provenance_modifier,
    TRUST_TIER_RANGES,
    ROLE_LABELS,
    PROVENANCE_MODIFIERS,
)

# Backwards-compatible aliases (deprecated)
ACIClient = CARClient
ACIClientConfig = CARClientConfig

__version__ = "1.0.0"
__all__ = [
    # Client
    "CARClient",
    "CARClientConfig",
    # Deprecated aliases
    "ACIClient",
    "ACIClientConfig",
    # Types - Enums
    "TrustTier",
    "AgentRole",
    "CreationType",
    "RoleGateDecision",
    "ComplianceStatus",
    "AlertSeverity",
    "AlertStatus",
    # Types - Data Classes
    "DashboardStats",
    "ContextStats",
    "CeilingStats",
    "RoleGateStats",
    "PresetStats",
    "ProvenanceStats",
    "RoleGateRequest",
    "RoleGateResponse",
    "CeilingCheckRequest",
    "CeilingCheckResponse",
    "ProvenanceCreateRequest",
    "ProvenanceRecord",
    "GamingAlert",
    # Utils
    "get_tier_from_score",
    "is_role_allowed_for_tier",
    "apply_provenance_modifier",
    "TRUST_TIER_RANGES",
    "ROLE_LABELS",
    "PROVENANCE_MODIFIERS",
]
