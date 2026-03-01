"""
Tests for vorion_car.types — Pydantic models and enum definitions.
"""

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from vorion_car.types import (
    AgentRole,
    AlertSeverity,
    AlertStatus,
    CeilingCheckRequest,
    CeilingCheckResponse,
    CeilingStats,
    ComplianceBreakdown,
    ComplianceStatus,
    ContextStats,
    CreationType,
    DashboardStats,
    DecisionBreakdown,
    GamingAlert,
    PresetStats,
    ProvenanceCreateRequest,
    ProvenanceRecord,
    ProvenanceStats,
    RoleGateDecision,
    RoleGateRequest,
    RoleGateResponse,
    RoleGateStats,
    TrustTier,
)


# =============================================================================
# ENUM TESTS
# =============================================================================


class TestTrustTier:
    """TrustTier enum values and membership."""

    def test_all_tiers_present(self):
        assert len(TrustTier) == 6

    @pytest.mark.parametrize(
        "member,value",
        [
            (TrustTier.T0, "T0"),
            (TrustTier.T1, "T1"),
            (TrustTier.T2, "T2"),
            (TrustTier.T3, "T3"),
            (TrustTier.T4, "T4"),
            (TrustTier.T5, "T5"),
        ],
    )
    def test_tier_values(self, member, value):
        assert member.value == value

    def test_tiers_are_str_enum(self):
        """TrustTier inherits from str so it can be used directly in string contexts."""
        assert isinstance(TrustTier.T0, str)


class TestAgentRole:
    """AgentRole enum values and membership."""

    def test_all_roles_present(self):
        assert len(AgentRole) == 9

    @pytest.mark.parametrize(
        "member,value",
        [
            (AgentRole.R_L0, "R_L0"),
            (AgentRole.R_L1, "R_L1"),
            (AgentRole.R_L2, "R_L2"),
            (AgentRole.R_L3, "R_L3"),
            (AgentRole.R_L4, "R_L4"),
            (AgentRole.R_L5, "R_L5"),
            (AgentRole.R_L6, "R_L6"),
            (AgentRole.R_L7, "R_L7"),
            (AgentRole.R_L8, "R_L8"),
        ],
    )
    def test_role_values(self, member, value):
        assert member.value == value


class TestCreationType:
    """CreationType enum values and membership."""

    def test_all_types_present(self):
        assert len(CreationType) == 5

    @pytest.mark.parametrize(
        "member,value",
        [
            (CreationType.FRESH, "FRESH"),
            (CreationType.CLONED, "CLONED"),
            (CreationType.EVOLVED, "EVOLVED"),
            (CreationType.PROMOTED, "PROMOTED"),
            (CreationType.IMPORTED, "IMPORTED"),
        ],
    )
    def test_type_values(self, member, value):
        assert member.value == value


class TestRoleGateDecision:
    def test_all_decisions_present(self):
        assert len(RoleGateDecision) == 3

    def test_values(self):
        assert RoleGateDecision.ALLOW.value == "ALLOW"
        assert RoleGateDecision.DENY.value == "DENY"
        assert RoleGateDecision.ESCALATE.value == "ESCALATE"


class TestComplianceStatus:
    def test_all_statuses_present(self):
        assert len(ComplianceStatus) == 3

    def test_values(self):
        assert ComplianceStatus.COMPLIANT.value == "COMPLIANT"
        assert ComplianceStatus.WARNING.value == "WARNING"
        assert ComplianceStatus.VIOLATION.value == "VIOLATION"


class TestAlertSeverity:
    def test_all_severities_present(self):
        assert len(AlertSeverity) == 4

    def test_values(self):
        assert AlertSeverity.LOW.value == "LOW"
        assert AlertSeverity.MEDIUM.value == "MEDIUM"
        assert AlertSeverity.HIGH.value == "HIGH"
        assert AlertSeverity.CRITICAL.value == "CRITICAL"


class TestAlertStatus:
    def test_all_statuses_present(self):
        assert len(AlertStatus) == 4

    def test_values(self):
        assert AlertStatus.ACTIVE.value == "ACTIVE"
        assert AlertStatus.INVESTIGATING.value == "INVESTIGATING"
        assert AlertStatus.RESOLVED.value == "RESOLVED"
        assert AlertStatus.FALSE_POSITIVE.value == "FALSE_POSITIVE"


