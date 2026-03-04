# Vorion Platform — Technical Specification Export
## Generated: February 23, 2026

---

## 1. Trust Factor Type System

### Canonical Factor Definitions (from @vorionsys/basis)

```typescript
enum TrustTier {
  T0_SANDBOX = 0,      // New agents start here
  T1_OBSERVED = 1,     // Basic competence demonstrated
  T2_PROVISIONAL = 2,  // Accountability + safety emerging
  T3_MONITORED = 3,    // Security + identity confirmed
  T4_STANDARD = 4,     // Human oversight + alignment
  T5_TRUSTED = 5,      // Stewardship + humility
  T6_CERTIFIED = 6,    // Adaptability + causal reasoning
  T7_AUTONOMOUS = 7,   // Full autonomy — all 16 factors critical
}

enum FactorTier {
  FOUNDATIONAL = 1,    // Weight 1x — Required for ALL levels
  OPERATIONAL = 2,     // Weight 2x — Required for L3+
  SOPHISTICATED = 3,   // Weight 3x — Required for L4+
  LIFE_CRITICAL = 4,   // Weight 4x — Required for life-saving applications
}
```

### The 16 Core Factors

```typescript
const CORE_FACTORS = {
  // === Group 1: Foundation Trust (6 factors) ===
  CT_COMP:  { code: 'CT-COMP',  name: 'Competence',        tier: FOUNDATIONAL, requiredFrom: T1 },
  CT_REL:   { code: 'CT-REL',   name: 'Reliability',       tier: FOUNDATIONAL, requiredFrom: T1 },
  CT_OBS:   { code: 'CT-OBS',   name: 'Observability',     tier: FOUNDATIONAL, requiredFrom: T1 },
  CT_TRANS: { code: 'CT-TRANS', name: 'Transparency',      tier: FOUNDATIONAL, requiredFrom: T2 },
  CT_ACCT:  { code: 'CT-ACCT',  name: 'Accountability',    tier: FOUNDATIONAL, requiredFrom: T2 },
  CT_SAFE:  { code: 'CT-SAFE',  name: 'Safety',            tier: FOUNDATIONAL, requiredFrom: T2 },

  // === Group 2: Security Trust (3 factors) ===
  CT_SEC:   { code: 'CT-SEC',   name: 'Security Posture',  tier: FOUNDATIONAL, requiredFrom: T3 },
  CT_PRIV:  { code: 'CT-PRIV',  name: 'Privacy',           tier: FOUNDATIONAL, requiredFrom: T3 },
  CT_ID:    { code: 'CT-ID',    name: 'Identity Integrity', tier: FOUNDATIONAL, requiredFrom: T3 },

  // === Group 3: Agency Trust (3 factors) ===
  OP_HUMAN:   { code: 'OP-HUMAN',   name: 'Human Oversight',    tier: OPERATIONAL, requiredFrom: T4 },
  OP_ALIGN:   { code: 'OP-ALIGN',   name: 'Goal Alignment',     tier: OPERATIONAL, requiredFrom: T4 },
  OP_CONTEXT: { code: 'OP-CONTEXT', name: 'Context Awareness',  tier: OPERATIONAL, requiredFrom: T4 },

  // === Group 4: Maturity Trust (2 factors) ===
  OP_STEW: { code: 'OP-STEW', name: 'Stewardship', tier: SOPHISTICATED, requiredFrom: T5 },
  SF_HUM:  { code: 'SF-HUM',  name: 'Humility',     tier: SOPHISTICATED, requiredFrom: T5 },

  // === Group 5: Evolution Trust (2 factors) ===
  SF_ADAPT: { code: 'SF-ADAPT', name: 'Adaptability',      tier: SOPHISTICATED, requiredFrom: T6 },
  SF_LEARN: { code: 'SF-LEARN', name: 'Learning Capacity', tier: SOPHISTICATED, requiredFrom: T6 },
};
```

### Shared Runtime Constants

```typescript
// Canonical factor code list (single source of truth)
const FACTOR_CODE_LIST = [
  'CT-COMP', 'CT-REL', 'CT-OBS', 'CT-TRANS', 'CT-ACCT', 'CT-SAFE',
  'CT-SEC', 'CT-PRIV', 'CT-ID',
  'OP-HUMAN', 'OP-ALIGN', 'OP-CONTEXT',
  'OP-STEW', 'SF-HUM',
  'SF-ADAPT', 'SF-LEARN',
] as const;

type FactorCodeString = typeof FACTOR_CODE_LIST[number];

// Equal default weights (1/16 each = 0.0625)
const DEFAULT_FACTOR_WEIGHTS: Record<FactorCodeString, number> = {
  'CT-COMP': 0.0625, 'CT-REL': 0.0625, 'CT-OBS': 0.0625,
  'CT-TRANS': 0.0625, 'CT-ACCT': 0.0625, 'CT-SAFE': 0.0625,
  'CT-SEC': 0.0625, 'CT-PRIV': 0.0625, 'CT-ID': 0.0625,
  'OP-HUMAN': 0.0625, 'OP-ALIGN': 0.0625, 'OP-CONTEXT': 0.0625,
  'OP-STEW': 0.0625, 'SF-HUM': 0.0625,
  'SF-ADAPT': 0.0625, 'SF-LEARN': 0.0625,
};

// Backwards-compat: legacy 4-bucket signal prefix → factor codes
const SIGNAL_PREFIX_TO_FACTORS: Record<string, FactorCodeString[]> = {
  'behavioral': ['CT-COMP', 'CT-REL'],
  'compliance': ['CT-ACCT', 'CT-SAFE', 'CT-SEC'],
  'identity':   ['CT-ID', 'CT-PRIV'],
  'context':    ['OP-CONTEXT'],
};

// Initialize factor scores at baseline (0.5)
function initialFactorScores(): Record<FactorCodeString, number> {
  const scores = {} as Record<FactorCodeString, number>;
  for (const code of FACTOR_CODE_LIST) scores[code] = 0.5;
  return scores;
}
```

