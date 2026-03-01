"""
Tests for vorion_car package-level exports, __all__, version, and backwards-compatible aliases.
"""

import vorion_car
from vorion_car import (
    # Client
    CARClient,
    CARClientConfig,
    # Deprecated aliases
    ACIClient,
    ACIClientConfig,
    # Enums
    TrustTier,
    AgentRole,
    CreationType,
    RoleGateDecision,
    ComplianceStatus,
    AlertSeverity,
    AlertStatus,
    # Data classes
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
    # Utils
    get_tier_from_score,
    is_role_allowed_for_tier,
    apply_provenance_modifier,
    TRUST_TIER_RANGES,
    ROLE_LABELS,
    PROVENANCE_MODIFIERS,
)


class TestPackageVersion:
    def test_version_is_string(self):
        assert isinstance(vorion_car.__version__, str)

    def test_version_value(self):
        assert vorion_car.__version__ == "1.0.0"


class TestBackwardsCompatibleAliases:
    """ACIClient and ACIClientConfig should be aliases for the new CAR names."""

    def test_aci_client_is_car_client(self):
        assert ACIClient is CARClient

    def test_aci_client_config_is_car_client_config(self):
        assert ACIClientConfig is CARClientConfig


class TestAllExports:
    """Every symbol in __all__ should be importable from the package."""

    def test_all_is_defined(self):
        assert hasattr(vorion_car, "__all__")
        assert isinstance(vorion_car.__all__, list)
        assert len(vorion_car.__all__) > 0

    def test_all_symbols_importable(self):
        for name in vorion_car.__all__:
            assert hasattr(vorion_car, name), f"{name} listed in __all__ but not importable"

    def test_expected_exports_present(self):
        """Verify that key symbols appear in __all__."""
        expected = [
            "CARClient",
            "CARClientConfig",
            "ACIClient",
            "ACIClientConfig",
            "TrustTier",
            "AgentRole",
            "CreationType",
            "RoleGateDecision",
            "ComplianceStatus",
            "AlertSeverity",
            "AlertStatus",
            "DashboardStats",
            "RoleGateRequest",
            "RoleGateResponse",
            "CeilingCheckRequest",
            "CeilingCheckResponse",
            "ProvenanceCreateRequest",
            "ProvenanceRecord",
            "GamingAlert",
            "get_tier_from_score",
            "is_role_allowed_for_tier",
            "apply_provenance_modifier",
            "TRUST_TIER_RANGES",
            "ROLE_LABELS",
            "PROVENANCE_MODIFIERS",
        ]
        for name in expected:
            assert name in vorion_car.__all__, f"{name} missing from __all__"


class TestImportedTypesAreCorrect:
    """Sanity-check that the re-exports point to the right objects."""

    def test_enums_are_enum_classes(self):
        from enum import EnumMeta

        for cls in [TrustTier, AgentRole, CreationType, RoleGateDecision,
                    ComplianceStatus, AlertSeverity, AlertStatus]:
            assert isinstance(cls, EnumMeta), f"{cls} is not an enum"

    def test_models_are_pydantic(self):
        from pydantic import BaseModel

        for cls in [DashboardStats, ContextStats, CeilingStats, RoleGateStats,
                    PresetStats, ProvenanceStats, RoleGateRequest, RoleGateResponse,
                    CeilingCheckRequest, CeilingCheckResponse, ProvenanceCreateRequest,
                    ProvenanceRecord, GamingAlert]:
            assert issubclass(cls, BaseModel), f"{cls} is not a Pydantic model"

    def test_utils_are_callable(self):
        assert callable(get_tier_from_score)
        assert callable(is_role_allowed_for_tier)
        assert callable(apply_provenance_modifier)

    def test_constants_are_dicts(self):
        assert isinstance(TRUST_TIER_RANGES, dict)
        assert isinstance(ROLE_LABELS, dict)
        assert isinstance(PROVENANCE_MODIFIERS, dict)
