"""
Pytest fixtures for Cognigate tests.
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.core.policy_engine import policy_engine
from app.core.circuit_breaker import circuit_breaker
from app.db.database import Base


@pytest.fixture(autouse=True)
def reset_global_circuit_breaker():
    """Reset the global circuit breaker before each test to prevent state leakage."""
    circuit_breaker.manual_reset()
    circuit_breaker._halted_entities.clear()
    circuit_breaker._entity_violations.clear()
    circuit_breaker._trip_history.clear()
    yield


@pytest_asyncio.fixture
async def async_client():
    """Create an async HTTP client for testing endpoints."""
    # Import app here to avoid side-effects at module level during collection
    from app.main import app

    # Initialize policy engine for tests
    if not policy_engine.list_policies():
        policy_engine.load_default_policies()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest_asyncio.fixture
async def test_db():
    """Create a test database with in-memory SQLite."""
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        echo=False,
    )

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )

    async with session_factory() as session:
        yield session

    await engine.dispose()


@pytest.fixture
def sample_plan():
    """Create a sample structured plan for testing.

    Must match the StructuredPlan Pydantic model (app.models.intent).
    Required fields: goal, risk_score, reasoning_trace.
    """
    return {
        "plan_id": "plan_test123",
        "goal": "Read a file from the temporary directory",
        "tools_required": ["file_read"],
        "data_classifications": [],
        "risk_score": 0.2,
        "reasoning_trace": "Simple file read operation with no sensitive data access",
    }


@pytest.fixture
def high_risk_plan():
    """Create a high-risk plan for testing.

    Must match the StructuredPlan Pydantic model (app.models.intent).
    Required fields: goal, risk_score, reasoning_trace.
    """
    return {
        "plan_id": "plan_highrisk",
        "goal": "Execute shell command to delete temporary files",
        "tools_required": ["shell", "file_delete"],
        "data_classifications": ["pii_email"],
        "risk_score": 0.9,
        "reasoning_trace": "High-risk shell execution with file deletion and PII data access",
    }
