"""
Tests for the PROOF endpoint — immutable audit ledger.

Tests cover:
- Proof record creation from enforcement verdicts
- Proof retrieval by ID
- Proof chain statistics
- Proof querying with filters
- Chain integrity verification
- Hash computation
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.core.policy_engine import policy_engine
from app.db.database import Base
from app.db.proof_repository import ProofRepository
from app.routers.proof import calculate_hash, create_proof_record


@pytest_asyncio.fixture
async def db_session():
    """In-memory SQLite database session for testing."""
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


# ============================================================================
# HASH COMPUTATION
# ============================================================================

class TestHashComputation:
    def test_calculate_hash_deterministic(self):
        """Same input should produce same hash."""
        data = {"key": "value", "number": 42}
        h1 = calculate_hash(data)
        h2 = calculate_hash(data)
        assert h1 == h2

    def test_calculate_hash_different_input(self):
        """Different input should produce different hash."""
        h1 = calculate_hash({"key": "value1"})
        h2 = calculate_hash({"key": "value2"})
        assert h1 != h2

    def test_calculate_hash_key_order_independent(self):
        """Dict key order should not affect hash (sort_keys=True)."""
        h1 = calculate_hash({"a": 1, "b": 2})
        h2 = calculate_hash({"b": 2, "a": 1})
        assert h1 == h2

    def test_calculate_hash_is_sha256(self):
        """Hash should be 64-char hex string (SHA-256)."""
        h = calculate_hash({"test": True})
        assert len(h) == 64
        assert all(c in "0123456789abcdef" for c in h)


# ============================================================================
# PROOF RECORD CREATION
# ============================================================================

class TestProofRecordCreation:
    @pytest.mark.asyncio
    async def test_create_first_proof(self, db_session: AsyncSession):
        """First proof should have chain_position=0 and genesis previous_hash."""
        record = await create_proof_record(
            session=db_session,
            intent_id="int_test001",
            verdict_id="vrd_test001",
            entity_id="agent_001",
            action_type="enforcement",
            decision="allowed",
            inputs={"plan_id": "plan_001", "policies": ["basis-core-security"]},
            outputs={"allowed": True, "violations": 0, "trust_impact": 0},
        )
        assert record.proof_id.startswith("prf_") or len(record.proof_id) > 0
        assert record.chain_position == 0
        assert record.intent_id == "int_test001"
        assert record.verdict_id == "vrd_test001"
        assert record.decision == "allowed"
        assert len(record.hash) == 64  # SHA-256
        assert record.inputs_hash is not None
        assert record.outputs_hash is not None

    @pytest.mark.asyncio
    async def test_chain_linkage(self, db_session: AsyncSession):
        """Second proof should link to first via previous_hash."""
        r1 = await create_proof_record(
            session=db_session,
            intent_id="int_001", verdict_id="vrd_001", entity_id="agent_001",
            action_type="enforcement", decision="allowed",
            inputs={"plan_id": "p1"}, outputs={"allowed": True},
        )
        r2 = await create_proof_record(
            session=db_session,
            intent_id="int_002", verdict_id="vrd_002", entity_id="agent_001",
            action_type="enforcement", decision="denied",
            inputs={"plan_id": "p2"}, outputs={"allowed": False},
        )
        assert r2.chain_position == 1
        assert r2.previous_hash == r1.hash

    @pytest.mark.asyncio
    async def test_proof_creates_unique_ids(self, db_session: AsyncSession):
        """Each proof should have a unique proof_id."""
        r1 = await create_proof_record(
            session=db_session,
            intent_id="int_a", verdict_id="vrd_a", entity_id="agent_001",
            action_type="enforcement", decision="allowed",
            inputs={}, outputs={},
        )
        r2 = await create_proof_record(
            session=db_session,
            intent_id="int_b", verdict_id="vrd_b", entity_id="agent_001",
            action_type="enforcement", decision="denied",
            inputs={}, outputs={},
        )
        assert r1.proof_id != r2.proof_id


# ============================================================================
# PROOF REPOSITORY
# ============================================================================

class TestProofRepository:
    @pytest.mark.asyncio
    async def test_get_stats_empty(self, db_session: AsyncSession):
        """Stats on empty chain should be zeros."""
        repo = ProofRepository(db_session)
        stats = await repo.get_stats()
        assert stats["total_records"] == 0
        assert stats["chain_length"] == 0

    @pytest.mark.asyncio
    async def test_get_stats_after_records(self, db_session: AsyncSession):
        """Stats should reflect actual records."""
        await create_proof_record(
            session=db_session,
            intent_id="int_001", verdict_id="vrd_001", entity_id="agent_001",
            action_type="enforcement", decision="allowed",
            inputs={}, outputs={},
        )
        await create_proof_record(
            session=db_session,
            intent_id="int_002", verdict_id="vrd_002", entity_id="agent_002",
            action_type="enforcement", decision="denied",
            inputs={}, outputs={},
        )
        repo = ProofRepository(db_session)
        stats = await repo.get_stats()
        assert stats["total_records"] == 2
        assert stats["chain_length"] == 2

    @pytest.mark.asyncio
    async def test_chain_integrity_valid(self, db_session: AsyncSession):
        """Valid chain should pass integrity check."""
        await create_proof_record(
            session=db_session,
            intent_id="int_001", verdict_id="vrd_001", entity_id="agent_001",
            action_type="enforcement", decision="allowed",
            inputs={}, outputs={},
        )
        await create_proof_record(
            session=db_session,
            intent_id="int_002", verdict_id="vrd_002", entity_id="agent_001",
            action_type="enforcement", decision="denied",
            inputs={}, outputs={},
        )
        repo = ProofRepository(db_session)
        valid, issues = await repo.verify_chain_integrity()
        assert valid is True
        assert len(issues) == 0

    @pytest.mark.asyncio
    async def test_get_by_id(self, db_session: AsyncSession):
        """Should retrieve a proof record by its ID."""
        record = await create_proof_record(
            session=db_session,
            intent_id="int_find", verdict_id="vrd_find", entity_id="agent_001",
            action_type="enforcement", decision="allowed",
            inputs={}, outputs={},
        )
        repo = ProofRepository(db_session)
        found = await repo.get_by_id(record.proof_id)
        assert found is not None
        assert found.proof_id == record.proof_id

    @pytest.mark.asyncio
    async def test_get_by_id_not_found(self, db_session: AsyncSession):
        """Non-existent ID should return None."""
        repo = ProofRepository(db_session)
        found = await repo.get_by_id("prf_nonexistent")
        assert found is None
