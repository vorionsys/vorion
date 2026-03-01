"""
Shared test fixtures for the vorion-car package.
"""

from datetime import datetime, timezone

import pytest

from vorion_car.types import (
    AgentRole,
    AlertSeverity,
    AlertStatus,
    CeilingCheckResponse,
    ComplianceStatus,
    CreationType,
    DashboardStats,
    GamingAlert,
    ProvenanceRecord,
    RoleGateDecision,
    RoleGateResponse,
    TrustTier,
)


# =============================================================================
# SAMPLE API RESPONSE PAYLOADS
# =============================================================================


@pytest.fixture()
def dashboard_stats_payload() -> dict:
    """Raw JSON payload matching the /api/phase6/stats endpoint."""
    return {
        "contextStats": {
            "deployments": 3,
            "organizations": 2,
            "agents": 42,
            "activeOperations": 7,
        },
        "ceilingStats": {
            "totalEvents": 150,
            "totalAuditEntries": 80,
            "complianceBreakdown": {
                "compliant": 35,
                "warning": 5,
                "violation": 2,
            },
            "agentsWithAlerts": 3,
        },
        "roleGateStats": {
            "totalEvaluations": 200,
            "byDecision": {"ALLOW": 170, "DENY": 20, "ESCALATE": 10},
        },
        "presetStats": {
            "aciPresets": 5,
            "vorionPresets": 3,
            "axiomPresets": 2,
            "verifiedLineages": 8,
        },
        "provenanceStats": {
            "totalRecords": 42,
            "byCreationType": {"FRESH": 20, "CLONED": 10, "EVOLVED": 12},
        },
    }


@pytest.fixture()
def role_gate_response_payload() -> dict:
    """Raw JSON payload matching the /api/phase6/role-gates endpoint."""
    return {
        "decision": "ALLOW",
        "reason": "Role R_L2 is allowed at tier T3",
        "kernelAllowed": True,
        "policyApplied": "default-policy",
        "basisOverride": False,
        "evaluationId": "eval-abc-123",
    }


@pytest.fixture()
def ceiling_check_response_payload() -> dict:
    """Raw JSON payload matching the /api/phase6/ceiling endpoint."""
    return {
        "ceilingApplied": False,
        "effectiveScore": 550,
        "ceilingSource": None,
        "complianceStatus": "COMPLIANT",
        "originalTier": "T3",
        "effectiveTier": "T3",
    }


@pytest.fixture()
def provenance_create_response_payload() -> dict:
    """Raw JSON payload matching the POST /api/phase6/provenance endpoint."""
    return {
        "record": {
            "id": "prov-001",
            "agentId": "agent-alpha",
            "creationType": "FRESH",
            "parentAgentId": None,
            "lineageHash": "sha256:abc123",
            "scoreModifier": 0,
            "verified": True,
            "createdAt": "2025-12-01T10:00:00Z",
        }
    }


@pytest.fixture()
def provenance_list_response_payload() -> dict:
    """Raw JSON payload matching the GET /api/phase6/provenance endpoint."""
    return {
        "records": [
            {
                "id": "prov-001",
                "agentId": "agent-alpha",
                "creationType": "FRESH",
                "parentAgentId": None,
                "lineageHash": "sha256:abc123",
                "scoreModifier": 0,
                "verified": True,
                "createdAt": "2025-12-01T10:00:00Z",
            },
            {
                "id": "prov-002",
                "agentId": "agent-alpha",
                "creationType": "EVOLVED",
                "parentAgentId": "agent-beta",
                "lineageHash": "sha256:def456",
                "scoreModifier": 100,
                "verified": False,
                "createdAt": "2025-12-15T14:30:00Z",
            },
        ]
    }


@pytest.fixture()
def alerts_list_response_payload() -> dict:
    """Raw JSON payload matching the GET /api/phase6/alerts endpoint."""
    return {
        "alerts": [
            {
                "id": "alert-001",
                "agentId": "agent-suspect",
                "alertType": "RAPID_SCORE_INCREASE",
                "severity": "HIGH",
                "status": "ACTIVE",
                "details": {"scoreJump": 300, "timeWindowMinutes": 5},
                "thresholdValue": 100.0,
                "actualValue": 300.0,
                "createdAt": "2025-12-20T08:00:00Z",
                "resolvedAt": None,
                "resolvedBy": None,
            }
        ]
    }


@pytest.fixture()
def alert_update_response_payload() -> dict:
    """Raw JSON payload matching the PATCH /api/phase6/alerts/:id endpoint."""
    return {
        "alert": {
            "id": "alert-001",
            "agentId": "agent-suspect",
            "alertType": "RAPID_SCORE_INCREASE",
            "severity": "HIGH",
            "status": "RESOLVED",
            "details": {"scoreJump": 300, "timeWindowMinutes": 5},
            "thresholdValue": 100.0,
            "actualValue": 300.0,
            "createdAt": "2025-12-20T08:00:00Z",
            "resolvedAt": "2025-12-20T09:15:00Z",
            "resolvedBy": "admin@vorion.dev",
        }
    }
