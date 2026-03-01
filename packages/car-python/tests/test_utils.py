"""
Tests for vorion_car.utils — trust tier calculations, role gate checks,
provenance modifiers, and label lookups.
"""

import pytest

from vorion_car.types import AgentRole, CreationType, TrustTier
from vorion_car.utils import (
    PROVENANCE_MODIFIERS,
    ROLE_GATE_MATRIX,
    ROLE_LABELS,
    TRUST_TIER_RANGES,
    apply_provenance_modifier,
    get_minimum_tier_for_role,
    get_role_label,
    get_tier_from_score,
    get_tier_label,
    is_role_allowed_for_tier,
)


# =============================================================================
# get_tier_from_score
# =============================================================================


class TestGetTierFromScore:
    """Boundary and interior tests for score-to-tier mapping."""

    @pytest.mark.parametrize(
        "score,expected_tier",
        [
            # Exact lower boundaries
            (0, TrustTier.T0),
            (100, TrustTier.T1),
            (300, TrustTier.T2),
            (500, TrustTier.T3),
            (700, TrustTier.T4),
            (900, TrustTier.T5),
            # Exact upper boundaries
            (99, TrustTier.T0),
            (299, TrustTier.T1),
            (499, TrustTier.T2),
            (699, TrustTier.T3),
            (899, TrustTier.T4),
            (1000, TrustTier.T5),
            # Interior points
            (50, TrustTier.T0),
            (200, TrustTier.T1),
            (400, TrustTier.T2),
            (600, TrustTier.T3),
            (800, TrustTier.T4),
            (950, TrustTier.T5),
        ],
    )
    def test_score_to_tier(self, score, expected_tier):
        assert get_tier_from_score(score) == expected_tier

    def test_negative_score_raises(self):
        with pytest.raises(ValueError, match="between 0 and 1000"):
            get_tier_from_score(-1)

    def test_score_above_1000_raises(self):
        with pytest.raises(ValueError, match="between 0 and 1000"):
            get_tier_from_score(1001)

    def test_large_negative_raises(self):
        with pytest.raises(ValueError):
            get_tier_from_score(-9999)


# =============================================================================
# is_role_allowed_for_tier
# =============================================================================


class TestIsRoleAllowedForTier:
    """Test the role gate kernel matrix."""

    def test_listener_allowed_everywhere(self):
        for tier in TrustTier:
            assert is_role_allowed_for_tier(AgentRole.R_L0, tier) is True

    def test_responder_allowed_everywhere(self):
        for tier in TrustTier:
            assert is_role_allowed_for_tier(AgentRole.R_L1, tier) is True

    def test_task_executor_denied_at_t0(self):
        assert is_role_allowed_for_tier(AgentRole.R_L2, TrustTier.T0) is False

    def test_task_executor_allowed_at_t1_and_above(self):
        for tier in [TrustTier.T1, TrustTier.T2, TrustTier.T3, TrustTier.T4, TrustTier.T5]:
            assert is_role_allowed_for_tier(AgentRole.R_L2, tier) is True

    def test_workflow_manager_requires_t2(self):
        assert is_role_allowed_for_tier(AgentRole.R_L3, TrustTier.T0) is False
        assert is_role_allowed_for_tier(AgentRole.R_L3, TrustTier.T1) is False
        assert is_role_allowed_for_tier(AgentRole.R_L3, TrustTier.T2) is True

    def test_domain_expert_requires_t3(self):
        assert is_role_allowed_for_tier(AgentRole.R_L4, TrustTier.T2) is False
        assert is_role_allowed_for_tier(AgentRole.R_L4, TrustTier.T3) is True

    def test_resource_controller_requires_t4(self):
        assert is_role_allowed_for_tier(AgentRole.R_L5, TrustTier.T3) is False
        assert is_role_allowed_for_tier(AgentRole.R_L5, TrustTier.T4) is True

    def test_sovereign_only_roles(self):
        """R_L6, R_L7, R_L8 should only be allowed at T5."""
        sovereign_roles = [AgentRole.R_L6, AgentRole.R_L7, AgentRole.R_L8]
        for role in sovereign_roles:
            for tier in [TrustTier.T0, TrustTier.T1, TrustTier.T2, TrustTier.T3, TrustTier.T4]:
                assert is_role_allowed_for_tier(role, tier) is False, (
                    f"{role} should be denied at {tier}"
                )
            assert is_role_allowed_for_tier(role, TrustTier.T5) is True

    def test_matrix_completeness(self):
        """Every (role, tier) pair should have an entry in ROLE_GATE_MATRIX."""
        for role in AgentRole:
            assert role in ROLE_GATE_MATRIX, f"{role} missing from ROLE_GATE_MATRIX"
            for tier in TrustTier:
                assert tier in ROLE_GATE_MATRIX[role], (
                    f"({role}, {tier}) missing from ROLE_GATE_MATRIX"
                )