# =============================================================================
# STATS MODEL TESTS
# =============================================================================


class TestContextStats:
    def test_defaults(self):
        stats = ContextStats()
        assert stats.deployments == 0
        assert stats.organizations == 0
        assert stats.agents == 0
        assert stats.active_operations == 0

    def test_from_alias_keys(self):
        stats = ContextStats.model_validate(
            {"deployments": 5, "organizations": 2, "agents": 10, "activeOperations": 3}
        )
        assert stats.active_operations == 3

    def test_serialization_with_alias(self):
        stats = ContextStats(deployments=1, organizations=1, agents=5, activeOperations=2)
        data = stats.model_dump(by_alias=True)
        assert "activeOperations" in data
        assert data["activeOperations"] == 2


class TestComplianceBreakdown:
    def test_defaults(self):
        cb = ComplianceBreakdown()
        assert cb.compliant == 0
        assert cb.warning == 0
        assert cb.violation == 0


class TestCeilingStats:
    def test_from_alias_keys(self):
        stats = CeilingStats.model_validate(
            {
                "totalEvents": 100,
                "totalAuditEntries": 50,
                "complianceBreakdown": {"compliant": 40, "warning": 8, "violation": 2},
                "agentsWithAlerts": 3,
            }
        )
        assert stats.total_events == 100
        assert stats.total_audit_entries == 50
        assert stats.compliance_breakdown.compliant == 40
        assert stats.agents_with_alerts == 3

    def test_defaults(self):
        stats = CeilingStats()
        assert stats.total_events == 0
        assert stats.compliance_breakdown.compliant == 0


class TestDecisionBreakdown:
    def test_defaults(self):
        db = DecisionBreakdown()
        assert db.ALLOW == 0
        assert db.DENY == 0
        assert db.ESCALATE == 0


class TestRoleGateStats:
    def test_from_alias_keys(self):
        stats = RoleGateStats.model_validate(
            {
                "totalEvaluations": 50,
                "byDecision": {"ALLOW": 40, "DENY": 8, "ESCALATE": 2},
            }
        )
        assert stats.total_evaluations == 50
        assert stats.by_decision.ALLOW == 40


class TestPresetStats:
    def test_from_alias_keys(self):
        stats = PresetStats.model_validate(
            {
                "aciPresets": 5,
                "vorionPresets": 3,
                "axiomPresets": 2,
                "verifiedLineages": 8,
            }
        )
        assert stats.aci_presets == 5
        assert stats.verified_lineages == 8


class TestProvenanceStats:
    def test_from_alias_keys(self):
        stats = ProvenanceStats.model_validate(
            {"totalRecords": 10, "byCreationType": {"FRESH": 5, "CLONED": 5}}
        )
        assert stats.total_records == 10
        assert stats.by_creation_type["FRESH"] == 5


class TestDashboardStats:
    def test_full_deserialization(self, dashboard_stats_payload):
        stats = DashboardStats.model_validate(dashboard_stats_payload)
        assert stats.context_stats.agents == 42
        assert stats.ceiling_stats.total_events == 150
        assert stats.role_gate_stats.total_evaluations == 200
        assert stats.preset_stats.aci_presets == 5
        assert stats.provenance_stats.total_records == 42

    def test_requires_all_nested_stats(self):
        """DashboardStats should fail without required nested fields."""
        with pytest.raises(ValidationError):
            DashboardStats.model_validate({})

    def test_round_trip_serialization(self, dashboard_stats_payload):
        """Deserialize then re-serialize; aliases should be preserved."""
        stats = DashboardStats.model_validate(dashboard_stats_payload)
        data = stats.model_dump(by_alias=True)
        assert data["contextStats"]["activeOperations"] == 7
        assert data["roleGateStats"]["byDecision"]["ALLOW"] == 170


# =============================================================================
# ROLE GATE MODEL TESTS
# =============================================================================


