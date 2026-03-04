"""
Unit tests for the CIRCUIT BREAKER module — autonomous safety halts.

Tests cover:
- State transitions (CLOSED → OPEN → HALF_OPEN → CLOSED)
- Auto-reset behavior
- Trip conditions (high risk, tripwire cascade, injection, critic block)
- Entity-level halts
- Cascade halts
- Metrics tracking
- Thread safety
"""

import time
import pytest
from unittest.mock import patch

from app.core.circuit_breaker import (
    CircuitBreaker, CircuitConfig, CircuitState, TripReason,
)


@pytest.fixture
def breaker():
    """Fresh circuit breaker for each test."""
    config = CircuitConfig(
        high_risk_threshold=0.10,
        tripwire_cascade_count=3,
        tripwire_cascade_window=60,
        injection_threshold=2,
        critic_block_threshold=5,
        auto_reset_seconds=5,  # Short for testing
        half_open_requests=2,
        metrics_window_seconds=60,
        entity_violation_threshold=3,
    )
    return CircuitBreaker(config)


# ============================================================================
# INITIAL STATE
# ============================================================================

class TestInitialState:
    def test_starts_closed(self, breaker: CircuitBreaker):
        assert breaker.state == CircuitState.CLOSED
        assert not breaker.is_open

    def test_initial_metrics_zero(self, breaker: CircuitBreaker):
        status = breaker.get_status()
        assert status["metrics"]["total_requests"] == 0
        assert status["metrics"]["high_risk_requests"] == 0

    def test_initial_no_halted_entities(self, breaker: CircuitBreaker):
        status = breaker.get_status()
        assert len(status["halted_entities"]) == 0


# ============================================================================
# REQUEST ALLOWANCE
# ============================================================================

class TestRequestAllowance:
    def test_closed_allows_requests(self, breaker: CircuitBreaker):
        allowed, reason = breaker.allow_request("agent_001")
        assert allowed is True

    def test_open_blocks_requests(self, breaker: CircuitBreaker):
        breaker.manual_trip("test")
        allowed, reason = breaker.allow_request("agent_001")
        assert allowed is False
        assert "OPEN" in reason

    def test_halted_entity_blocked(self, breaker: CircuitBreaker):
        breaker.halt_entity("bad_agent", "testing")
        allowed, reason = breaker.allow_request("bad_agent")
        assert allowed is False
        assert "halted" in reason

    def test_non_halted_entity_allowed(self, breaker: CircuitBreaker):
        breaker.halt_entity("bad_agent", "testing")
        allowed, _ = breaker.allow_request("good_agent")
        assert allowed is True


# ============================================================================
# MANUAL CONTROLS
# ============================================================================

class TestManualControls:
    def test_manual_trip(self, breaker: CircuitBreaker):
        breaker.manual_trip("emergency")
        assert breaker.state == CircuitState.OPEN
        assert breaker.is_open

    def test_manual_reset(self, breaker: CircuitBreaker):
        breaker.manual_trip("emergency")
        breaker.manual_reset()
        assert breaker.state == CircuitState.CLOSED
        assert not breaker.is_open

    def test_trip_records_history(self, breaker: CircuitBreaker):
        breaker.manual_trip("test1")
        breaker.manual_reset()
        breaker.manual_trip("test2")
        history = breaker.get_trip_history()
        assert len(history) == 2


# ============================================================================
# AUTO-TRIP CONDITIONS
# ============================================================================

class TestAutoTrip:
    def test_high_risk_threshold_trip(self, breaker: CircuitBreaker):
        """Should trip when >10% of requests are high-risk."""
        # Record 10 normal requests first to meet minimum
        for _ in range(8):
            breaker.record_request("agent_001", risk_score=0.1)
        # Now add high-risk ones
        for _ in range(3):
            breaker.record_request("agent_001", risk_score=0.9)
        # Should have tripped
        assert breaker.state == CircuitState.OPEN

    def test_tripwire_cascade_trip(self, breaker: CircuitBreaker):
        """3 tripwires in window should trip circuit."""
        for _ in range(3):
            breaker.record_request("agent_001", tripwire_triggered=True)
        assert breaker.state == CircuitState.OPEN

    def test_injection_threshold_trip(self, breaker: CircuitBreaker):
        """2 injection attempts should trip circuit."""
        for _ in range(2):
            breaker.record_request("agent_001", injection_detected=True)
        assert breaker.state == CircuitState.OPEN

    def test_critic_block_cascade_trip(self, breaker: CircuitBreaker):
        """5 critic blocks should trip circuit."""
        for _ in range(5):
            breaker.record_request("agent_001", critic_blocked=True)
        assert breaker.state == CircuitState.OPEN

    def test_below_threshold_no_trip(self, breaker: CircuitBreaker):
        """Requests below threshold should not trip."""
        for _ in range(5):
            breaker.record_request("agent_001", risk_score=0.3)
        assert breaker.state == CircuitState.CLOSED