---

## 2. Trust Score Calculation

### Composite Score Algorithm

The `calculateTrustScore()` function (in `packages/basis/src/trust-factors.ts`) computes a 0–1000 composite score:

1. For each of the 16 factors, multiply factor score (0.0–1.0) by its weight
2. Sum weighted scores → normalized score (0.0–1.0)
3. Multiply by 1000 → composite score (0–1000)
4. Map composite score to trust tier (T0–T7)

### Tier Score Ranges

| Tier | Min Score | Max Score |
|------|-----------|-----------|
| T0 Sandbox | 0 | 199 |
| T1 Observed | 200 | 349 |
| T2 Provisional | 350 | 499 |
| T3 Monitored | 500 | 649 |
| T4 Standard | 650 | 799 |
| T5 Trusted | 800 | 875 |
| T6 Certified | 876 | 950 |
| T7 Autonomous | 951 | 1000 |

### Trust Decay Mechanics

```
decayRate = 0.5^(elapsed / 182 days)
currentScore = baseScore * decayRate
```

- Half-life: 182 days (6 months)
- Stepped decay: scores drop in discrete thresholds, not continuously
- Decay is per-factor, not just composite

### Recovery Mechanics (REQ-TRS-006 through REQ-TRS-010)

- Base recovery: 2% per positive signal
- Recovery threshold: 0.7 (factor must be below this to qualify)
- Maximum recovery per signal: 50 points
- Accelerated recovery: After 3 consecutive positive signals, multiplier increases to 1.5x
- Recovery milestones: At 25%, 50%, 75% recovery → milestone events logged
- Demotion hysteresis: 25-point buffer zone before tier demotion (prevents oscillation)

---

## 3. Evidence System

### Evidence Types and Weights

```typescript
type EvidenceType =
  | 'automated'      // 1.0x weight — standard system observations
  | 'hitl_approval'  // 5.0x weight — human-in-the-loop approval
  | 'hitl_rejection' // 5.0x weight — human rejection/correction
  | 'examination'    // 3.0x weight — formal examination result
  | 'audit'          // 3.0x weight — third-party audit finding
  | 'sandbox_test'   // 0.5x weight — shadow/testnet observation
  | 'peer_review';   // 2.0x weight — cross-agent endorsement

interface TrustEvidence {
  evidenceId: string;
  factorCode: string;        // e.g. 'CT-COMP', 'OP-ALIGN'
  impact: number;            // -1000 to +1000
  source: string;
  collectedAt: Date;
  expiresAt?: Date;
  evidenceType?: EvidenceType;
  metadata?: Record<string, unknown>;
}
```

### Cold-Start Solution
The evidence weighting system solves the "1000-event problem" — without HITL evidence, an agent needs ~1000 automated observations to graduate from T0. With HITL approvals at 5x weight, graduation can happen in ~200 observations (a much more practical timeline).

---

## 4. API v2 Specification

### Endpoint: GET /api/v2/trust/{entityId}

Returns full 16-factor trust profile for an agent.

**Response Structure:**
```json
{
  "entityId": "agent-123",
  "tier": "T4_STANDARD",
  "compositeScore": 712,
  "factorGroups": [
    {
      "group": "Foundation",
      "factors": [
        { "code": "CT-COMP", "name": "Competence", "score": 0.82, "evidenceCount": 147 },
        { "code": "CT-REL", "name": "Reliability", "score": 0.79, "evidenceCount": 134 }
      ],
      "groupScore": 0.74
    }
  ],
  "gatingFactors": [],
  "lastUpdated": "2026-02-23T10:30:00Z"
}
```

### Endpoint: GET /api/v2/trust/factors

Returns all 16 factor definitions with metadata.

### Endpoint: GET /api/v2/trust/gating

Returns gating analysis — which factors are preventing tier promotion:
```json
{
  "entityId": "agent-123",
  "currentTier": "T3_MONITORED",
  "targetTier": "T4_STANDARD",
  "gatingFactors": [
    {
      "code": "OP-HUMAN",
      "name": "Human Oversight",
      "currentScore": 0.42,
      "requiredScore": 0.60,
      "gap": 0.18,
      "recommendation": "Increase HITL approval rate for this agent"
    }
  ]
}
```