# =============================================================================
# apply_provenance_modifier
# =============================================================================


class TestApplyProvenanceModifier:
    """Provenance modifier application and clamping."""

    @pytest.mark.parametrize(
        "base,creation_type,expected",
        [
            (500, CreationType.FRESH, 500),
            (500, CreationType.CLONED, 450),
            (500, CreationType.EVOLVED, 600),
            (500, CreationType.PROMOTED, 650),
            (500, CreationType.IMPORTED, 400),
        ],
    )
    def test_modifier_values(self, base, creation_type, expected):
        assert apply_provenance_modifier(base, creation_type) == expected

    def test_clamp_to_zero(self):
        """Score should never go below 0."""
        result = apply_provenance_modifier(30, CreationType.IMPORTED)
        assert result == 0

    def test_clamp_to_1000(self):
        """Score should never exceed 1000."""
        result = apply_provenance_modifier(950, CreationType.PROMOTED)
        assert result == 1000

    def test_zero_base_with_negative_modifier(self):
        result = apply_provenance_modifier(0, CreationType.CLONED)
        assert result == 0

    def test_max_base_with_positive_modifier(self):
        result = apply_provenance_modifier(1000, CreationType.EVOLVED)
        assert result == 1000

    def test_all_modifiers_are_ints(self):
        for creation_type, modifier in PROVENANCE_MODIFIERS.items():
            assert isinstance(modifier, int), f"Modifier for {creation_type} is not int"


# =============================================================================
# get_minimum_tier_for_role
# =============================================================================


class TestGetMinimumTierForRole:
    """Test minimum tier lookup for each role."""

    @pytest.mark.parametrize(
        "role,expected_tier",
        [
            (AgentRole.R_L0, TrustTier.T0),
            (AgentRole.R_L1, TrustTier.T0),
            (AgentRole.R_L2, TrustTier.T1),
            (AgentRole.R_L3, TrustTier.T2),
            (AgentRole.R_L4, TrustTier.T3),
            (AgentRole.R_L5, TrustTier.T4),
            (AgentRole.R_L6, TrustTier.T5),
            (AgentRole.R_L7, TrustTier.T5),
            (AgentRole.R_L8, TrustTier.T5),
        ],
    )
    def test_minimum_tier(self, role, expected_tier):
        assert get_minimum_tier_for_role(role) == expected_tier


# =============================================================================
# LABEL LOOKUPS
# =============================================================================


class TestGetTierLabel:
    @pytest.mark.parametrize(
        "tier,label",
        [
            (TrustTier.T0, "Sandbox"),
            (TrustTier.T1, "Probation"),
            (TrustTier.T2, "Limited"),
            (TrustTier.T3, "Standard"),
            (TrustTier.T4, "Trusted"),
            (TrustTier.T5, "Sovereign"),
        ],
    )
    def test_tier_labels(self, tier, label):
        assert get_tier_label(tier) == label


class TestGetRoleLabel:
    @pytest.mark.parametrize(
        "role,label",
        [
            (AgentRole.R_L0, "Listener"),
            (AgentRole.R_L1, "Responder"),
            (AgentRole.R_L2, "Task Executor"),
            (AgentRole.R_L3, "Workflow Manager"),
            (AgentRole.R_L4, "Domain Expert"),
            (AgentRole.R_L5, "Resource Controller"),
            (AgentRole.R_L6, "System Administrator"),
            (AgentRole.R_L7, "Trust Governor"),
            (AgentRole.R_L8, "Ecosystem Controller"),
        ],
    )
    def test_role_labels(self, role, label):
        assert get_role_label(role) == label


# =============================================================================
# CONSTANTS INTEGRITY
# =============================================================================


class TestConstantsIntegrity:
    """Ensure constants cover all enum members and ranges are non-overlapping."""

    def test_trust_tier_ranges_cover_all_tiers(self):
        for tier in TrustTier:
            assert tier in TRUST_TIER_RANGES

    def test_trust_tier_ranges_are_contiguous(self):
        """Ranges should cover 0-1000 without gaps or overlaps."""
        sorted_ranges = sorted(TRUST_TIER_RANGES.values(), key=lambda r: r[0])
        assert sorted_ranges[0][0] == 0, "Range should start at 0"
        assert sorted_ranges[-1][1] == 1000, "Range should end at 1000"
        for i in range(len(sorted_ranges) - 1):
            current_end = sorted_ranges[i][1]
            next_start = sorted_ranges[i + 1][0]
            assert next_start == current_end + 1, (
                f"Gap or overlap between {sorted_ranges[i]} and {sorted_ranges[i+1]}"
            )

    def test_role_labels_cover_all_roles(self):
        for role in AgentRole:
            assert role in ROLE_LABELS

    def test_provenance_modifiers_cover_all_types(self):
        for ct in CreationType:
            assert ct in PROVENANCE_MODIFIERS
