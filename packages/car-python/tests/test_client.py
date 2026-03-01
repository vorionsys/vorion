"""
Tests for vorion_car.client — CARClient, CARClientConfig, CARError.

All HTTP calls are mocked via pytest-httpx so no real network traffic occurs.
"""

from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from pytest_httpx import HTTPXMock

from vorion_car.client import CARClient, CARClientConfig, CARError
from vorion_car.types import (
    AlertStatus,
    CeilingCheckRequest,
    CeilingCheckResponse,
    ComplianceStatus,
    CreationType,
    DashboardStats,
    GamingAlert,
    ProvenanceCreateRequest,
    ProvenanceRecord,
    RoleGateDecision,
    RoleGateRequest,
    RoleGateResponse,
    TrustTier,
    AgentRole,
)

BASE_URL = "https://api.vorion.test"
API_KEY = "test-key-abc123"


# =============================================================================
# CARClientConfig
# =============================================================================


class TestCARClientConfig:
    def test_defaults(self):
        cfg = CARClientConfig(base_url="https://api.example.com")
        assert cfg.base_url == "https://api.example.com"
        assert cfg.api_key is None
        assert cfg.timeout == 30.0
        assert cfg.retry_count == 3
        assert cfg.retry_delay == 1.0

    def test_custom_values(self):
        cfg = CARClientConfig(
            base_url="https://api.example.com",
            api_key="key-123",
            timeout=60.0,
            retry_count=5,
            retry_delay=2.5,
        )
        assert cfg.api_key == "key-123"
        assert cfg.timeout == 60.0
        assert cfg.retry_count == 5
        assert cfg.retry_delay == 2.5


# =============================================================================
# CARError
# =============================================================================


class TestCARError:
    def test_basic_error(self):
        err = CARError("something went wrong")
        assert str(err) == "something went wrong"
        assert err.status_code is None
        assert err.code is None
        assert err.details == {}

    def test_full_error(self):
        err = CARError(
            message="Unauthorized",
            status_code=401,
            code="AUTH_REQUIRED",
            details={"hint": "Provide a Bearer token"},
        )
        assert err.status_code == 401
        assert err.code == "AUTH_REQUIRED"
        assert err.details["hint"] == "Provide a Bearer token"


# =============================================================================
# CARClient — initialization and lifecycle
# =============================================================================


class TestCARClientInit:
    def test_trailing_slash_stripped(self):
        client = CARClient(f"{BASE_URL}/")
        assert client.config.base_url == BASE_URL

    def test_default_config(self):
        client = CARClient(BASE_URL)
        assert client.config.timeout == 30.0
        assert client.config.api_key is None
        assert client._client is None

    def test_api_key_stored(self):
        client = CARClient(BASE_URL, api_key=API_KEY)
        assert client.config.api_key == API_KEY

    def test_custom_timeout(self):
        client = CARClient(BASE_URL, timeout=120.0)
        assert client.config.timeout == 120.0


class TestCARClientLifecycle:
    @pytest.mark.asyncio
    async def test_ensure_client_creates_httpx_client(self):
        client = CARClient(BASE_URL, api_key=API_KEY)
        http_client = await client._ensure_client()
        try:
            assert isinstance(http_client, httpx.AsyncClient)
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_ensure_client_idempotent(self):
        client = CARClient(BASE_URL)
        c1 = await client._ensure_client()
        c2 = await client._ensure_client()
        try:
            assert c1 is c2
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_close_sets_client_to_none(self):
        client = CARClient(BASE_URL)
        await client._ensure_client()
        assert client._client is not None
        await client.close()
        assert client._client is None

    @pytest.mark.asyncio
    async def test_close_is_safe_when_already_closed(self):
        client = CARClient(BASE_URL)
        await client.close()  # should not raise

    @pytest.mark.asyncio
    async def test_async_context_manager(self):
        async with CARClient(BASE_URL, api_key=API_KEY) as client:
            assert client._client is not None
        assert client._client is None

    @pytest.mark.asyncio
    async def test_auth_header_set(self):
        client = CARClient(BASE_URL, api_key=API_KEY)
        http_client = await client._ensure_client()
        try:
            assert http_client.headers["Authorization"] == f"Bearer {API_KEY}"
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_no_auth_header_when_no_key(self):
        client = CARClient(BASE_URL)
        http_client = await client._ensure_client()
        try:
            assert "Authorization" not in http_client.headers
        finally:
            await client.close()

    @pytest.mark.asyncio
    async def test_content_type_header(self):
        client = CARClient(BASE_URL, api_key=API_KEY)
        http_client = await client._ensure_client()
        try:
            assert http_client.headers["Content-Type"] == "application/json"
        finally:
            await client.close()