class TestRoleGateRequest:
    def test_valid_construction(self):
        req = RoleGateRequest.model_validate(
            {
                "agentId": "agent-1",
                "requestedRole": "R_L2",
                "currentTier": "T3",
                "currentScore": 550,
            }
        )
        assert req.agent_id == "agent-1"
        assert req.requested_role == AgentRole.R_L2
        assert req.current_tier == TrustTier.T3
        assert req.current_score == 550
        assert req.operation_id is None
        assert req.attestations is None

    def test_score_lower_bound(self):
        with pytest.raises(ValidationError):
            RoleGateRequest.model_validate(
                {
                    "agentId": "a",
                    "requestedRole": "R_L0",
                    "currentTier": "T0",
                    "currentScore": -1,
                }
            )

    def test_score_upper_bound(self):
        with pytest.raises(ValidationError):
            RoleGateRequest.model_validate(
                {
                    "agentId": "a",
                    "requestedRole": "R_L0",
                    "currentTier": "T5",
                    "currentScore": 1001,
                }
            )

    def test_invalid_role_rejected(self):
        with pytest.raises(ValidationError):
            RoleGateRequest.model_validate(
                {
                    "agentId": "a",
                    "requestedRole": "INVALID",
                    "currentTier": "T0",
                    "currentScore": 50,
                }
            )

    def test_serialization_uses_aliases(self):
        req = RoleGateRequest.model_validate(
            {
                "agentId": "agent-1",
                "requestedRole": "R_L3",
                "currentTier": "T4",
                "currentScore": 750,
                "operationId": "op-99",
            }
        )
        data = req.model_dump(by_alias=True)
        assert data["agentId"] == "agent-1"
        assert data["requestedRole"] == "R_L3"
        assert data["operationId"] == "op-99"

    def test_with_attestations(self):
        req = RoleGateRequest.model_validate(
            {
                "agentId": "agent-1",
                "requestedRole": "R_L4",
                "currentTier": "T3",
                "currentScore": 600,
                "attestations": ["att-a", "att-b"],
            }
        )
        assert req.attestations == ["att-a", "att-b"]


class TestRoleGateResponse:
    def test_deserialization(self, role_gate_response_payload):
        resp = RoleGateResponse.model_validate(role_gate_response_payload)
        assert resp.decision == RoleGateDecision.ALLOW
        assert resp.kernel_allowed is True
        assert resp.policy_applied == "default-policy"
        assert resp.basis_override is False
        assert resp.evaluation_id == "eval-abc-123"

    def test_deny_response(self):
        resp = RoleGateResponse.model_validate(
            {
                "decision": "DENY",
                "reason": "Insufficient tier",
                "kernelAllowed": False,
                "basisOverride": False,
                "evaluationId": "eval-xyz",
            }
        )
        assert resp.decision == RoleGateDecision.DENY
        assert resp.kernel_allowed is False
        assert resp.policy_applied is None


# =============================================================================
# CEILING MODEL TESTS
# =============================================================================


class TestCeilingCheckRequest:
    def test_valid_construction(self):
        req = CeilingCheckRequest.model_validate(
            {"agentId": "agent-1", "currentScore": 500}
        )
        assert req.agent_id == "agent-1"
        assert req.current_score == 500
        assert req.target_score is None

    def test_with_target_score(self):
        req = CeilingCheckRequest.model_validate(
            {"agentId": "agent-1", "currentScore": 500, "targetScore": 700}
        )
        assert req.target_score == 700

    def test_score_validation(self):
        with pytest.raises(ValidationError):
            CeilingCheckRequest.model_validate(
                {"agentId": "a", "currentScore": -5}
            )

        with pytest.raises(ValidationError):
            CeilingCheckRequest.model_validate(
                {"agentId": "a", "currentScore": 1001}
            )

    def test_target_score_validation(self):
        with pytest.raises(ValidationError):
            CeilingCheckRequest.model_validate(
                {"agentId": "a", "currentScore": 500, "targetScore": 1500}
            )