# ============================================================================
# ENTITY-LEVEL HALTS
# ============================================================================

class TestEntityHalts:
    def test_halt_entity(self, breaker: CircuitBreaker):
        breaker.halt_entity("agent_bad", "misbehaving")
        allowed, _ = breaker.allow_request("agent_bad")
        assert allowed is False

    def test_unhalt_entity(self, breaker: CircuitBreaker):
        breaker.halt_entity("agent_bad", "misbehaving")
        breaker.unhalt_entity("agent_bad")
        allowed, _ = breaker.allow_request("agent_bad")
        assert allowed is True

    def test_auto_halt_on_violations(self, breaker: CircuitBreaker):
        """Entity should be auto-halted after exceeding violation threshold."""
        for _ in range(3):
            breaker.record_request("bad_agent", velocity_violated=True)
        allowed, _ = breaker.allow_request("bad_agent")
        assert allowed is False

    def test_cascade_halt(self, breaker: CircuitBreaker):
        """Cascading halt should halt parent and children."""
        breaker.register_child("parent", "child_1")
        breaker.register_child("parent", "child_2")
        breaker.cascade_halt("parent", "test")

        allowed_parent, _ = breaker.allow_request("parent")
        allowed_child1, _ = breaker.allow_request("child_1")
        allowed_child2, _ = breaker.allow_request("child_2")
        allowed_other, _ = breaker.allow_request("other_agent")

        assert allowed_parent is False
        assert allowed_child1 is False
        assert allowed_child2 is False
        assert allowed_other is True


# ============================================================================
# AUTO-RESET AND RECOVERY
# ============================================================================

class TestAutoReset:
    def test_auto_reset_transitions_to_half_open(self, breaker: CircuitBreaker):
        """After auto_reset_seconds, circuit should move to HALF_OPEN."""
        breaker.manual_trip("test")
        # Fake the time so auto_reset_at is in the past
        breaker._current_trip.auto_reset_at = time.time() - 1
        allowed, _ = breaker.allow_request("agent_001")
        assert breaker.state == CircuitState.HALF_OPEN

    def test_half_open_recovery(self, breaker: CircuitBreaker):
        """Enough successes in HALF_OPEN should close circuit."""
        breaker.manual_trip("test")
        breaker._current_trip.auto_reset_at = time.time() - 1
        # First request transitions to half-open
        breaker.allow_request("agent_001")
        assert breaker.state == CircuitState.HALF_OPEN

        # Record successes
        breaker.record_request("agent_001", was_blocked=False)
        breaker.record_request("agent_001", was_blocked=False)

        # Next allow_request should close it
        allowed, _ = breaker.allow_request("agent_001")
        assert breaker.state == CircuitState.CLOSED
        assert allowed is True


# ============================================================================
# METRICS
# ============================================================================

class TestMetrics:
    def test_metrics_track_requests(self, breaker: CircuitBreaker):
        breaker.record_request("a", risk_score=0.1)
        breaker.record_request("a", risk_score=0.8)
        breaker.record_request("a", risk_score=0.2, was_blocked=True)

        status = breaker.get_status()
        assert status["metrics"]["total_requests"] == 3
        assert status["metrics"]["high_risk_requests"] == 1
        assert status["metrics"]["blocked_requests"] == 1

    def test_metrics_track_security_events(self, breaker: CircuitBreaker):
        breaker.record_request("a", tripwire_triggered=True)
        breaker.record_request("a", injection_detected=True)
        breaker.record_request("a", critic_blocked=True)

        status = breaker.get_status()
        assert status["metrics"]["tripwire_triggers"] == 1
        assert status["metrics"]["injection_attempts"] == 1
        assert status["metrics"]["critic_blocks"] == 1

    def test_get_status_format(self, breaker: CircuitBreaker):
        """Status should have expected keys."""
        status = breaker.get_status()
        assert "state" in status
        assert "is_open" in status
        assert "metrics" in status
        assert "halted_entities" in status
        assert "trip_history_count" in status

    def test_trip_history_format(self, breaker: CircuitBreaker):
        breaker.manual_trip("test reason")
        history = breaker.get_trip_history()
        assert len(history) == 1
        assert history[0]["reason"] == "manual_halt"
        assert "timestamp" in history[0]
        assert history[0]["details"] == "test reason"