---

## 5. Proof Chain Architecture

### Anchoring
- Every trust-relevant event is hashed with SHA-256
- Hash includes: event data + previous hash (chain integrity)
- Deterministic anchoring: same input → same hash (reproducible)

### Batch Operations (Merkle Tree)
- High-throughput events are batched into binary Merkle trees
- Batch root hash anchored to the chain
- Inclusion proofs: verify a specific event exists in a batch without revealing other events
- Tree depth: log2(batch_size)

### Verification
- `anchorProof(event)` — Anchor a single event
- `anchorBatch(events[])` — Batch anchor with Merkle tree
- `getProofAnchor(eventId)` — Retrieve anchor for an event
- `verifyProofAnchored(eventId)` — Tamper detection + Merkle inclusion verification

---

## 6. Authentication & RBAC

### Password Verification (Argon2id)
- Hash algorithm: Argon2id (memory-hard, GPU-resistant)
- Account lockout: 10 failed attempts → 30-minute lockout
- Transparent rehash: old parameters automatically upgraded on successful login
- Audit trail: every login attempt recorded (IP, user-agent, result, timestamp)
- MFA-ready: `mfaRequired` flag in verification result

### RBAC Service
- Role hierarchy with max depth of 10 levels
- Inherited permissions through role chains
- Soft-delete for role removal (audit trail preserved)
- Operations: createRole, updateRole, deleteRole, assignRole, revokeRole, getUserRoles, getAssignedRoles, getInheritedRoles, getRolePermissions

---

## 7. Compliance Audit Logging

### Schema (Drizzle ORM)
```typescript
// compliance_audit_logs table
{
  id: uuid,
  eventType: text,        // 'trust_change', 'policy_violation', etc.
  entityId: text,
  entityType: text,       // 'agent', 'user', 'organization'
  details: jsonb,
  severity: text,         // 'info', 'warning', 'critical'
  containsPHI: boolean,   // HIPAA flag
  hashChain: text,        // Links to proof chain
  sensitivity: text,      // 'public', 'internal', 'confidential', 'restricted'
  frameworks: text[],     // ['SOC2', 'GDPR', 'ISO42001']
  createdAt: timestamp,
}
```

### Persistence
- Fire-and-forget Supabase writes via Drizzle
- Batch insert for high-throughput events
- Re-queue on failure (no data loss)
- Hash chain integrity linking audit events to proof chain

---

## 8. Package Dependency Graph

```
@vorionsys/basis (canonical source of truth)
  ├── @vorionsys/atsf-core (imports FACTOR_CODE_LIST, DEFAULT_FACTOR_WEIGHTS, etc.)
  ├── @vorionsys/platform-core (same imports)
  ├── @vorionsys/security (same imports)
  └── @vorionsys/council (uses for presets)

@vorionsys/contracts (TypeScript types)
  ├── @vorionsys/atsf-core
  ├── @vorionsys/platform-core
  └── @vorionsys/security

@vorionsys/shared-constants
  └── All packages (governance constants)

@vorionsys/cognigate
  ├── @vorionsys/atsf-core
  └── @vorionsys/basis
```

### Key Architecture Rule
**Single Source of Truth:** Trust factor definitions, weights, and scoring algorithms MUST only be defined in `@vorionsys/basis`. All other packages IMPORT from basis. Never duplicate factor constants.

---

## 9. Testing Architecture

### Test Categories
- **Unit tests**: Per-package, run with Vitest
- **Integration tests**: Cross-package, test real interactions
- **Property tests**: Trust enforcement properties (monotonicity, boundedness, etc.)
- **Adversarial tests**: Trust attack scenarios (manipulation, gaming, injection)
- **Phase 6 tests**: 175+ comprehensive scenarios (ceiling enforcement, audit trail, context policy, multi-tenant isolation, role gates, BASIS policy, canonical presets, delta tracking, creation modifiers, performance)

### Security Test Phases (8 phases, 55+ commits)
1. Phase 1: Cryptographic & authentication
2. Phase 2: SQL injection & trust scoring manipulation
3. Phase 3: Multi-tenant isolation & RBAC
4. Phase 4: Rate limiting, Tier 7 abuse, evidence spoofing
5. Phase 5: Trust score edge cases, Byzantine fault tolerance
6. Phase 6: Proof chain integrity, timing attacks, entropy
7. Phase 7: Compliance boundary, regulatory edge cases
8. Phase 8: Integration testing, cross-component security

---

## 10. Configuration

### Environment Variables
- `NODE_ENV` — Runtime environment
- `DATABASE_URL` — PostgreSQL connection string
- `XAI_API_KEY` — AI provider key
- `VERCEL_ENV` — Deployment environment

### Build System (Turborepo)
- `turbo run build` — Build all packages
- `turbo run test` — Run all tests
- `turbo run typecheck` — TypeScript type checking
- `turbo run lint` — ESLint across all packages

### Node.js Requirements
- Node.js 20+ (engine requirement)
- TypeScript 5.7+
- ESM modules (all packages use `"type": "module"`)
- All imports require `.js` extension (ESM compliance)