# =============================================================================
# CARClient._request — error handling
# =============================================================================


class TestCARClientRequestErrors:
    @pytest.mark.asyncio
    async def test_json_error_response(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(
            url=f"{BASE_URL}/api/phase6/stats",
            status_code=403,
            json={
                "error": {
                    "message": "Forbidden",
                    "code": "FORBIDDEN",
                    "details": {"reason": "insufficient permissions"},
                }
            },
        )
        async with CARClient(BASE_URL, api_key=API_KEY) as client:
            with pytest.raises(CARError) as exc_info:
                await client.get_stats()
            assert exc_info.value.status_code == 403
            assert exc_info.value.code == "FORBIDDEN"
            assert exc_info.value.details["reason"] == "insufficient permissions"

    @pytest.mark.asyncio
    async def test_non_json_error_response(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(
            url=f"{BASE_URL}/api/phase6/stats",
            status_code=502,
            text="Bad Gateway",
        )
        async with CARClient(BASE_URL) as client:
            with pytest.raises(CARError) as exc_info:
                await client.get_stats()
            assert exc_info.value.status_code == 502
            assert "502" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_error_with_missing_fields(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(
            url=f"{BASE_URL}/api/phase6/stats",
            status_code=500,
            json={"error": {}},
        )
        async with CARClient(BASE_URL) as client:
            with pytest.raises(CARError) as exc_info:
                await client.get_stats()
            assert exc_info.value.status_code == 500
            assert exc_info.value.code is None


# =============================================================================
# CARClient.get_stats
# =============================================================================


class TestGetStats:
    @pytest.mark.asyncio
    async def test_get_stats_success(
        self, httpx_mock: HTTPXMock, dashboard_stats_payload: dict
    ):
        httpx_mock.add_response(
            url=f"{BASE_URL}/api/phase6/stats",
            json=dashboard_stats_payload,
        )
        async with CARClient(BASE_URL, api_key=API_KEY) as client:
            stats = await client.get_stats()

        assert isinstance(stats, DashboardStats)
        assert stats.context_stats.agents == 42
        assert stats.ceiling_stats.total_events == 150
        assert stats.role_gate_stats.by_decision.ALLOW == 170
        assert stats.provenance_stats.total_records == 42


# =============================================================================
# CARClient.evaluate_role_gate
# =============================================================================


class TestEvaluateRoleGate:
    @pytest.mark.asyncio
    async def test_allow_decision(
        self, httpx_mock: HTTPXMock, role_gate_response_payload: dict
    ):
        httpx_mock.add_response(
            url=f"{BASE_URL}/api/phase6/role-gates",
            json=role_gate_response_payload,
        )
        req = RoleGateRequest.model_validate(
            {
                "agentId": "agent-1",
                "requestedRole": "R_L2",
                "currentTier": "T3",
                "currentScore": 550,
            }
        )
        async with CARClient(BASE_URL, api_key=API_KEY) as client:
            resp = await client.evaluate_role_gate(req)

        assert isinstance(resp, RoleGateResponse)
        assert resp.decision == RoleGateDecision.ALLOW
        assert resp.kernel_allowed is True
        assert resp.evaluation_id == "eval-abc-123"

    @pytest.mark.asyncio
    async def test_role_gate_sends_correct_payload(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(
            url=f"{BASE_URL}/api/phase6/role-gates",
            json={
                "decision": "DENY",
                "reason": "test",
                "kernelAllowed": False,
                "basisOverride": False,
                "evaluationId": "eval-1",
            },
        )
        req = RoleGateRequest.model_validate(
            {
                "agentId": "agent-1",
                "requestedRole": "R_L5",
                "currentTier": "T2",
                "currentScore": 350,
                "operationId": "op-42",
            }
        )
        async with CARClient(BASE_URL, api_key=API_KEY) as client:
            await client.evaluate_role_gate(req)

        request = httpx_mock.get_request()
        assert request.method == "POST"
        import json

        body = json.loads(request.content)
        assert body["agentId"] == "agent-1"
        assert body["requestedRole"] == "R_L5"
        assert body["currentTier"] == "T2"
        assert body["currentScore"] == 350
        assert body["operationId"] == "op-42"


# =============================================================================
# CARClient.check_ceiling
# =============================================================================


class TestCheckCeiling:
    @pytest.mark.asyncio
    async def test_check_ceiling_success(
        self, httpx_mock: HTTPXMock, ceiling_check_response_payload: dict
    ):
        httpx_mock.add_response(
            url=f"{BASE_URL}/api/phase6/ceiling",
            json=ceiling_check_response_payload,
        )
        req = CeilingCheckRequest.model_validate(
            {"agentId": "agent-1", "currentScore": 550}
        )
        async with CARClient(BASE_URL) as client:
            resp = await client.check_ceiling(req)

        assert isinstance(resp, CeilingCheckResponse)
        assert resp.effective_score == 550
        assert resp.compliance_status == ComplianceStatus.COMPLIANT

    @pytest.mark.asyncio
    async def test_check_ceiling_sends_correct_payload(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(
            url=f"{BASE_URL}/api/phase6/ceiling",
            json={
                "ceilingApplied": True,
                "effectiveScore": 699,
                "ceilingSource": "org-limit",
                "complianceStatus": "WARNING",
                "originalTier": "T4",
                "effectiveTier": "T3",
            },
        )
        req = CeilingCheckRequest.model_validate(
            {"agentId": "agent-x", "currentScore": 750, "targetScore": 800}
        )
        async with CARClient(BASE_URL) as client:
            await client.check_ceiling(req)

        request = httpx_mock.get_request()
        assert request.method == "POST"
        import json

        body = json.loads(request.content)
        assert body["agentId"] == "agent-x"
        assert body["currentScore"] == 750
        assert body["targetScore"] == 800


# =============================================================================
# CARClient.create_provenance / get_provenance
# =============================================================================


class TestProvenance:
    @pytest.mark.asyncio
    async def test_create_provenance(
        self, httpx_mock: HTTPXMock, provenance_create_response_payload: dict
    ):
        httpx_mock.add_response(
            url=f"{BASE_URL}/api/phase6/provenance",
            json=provenance_create_response_payload,
        )
        req = ProvenanceCreateRequest.model_validate(
            {"agentId": "agent-alpha", "creationType": "FRESH"}
        )
        async with CARClient(BASE_URL, api_key=API_KEY) as client:
            result = await client.create_provenance(req)

        assert "record" in result
        record = result["record"]
        assert isinstance(record, ProvenanceRecord)
        assert record.id == "prov-001"
        assert record.agent_id == "agent-alpha"
        assert record.creation_type == CreationType.FRESH
        assert record.score_modifier == 0

    @pytest.mark.asyncio
    async def test_create_provenance_sends_correct_payload(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(
            url=f"{BASE_URL}/api/phase6/provenance",
            json={
                "record": {
                    "id": "prov-x",
                    "agentId": "child",
                    "creationType": "CLONED",
                    "parentAgentId": "parent",
                    "scoreModifier": -50,
                    "createdAt": "2025-01-01T00:00:00Z",
                }
            },
        )
        req = ProvenanceCreateRequest.model_validate(
            {
                "agentId": "child",
                "creationType": "CLONED",
                "parentAgentId": "parent",
                "metadata": {"reason": "horizontal scaling"},
            }
        )
        async with CARClient(BASE_URL) as client:
            await client.create_provenance(req)

        request = httpx_mock.get_request()
        import json

        body = json.loads(request.content)
        assert body["agentId"] == "child"
        assert body["creationType"] == "CLONED"
        assert body["parentAgentId"] == "parent"
        assert body["metadata"] == {"reason": "horizontal scaling"}

    @pytest.mark.asyncio
    async def test_get_provenance(
        self, httpx_mock: HTTPXMock, provenance_list_response_payload: dict
    ):
        httpx_mock.add_response(
            url=httpx.URL(BASE_URL + "/api/phase6/provenance", params={"agentId": "agent-alpha"}),
            json=provenance_list_response_payload,
        )
        async with CARClient(BASE_URL) as client:
            records = await client.get_provenance("agent-alpha")

        assert len(records) == 2
        assert all(isinstance(r, ProvenanceRecord) for r in records)
        assert records[0].id == "prov-001"
        assert records[1].creation_type == CreationType.EVOLVED
        assert records[1].parent_agent_id == "agent-beta"

    @pytest.mark.asyncio
    async def test_get_provenance_empty(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(
            url=httpx.URL(BASE_URL + "/api/phase6/provenance", params={"agentId": "ghost"}),
            json={"records": []},
        )
        async with CARClient(BASE_URL) as client:
            records = await client.get_provenance("ghost")

        assert records == []


# =============================================================================
# CARClient.get_alerts / update_alert_status
# =============================================================================


class TestAlerts:
    @pytest.mark.asyncio
    async def test_get_alerts_default_params(
        self, httpx_mock: HTTPXMock, alerts_list_response_payload: dict
    ):
        httpx_mock.add_response(
            json=alerts_list_response_payload,
        )
        async with CARClient(BASE_URL) as client:
            alerts = await client.get_alerts()

        assert len(alerts) == 1
        assert isinstance(alerts[0], GamingAlert)
        assert alerts[0].id == "alert-001"

        request = httpx_mock.get_request()
        assert request.method == "GET"
        assert "limit=50" in str(request.url)

    @pytest.mark.asyncio
    async def test_get_alerts_with_filters(
        self, httpx_mock: HTTPXMock, alerts_list_response_payload: dict
    ):
        httpx_mock.add_response(
            json=alerts_list_response_payload,
        )
        async with CARClient(BASE_URL) as client:
            await client.get_alerts(
                status=AlertStatus.ACTIVE,
                agent_id="agent-suspect",
                limit=10,
            )

        request = httpx_mock.get_request()
        url_str = str(request.url)
        assert "status=ACTIVE" in url_str
        assert "agentId=agent-suspect" in url_str
        assert "limit=10" in url_str

    @pytest.mark.asyncio
    async def test_get_alerts_empty(self, httpx_mock: HTTPXMock):
        httpx_mock.add_response(json={"alerts": []})
        async with CARClient(BASE_URL) as client:
            alerts = await client.get_alerts()
        assert alerts == []

    @pytest.mark.asyncio
    async def test_update_alert_status(
        self, httpx_mock: HTTPXMock, alert_update_response_payload: dict
    ):
        httpx_mock.add_response(
            url=f"{BASE_URL}/api/phase6/alerts/alert-001",
            json=alert_update_response_payload,
        )
        async with CARClient(BASE_URL, api_key=API_KEY) as client:
            alert = await client.update_alert_status(
                alert_id="alert-001",
                status=AlertStatus.RESOLVED,
                resolved_by="admin@vorion.dev",
                resolution_notes="False alarm - legitimate score increase",
            )

        assert isinstance(alert, GamingAlert)
        assert alert.status == AlertStatus.RESOLVED
        assert alert.resolved_by == "admin@vorion.dev"

        request = httpx_mock.get_request()
        assert request.method == "PATCH"
        import json

        body = json.loads(request.content)
        assert body["status"] == "RESOLVED"
        assert body["resolvedBy"] == "admin@vorion.dev"
        assert body["resolutionNotes"] == "False alarm - legitimate score increase"

    @pytest.mark.asyncio
    async def test_update_alert_minimal(
        self, httpx_mock: HTTPXMock, alert_update_response_payload: dict
    ):
        httpx_mock.add_response(
            url=f"{BASE_URL}/api/phase6/alerts/alert-001",
            json=alert_update_response_payload,
        )
        async with CARClient(BASE_URL) as client:
            await client.update_alert_status(
                alert_id="alert-001",
                status=AlertStatus.RESOLVED,
            )

        request = httpx_mock.get_request()
        import json

        body = json.loads(request.content)
        assert body == {"status": "RESOLVED"}
        assert "resolvedBy" not in body
        assert "resolutionNotes" not in body