class TestCeilingCheckResponse:
    def test_deserialization(self, ceiling_check_response_payload):
        resp = CeilingCheckResponse.model_validate(ceiling_check_response_payload)
        assert resp.ceiling_applied is False
        assert resp.effective_score == 550
        assert resp.ceiling_source is None
        assert resp.compliance_status == ComplianceStatus.COMPLIANT
        assert resp.original_tier == TrustTier.T3
        assert resp.effective_tier == TrustTier.T3

    def test_with_ceiling_applied(self):
        resp = CeilingCheckResponse.model_validate(
            {
                "ceilingApplied": True,
                "effectiveScore": 699,
                "ceilingSource": "org-policy:max-T3",
                "complianceStatus": "WARNING",
                "originalTier": "T4",
                "effectiveTier": "T3",
            }
        )
        assert resp.ceiling_applied is True
        assert resp.ceiling_source == "org-policy:max-T3"
        assert resp.compliance_status == ComplianceStatus.WARNING
        assert resp.original_tier == TrustTier.T4
        assert resp.effective_tier == TrustTier.T3


# =============================================================================
# PROVENANCE MODEL TESTS
# =============================================================================


class TestProvenanceCreateRequest:
    def test_minimal(self):
        req = ProvenanceCreateRequest.model_validate(
            {"agentId": "agent-1", "creationType": "FRESH"}
        )
        assert req.agent_id == "agent-1"
        assert req.creation_type == CreationType.FRESH
        assert req.parent_agent_id is None
        assert req.metadata is None

    def test_with_parent_and_metadata(self):
        req = ProvenanceCreateRequest.model_validate(
            {
                "agentId": "agent-child",
                "creationType": "CLONED",
                "parentAgentId": "agent-parent",
                "metadata": {"reason": "scaling"},
            }
        )
        assert req.parent_agent_id == "agent-parent"
        assert req.metadata == {"reason": "scaling"}

    def test_invalid_creation_type(self):
        with pytest.raises(ValidationError):
            ProvenanceCreateRequest.model_validate(
                {"agentId": "a", "creationType": "UNKNOWN_TYPE"}
            )


class TestProvenanceRecord:
    def test_deserialization(self):
        record = ProvenanceRecord.model_validate(
            {
                "id": "prov-001",
                "agentId": "agent-alpha",
                "creationType": "EVOLVED",
                "parentAgentId": "agent-beta",
                "lineageHash": "sha256:abc",
                "scoreModifier": 100,
                "verified": True,
                "createdAt": "2025-12-01T10:00:00Z",
            }
        )
        assert record.id == "prov-001"
        assert record.creation_type == CreationType.EVOLVED
        assert record.parent_agent_id == "agent-beta"
        assert record.score_modifier == 100
        assert record.verified is True
        assert isinstance(record.created_at, datetime)

    def test_defaults(self):
        record = ProvenanceRecord.model_validate(
            {
                "id": "prov-002",
                "agentId": "agent-gamma",
                "creationType": "FRESH",
                "scoreModifier": 0,
                "createdAt": "2025-12-01T00:00:00Z",
            }
        )
        assert record.parent_agent_id is None
        assert record.lineage_hash is None
        assert record.verified is False


# =============================================================================
# ALERT MODEL TESTS
# =============================================================================


class TestGamingAlert:
    def test_deserialization(self, alerts_list_response_payload):
        raw = alerts_list_response_payload["alerts"][0]
        alert = GamingAlert.model_validate(raw)
        assert alert.id == "alert-001"
        assert alert.agent_id == "agent-suspect"
        assert alert.alert_type == "RAPID_SCORE_INCREASE"
        assert alert.severity == AlertSeverity.HIGH
        assert alert.status == AlertStatus.ACTIVE
        assert alert.threshold_value == 100.0
        assert alert.actual_value == 300.0
        assert alert.resolved_at is None
        assert alert.resolved_by is None
        assert isinstance(alert.created_at, datetime)

    def test_resolved_alert(self, alert_update_response_payload):
        raw = alert_update_response_payload["alert"]
        alert = GamingAlert.model_validate(raw)
        assert alert.status == AlertStatus.RESOLVED
        assert alert.resolved_by == "admin@vorion.dev"
        assert isinstance(alert.resolved_at, datetime)

    def test_details_default_empty_dict(self):
        alert = GamingAlert.model_validate(
            {
                "id": "alert-x",
                "agentId": "a",
                "alertType": "TEST",
                "severity": "LOW",
                "status": "ACTIVE",
                "createdAt": "2025-01-01T00:00:00Z",
            }
        )
        assert alert.details == {}
        assert alert.threshold_value is None
        assert alert.actual_value is None
