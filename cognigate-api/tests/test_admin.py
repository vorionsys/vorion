"""
Tests for ADMIN endpoints — system monitoring and control.

Tests cover:
- Circuit breaker status, halt, reset
- Entity halt/unhalt/cascade
- Velocity stats and throttling
- System status
- Authentication (X-Admin-Key)
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from app.core.policy_engine import policy_engine
from app.core.circuit_breaker import circuit_breaker, CircuitState
from app.core.velocity import velocity_tracker
from app.config import get_settings


@pytest_asyncio.fixture
async def client():
    """Async HTTP client for testing."""
    from app.main import app
    if not policy_engine.list_policies():
        policy_engine.load_default_policies()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
def admin_key():
    """Get the admin API key."""
    return get_settings().admin_api_key


# ============================================================================
# AUTHENTICATION
# ============================================================================

class TestAdminAuth:
    @pytest.mark.asyncio
    async def test_no_key_returns_401(self, client: AsyncClient):
        """Missing X-Admin-Key should return 401."""
        resp = await client.get("/v1/admin/circuit")
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_wrong_key_returns_403(self, client: AsyncClient):
        """Invalid X-Admin-Key should return 403."""
        resp = await client.get(
            "/v1/admin/circuit",
            headers={"X-Admin-Key": "wrong_key_1234"},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_valid_key_returns_200(self, client: AsyncClient, admin_key: str):
        """Valid X-Admin-Key should grant access."""
        resp = await client.get(
            "/v1/admin/circuit",
            headers={"X-Admin-Key": admin_key},
        )
        assert resp.status_code == 200


# ============================================================================
# CIRCUIT BREAKER
# ============================================================================

class TestCircuitBreaker:
    @pytest.mark.asyncio
    async def test_get_status(self, client: AsyncClient, admin_key: str):
        """Should return circuit breaker status."""
        resp = await client.get(
            "/v1/admin/circuit",
            headers={"X-Admin-Key": admin_key},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["state"] == "closed"
        assert data["is_open"] is False

    @pytest.mark.asyncio
    async def test_manual_halt(self, client: AsyncClient, admin_key: str):
        """Manual halt should trip the circuit breaker."""
        resp = await client.post(
            "/v1/admin/circuit/halt",
            json={"reason": "test halt"},
            headers={"X-Admin-Key": admin_key},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "halted"

        # Verify it's actually open
        status = await client.get(
            "/v1/admin/circuit",
            headers={"X-Admin-Key": admin_key},
        )
        assert status.json()["state"] == "open"

    @pytest.mark.asyncio
    async def test_manual_reset(self, client: AsyncClient, admin_key: str):
        """Manual reset should close the circuit breaker."""
        # First halt
        await client.post(
            "/v1/admin/circuit/halt",
            json={"reason": "test"},
            headers={"X-Admin-Key": admin_key},
        )
        # Then reset
        resp = await client.post(
            "/v1/admin/circuit/reset",
            headers={"X-Admin-Key": admin_key},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "reset"

        # Verify it's closed
        status = await client.get(
            "/v1/admin/circuit",
            headers={"X-Admin-Key": admin_key},
        )
        assert status.json()["state"] == "closed"

    @pytest.mark.asyncio
    async def test_circuit_history(self, client: AsyncClient, admin_key: str):
        """Trip history should be recorded."""
        # Trip it
        await client.post(
            "/v1/admin/circuit/halt",
            json={"reason": "history test"},
            headers={"X-Admin-Key": admin_key},
        )
        resp = await client.get(
            "/v1/admin/circuit/history",
            headers={"X-Admin-Key": admin_key},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["trips"]) >= 1
        assert data["trips"][-1]["reason"] == "manual_halt"


# ============================================================================
# ENTITY CONTROL
# ============================================================================

class TestEntityControl:
    @pytest.mark.asyncio
    async def test_halt_entity(self, client: AsyncClient, admin_key: str):
        """Should halt a specific entity."""
        resp = await client.post(
            "/v1/admin/entity/halt",
            json={"entity_id": "bad_agent", "reason": "misbehaving"},
            headers={"X-Admin-Key": admin_key},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "halted"

    @pytest.mark.asyncio
    async def test_unhalt_entity(self, client: AsyncClient, admin_key: str):
        """Should unhalt a previously halted entity."""
        # Halt first
        await client.post(
            "/v1/admin/entity/halt",
            json={"entity_id": "agent_x"},
            headers={"X-Admin-Key": admin_key},
        )
        # Unhalt
        resp = await client.post(
            "/v1/admin/entity/unhalt",
            json={"entity_id": "agent_x"},
            headers={"X-Admin-Key": admin_key},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "unhalted"

    @pytest.mark.asyncio
    async def test_cascade_halt(self, client: AsyncClient, admin_key: str):
        """Should cascade halt a parent and its children."""
        resp = await client.post(
            "/v1/admin/entity/cascade-halt",
            json={"parent_id": "parent_agent", "reason": "parent misbehaving"},
            headers={"X-Admin-Key": admin_key},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "cascade_halted"


# ============================================================================
# VELOCITY
# ============================================================================

class TestVelocityAdmin:
    @pytest.mark.asyncio
    async def test_get_all_velocity(self, client: AsyncClient, admin_key: str):
        """Should return velocity stats for all entities."""
        resp = await client.get(
            "/v1/admin/velocity",
            headers={"X-Admin-Key": admin_key},
        )
        assert resp.status_code == 200
        assert "entities" in resp.json()

    @pytest.mark.asyncio
    async def test_throttle_entity(self, client: AsyncClient, admin_key: str):
        """Should throttle an entity."""
        resp = await client.post(
            "/v1/admin/velocity/throttle",
            json={"entity_id": "spam_agent", "duration_seconds": 60},
            headers={"X-Admin-Key": admin_key},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "throttled"

    @pytest.mark.asyncio
    async def test_unthrottle_entity(self, client: AsyncClient, admin_key: str):
        """Should remove throttle from an entity."""
        resp = await client.post(
            "/v1/admin/velocity/unthrottle",
            json={"entity_id": "spam_agent"},
            headers={"X-Admin-Key": admin_key},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "unthrottled"


# ============================================================================
# SYSTEM STATUS
# ============================================================================

class TestSystemStatus:
    @pytest.mark.asyncio
    async def test_system_status_healthy(self, client: AsyncClient, admin_key: str):
        """Normal state should report healthy."""
        resp = await client.get(
            "/v1/admin/status",
            headers={"X-Admin-Key": admin_key},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["health"] == "healthy"
        assert "security_layers" in data

    @pytest.mark.asyncio
    async def test_system_status_critical_when_halted(self, client: AsyncClient, admin_key: str):
        """Halted circuit should report critical."""
        await client.post(
            "/v1/admin/circuit/halt",
            json={"reason": "status test"},
            headers={"X-Admin-Key": admin_key},
        )
        resp = await client.get(
            "/v1/admin/status",
            headers={"X-Admin-Key": admin_key},
        )
        data = resp.json()
        assert data["health"] == "critical"
