# Vorion: New Hire Task Breakdown
## Complete Implementation Roadmap

**Created:** January 31, 2026
**Target:** 8-week sprint to production-ready

---

## Overview

```
Sprint 1 (Week 1-2): Security Foundation
Sprint 2 (Week 3-4): Pipeline Integration
Sprint 3 (Week 5-6): Developer SDK
Sprint 4 (Week 7-8): Production Hardening
```

---

# SPRINT 1: Security Foundation
## Week 1-2

### Epic S1: Authentication & Authorization

---

#### S1.1: JWT Authentication Middleware
**Priority:** P0 - Blocker
**Effort:** 3 days
**Location:** `packages/atsf-core/src/security/`

**Create Files:**
```
packages/atsf-core/src/security/
├── index.ts                 # Export all security modules
├── jwt-auth.ts              # JWT validation middleware
├── api-key-auth.ts          # API key validation
├── types.ts                 # Security types
└── constants.ts             # Security constants
```

**Task S1.1.1:** Create JWT validation middleware
```typescript
// packages/atsf-core/src/security/jwt-auth.ts

interface JWTPayload {
  sub: string;           // Subject (user/agent ID)
  aud: string;           // Audience
  iss: string;           // Issuer
  exp: number;           // Expiration
  iat: number;           // Issued at
  tenantId: string;      // Tenant isolation
  roles: string[];       // RBAC roles
  trustLevel?: number;   // Optional trust level claim
}

interface JWTConfig {
  secret: string;                    // For HS256
  publicKey?: string;                // For RS256
  issuer: string;
  audience: string;
  clockTolerance: number;            // Seconds
  maxAge: string;                    // e.g., '1h'
}

// Implement:
// 1. createJWTPlugin(config: JWTConfig) - Fastify plugin
// 2. verifyJWT(token: string) - Standalone verification
// 3. extractClaims(request: FastifyRequest) - Helper
```

**Acceptance Criteria:**
- [ ] Validates JWT signature (HS256 and RS256)
- [ ] Rejects expired tokens
- [ ] Rejects tokens with wrong issuer/audience
- [ ] Extracts tenantId for downstream use
- [ ] Returns 401 with clear error messages
- [ ] Unit tests with 90%+ coverage

**Test File:** `packages/atsf-core/test/security/jwt-auth.test.ts`

---

#### S1.1.2: API Key Authentication
**Priority:** P0
**Effort:** 2 days

```typescript
// packages/atsf-core/src/security/api-key-auth.ts

interface APIKeyConfig {
  headerName: string;        // Default: 'X-API-Key'
  queryParam?: string;       // Optional: 'api_key'
  hashAlgorithm: 'sha256' | 'argon2';
  storage: APIKeyStorage;
}

interface APIKeyStorage {
  validate(keyHash: string): Promise<APIKeyRecord | null>;
  revoke(keyId: string): Promise<void>;
  list(tenantId: string): Promise<APIKeyRecord[]>;
}

interface APIKeyRecord {
  keyId: string;
  keyHash: string;
  tenantId: string;
  name: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt?: Date;
}
```

**Acceptance Criteria:**
- [ ] Validates API key from header or query param
- [ ] Stores hashed keys only (never plaintext)
- [ ] Tracks last used timestamp
- [ ] Supports key expiration
- [ ] Returns 401 with rate-limit headers on failure

---

#### S1.1.3: Integrate Auth into API Server
**Priority:** P0
**Effort:** 1 day
**Modify:** `packages/atsf-core/src/api/server.ts`

```typescript
// Add to server.ts:

import { createJWTPlugin } from '../security/jwt-auth.js';
import { createAPIKeyPlugin } from '../security/api-key-auth.js';

// Register plugins
await server.register(createJWTPlugin({
  secret: config.jwtSecret,
  issuer: 'vorion.io',
  audience: 'api.vorion.io',
  clockTolerance: 30,
  maxAge: '1h',
}));

// Protect routes
server.addHook('onRequest', async (request, reply) => {
  // Skip health checks
  if (request.url === '/health' || request.url === '/ready') return;

  // Require auth
  await request.jwtVerify();
});
```

**Acceptance Criteria:**
- [ ] All routes except /health and /ready require auth
- [ ] Auth method detected automatically (JWT vs API key)
- [ ] Request decorated with `request.user` and `request.tenantId`

---

### Epic S2: Tenant Isolation

---

#### S2.1: Tenant Context Middleware
**Priority:** P0
**Effort:** 2 days
**Location:** `packages/atsf-core/src/security/tenant-context.ts`

```typescript
// Tenant context that flows through the request lifecycle

interface TenantContext {
  tenantId: string;
  userId: string;
  roles: string[];
  permissions: string[];
  trustLevel: number;
  metadata: Record<string, unknown>;
}

// Create AsyncLocalStorage for context propagation
const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) throw new Error('No tenant context - ensure middleware is applied');
  return ctx;
}

export function runWithTenant<T>(context: TenantContext, fn: () => T): T {
  return tenantStorage.run(context, fn);
}
```

**Acceptance Criteria:**
- [ ] Tenant context available via `getTenantContext()` anywhere in call stack
- [ ] Context automatically set from JWT claims
- [ ] All database queries filter by tenantId
- [ ] Cross-tenant access throws SecurityError

---

#### S2.2: Tenant-Scoped Repositories
**Priority:** P0
**Effort:** 2 days

**Modify Files:**
- `packages/atsf-core/src/trust-engine/index.ts`
- `packages/atsf-core/src/intent/index.ts`
- `packages/atsf-core/src/governance/index.ts`

```typescript
// Example: Modify TrustEngine to scope by tenant

class TrustEngine {
  private getTenantKey(entityId: ID): string {
    const { tenantId } = getTenantContext();
    return `${tenantId}:${entityId}`;
  }

  async getScore(entityId: ID): Promise<TrustRecord | undefined> {
    const key = this.getTenantKey(entityId);
    return this.records.get(key);
  }

  async initializeEntity(entityId: ID, level: TrustLevel): Promise<TrustRecord> {
    const { tenantId } = getTenantContext();
    // ... ensure tenant isolation
  }
}
```

**Acceptance Criteria:**
- [ ] All entity lookups scoped to current tenant
- [ ] Cannot access entities from other tenants
- [ ] Tenant ID stored with all records
- [ ] Existing tests updated for tenant context

---

### Epic S3: Rate Limiting

---

#### S3.1: Configure Rate Limiting
**Priority:** P1
**Effort:** 1 day
**Modify:** `packages/atsf-core/src/api/server.ts`

```typescript
import rateLimit from '@fastify/rate-limit';

await server.register(rateLimit, {
  global: true,
  max: 100,                    // requests per window
  timeWindow: '1 minute',

  // Per-tenant limits
  keyGenerator: (request) => {
    return request.tenantId ?? request.ip;
  },

  // Custom limits per endpoint
  onExceeded: (request, key) => {
    logger.warn({ tenantId: key, url: request.url }, 'Rate limit exceeded');
  },

  // Different limits for different tiers
  allowList: async (request, key) => {
    const tenant = await getTenantTier(key);
    return tenant === 'enterprise'; // No limits for enterprise
  },
});

// Endpoint-specific limits
server.get('/api/trust/:entityId', {
  config: {
    rateLimit: {
      max: 1000,
      timeWindow: '1 minute',
    },
  },
}, handler);
```

**Acceptance Criteria:**
- [ ] Global rate limit of 100 req/min per tenant
- [ ] Trust endpoints: 1000 req/min
- [ ] Intent submission: 50 req/min
- [ ] Rate limit headers in all responses
- [ ] 429 response with retry-after header

---

### Epic S4: Request Signing

---

#### S4.1: Ed25519 Request Signatures
**Priority:** P1
**Effort:** 2 days
**Location:** `packages/atsf-core/src/security/request-signing.ts`

```typescript
interface SignedRequest {
  timestamp: number;        // Unix ms
  nonce: string;            // Random, single-use
  body: string;             // JSON stringified
  signature: string;        // Base64 Ed25519 signature
}

interface SigningConfig {
  maxTimestampDrift: number;  // ms, default 30000
  nonceStore: NonceStore;     // To prevent replay
}

// Sign format: timestamp|nonce|bodyHash
function createSignature(privateKey: string, request: SignedRequest): string;

// Verify format: check timestamp, nonce, signature
function verifySignature(publicKey: string, request: SignedRequest): boolean;
```

**Acceptance Criteria:**
- [ ] Requests signed with Ed25519
- [ ] Timestamp within 30 seconds of server time
- [ ] Nonce rejected if seen before (1 hour window)
- [ ] Signature covers timestamp + nonce + body hash
- [ ] Clear error messages for each failure type

---

## Sprint 1 Deliverables Checklist

```
[ ] JWT authentication working
[ ] API key authentication working
[ ] Tenant isolation in all queries
[ ] Rate limiting configured
[ ] Request signing implemented
[ ] 15+ new security tests
[ ] Security documentation updated
```

---

# SPRINT 2: Pipeline Integration
## Week 3-4

### Epic P1: Create Runtime Package

---

#### P1.1: Initialize @vorion/runtime Package
**Priority:** P0
**Effort:** 1 day

```bash
mkdir -p packages/runtime/src
```

**Create Files:**
```
packages/runtime/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts
│   ├── pipeline/
│   │   ├── index.ts
│   │   ├── intent-pipeline.ts
│   │   └── types.ts
│   ├── trust/
│   │   ├── index.ts
│   │   ├── trust-facade.ts
│   │   └── types.ts
│   ├── agents/
│   │   ├── index.ts
│   │   ├── lifecycle.ts
│   │   └── types.ts
│   └── config/
│       ├── index.ts
│       └── defaults.ts
└── tests/
    └── unit/
        ├── pipeline.test.ts
        └── trust-facade.test.ts
```

**package.json:**
```json
{
  "name": "@vorion/runtime",
  "version": "0.1.0",
  "description": "Vorion Runtime - Unified orchestration layer",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "dependencies": {
    "@vorionsys/atsf-core": "*",
    "@vorion/proof-plane": "*",
    "@vorion/a3i": "*",
    "@vorion/contracts": "*"
  }
}
```

---

#### P1.2: Intent Pipeline Implementation
**Priority:** P0
**Effort:** 3 days
**Location:** `packages/runtime/src/pipeline/intent-pipeline.ts`

```typescript
/**
 * The Intent Pipeline wires together all Kaizen layers:
 * INTENT → GOVERN → ENFORCE → EXECUTE → PROOF
 */

interface PipelineConfig {
  trustEngine: TrustEngine;
  governanceEngine: GovernanceEngine;
  enforcementService: EnforcementService;
  cognigateGateway: CognigateGateway;
  proofService: ProofService;
  proofPlane: ProofPlane;
}

interface PipelineResult {
  intentId: string;
  status: 'approved' | 'denied' | 'pending_review' | 'executed' | 'failed';
  decision?: FluidDecision;
  executionResult?: ExecutionResult;
  proofId?: string;
  error?: string;
  timing: {
    intentMs: number;
    governanceMs: number;
    enforcementMs: number;
    executionMs: number;
    proofMs: number;
    totalMs: number;
  };
}

class IntentPipeline {
  constructor(private config: PipelineConfig) {}

  /**
   * Process an intent through the full pipeline
   */
  async process(submission: IntentSubmission): Promise<PipelineResult> {
    const timing = { intentMs: 0, governanceMs: 0, enforcementMs: 0, executionMs: 0, proofMs: 0, totalMs: 0 };
    const start = performance.now();

    // Step 1: Create intent record
    const intentStart = performance.now();
    const intent = await this.config.intentService.submit(submission);
    timing.intentMs = performance.now() - intentStart;

    // Step 2: Get trust score for entity
    const trustRecord = await this.config.trustEngine.getScore(submission.entityId);
    if (!trustRecord) {
      return this.deny(intent.id, 'Entity not registered', timing);
    }

    // Step 3: Governance evaluation
    const govStart = performance.now();
    const govRequest: GovernanceRequest = {
      requestId: crypto.randomUUID(),
      entityId: submission.entityId,
      trustLevel: trustRecord.level,
      action: submission.goal,
      capabilities: [],
      resources: [],
      context: submission.context,
    };
    const govResult = await this.config.governanceEngine.evaluate(govRequest);
    timing.governanceMs = performance.now() - govStart;

    // Step 4: Enforcement decision
    const enforceStart = performance.now();
    const decision = await this.config.enforcementService.decide({
      intent,
      evaluation: this.adaptGovResult(govResult),
      trustScore: trustRecord.score,
      trustLevel: trustRecord.level,
    });
    timing.enforcementMs = performance.now() - enforceStart;

    // Step 5: Record decision in proof plane
    await this.config.proofPlane.recordEvent({
      type: 'decision_made',
      entityId: submission.entityId,
      payload: { intentId: intent.id, decision: decision.action },
    });

    // Step 6: Execute if allowed
    if (decision.action === 'allow') {
      const execStart = performance.now();
      const execResult = await this.config.cognigateGateway.execute({
        intent,
        decision,
        resourceLimits: this.getResourceLimits(trustRecord.level),
      });
      timing.executionMs = performance.now() - execStart;

      // Step 7: Record execution proof
      const proofStart = performance.now();
      const proof = await this.config.proofService.create({
        intent,
        decision,
        inputs: submission.context,
        outputs: execResult.outputs,
      });
      timing.proofMs = performance.now() - proofStart;

      // Step 8: Update trust based on outcome
      await this.updateTrust(submission.entityId, execResult.success);

      timing.totalMs = performance.now() - start;
      return {
        intentId: intent.id,
        status: execResult.success ? 'executed' : 'failed',
        decision: this.toFluidDecision(decision, govResult),
        executionResult: execResult,
        proofId: proof.id,
        timing,
      };
    }

    timing.totalMs = performance.now() - start;
    return {
      intentId: intent.id,
      status: decision.action === 'deny' ? 'denied' : 'pending_review',
      decision: this.toFluidDecision(decision, govResult),
      timing,
    };
  }

  private getResourceLimits(trustLevel: TrustLevel): ResourceLimits {
    // Higher trust = more resources
    const limits: Record<TrustLevel, ResourceLimits> = {
      0: { maxMemoryMb: 64, maxCpuPercent: 10, timeoutMs: 5000 },
      1: { maxMemoryMb: 128, maxCpuPercent: 20, timeoutMs: 30000 },
      2: { maxMemoryMb: 256, maxCpuPercent: 30, timeoutMs: 60000 },
      3: { maxMemoryMb: 512, maxCpuPercent: 50, timeoutMs: 120000 },
      4: { maxMemoryMb: 1024, maxCpuPercent: 75, timeoutMs: 300000 },
      5: { maxMemoryMb: 2048, maxCpuPercent: 100, timeoutMs: 600000 },
    };
    return limits[trustLevel] ?? limits[0];
  }

  private async updateTrust(entityId: string, success: boolean): Promise<void> {
    const signal: TrustSignal = {
      id: crypto.randomUUID(),
      entityId,
      type: success ? 'behavioral.task_completed' : 'behavioral.task_failed',
      value: success ? 0.9 : 0.1,
      source: 'pipeline',
      timestamp: new Date().toISOString(),
      metadata: {},
    };
    await this.config.trustEngine.recordSignal(signal);
  }
}
```

**Acceptance Criteria:**
- [ ] Full pipeline executes in correct order
- [ ] Each step timed and logged
- [ ] Proof created for every decision
- [ ] Trust updated after execution
- [ ] Resource limits based on trust tier
- [ ] Integration test with all components

---

#### P1.3: Trust Facade (Unified Trust)
**Priority:** P0
**Effort:** 2 days
**Location:** `packages/runtime/src/trust/trust-facade.ts`

```typescript
/**
 * TrustFacade unifies the two trust engines:
 * - atsf-core TrustEngine: Decay, signals, persistence
 * - a3i TrustDynamicsEngine: Asymmetric updates, cooldowns, circuit breakers
 *
 * This facade provides a single interface and coordinates between them.
 */

interface TrustFacadeConfig {
  primaryEngine: 'atsf' | 'a3i';  // Which is source of truth
  enableDynamics: boolean;        // Use a3i dynamics
  enableDecay: boolean;           // Use atsf decay profiles
  syncInterval: number;           // ms between syncs
}

class TrustFacade {
  private atsfEngine: TrustEngine;
  private a3iDynamics: TrustDynamicsEngine;
  private config: TrustFacadeConfig;

  constructor(config: TrustFacadeConfig) {
    this.config = config;
    this.atsfEngine = createTrustEngine();
    this.a3iDynamics = createTrustDynamicsEngine();
  }

  /**
   * Get unified trust score
   */
  async getScore(entityId: string): Promise<UnifiedTrustScore> {
    const atsfRecord = await this.atsfEngine.getScore(entityId);
    const a3iState = this.a3iDynamics.getState(entityId);

    return {
      score: atsfRecord?.score ?? 0,
      level: atsfRecord?.level ?? 0,
      band: this.levelToTrustBand(atsfRecord?.level ?? 0),

      // Dynamics state from a3i
      inCooldown: a3iState.cooldown.inCooldown,
      cooldownEndsAt: a3iState.cooldown.cooldownEndsAt,
      circuitBreakerTripped: a3iState.circuitBreakerTripped,

      // Decay info from atsf
      daysSinceLastSignal: this.calculateStaleness(atsfRecord),
      decayProfile: this.getDecayProfile(entityId),
    };
  }

  /**
   * Record a trust signal - coordinates both engines
   */
  async recordSignal(signal: TrustSignal): Promise<TrustUpdateResult> {
    // 1. Record in atsf-core (persistence, decay)
    await this.atsfEngine.recordSignal(signal);

    // 2. Apply dynamics in a3i (asymmetric, cooldown)
    const isSuccess = signal.value >= 0.7;
    const ceiling = this.getObservationCeiling(signal.entityId);

    const dynamicsResult = this.a3iDynamics.updateTrust(signal.entityId, {
      currentScore: (await this.atsfEngine.getScore(signal.entityId))?.score ?? 0,
      success: isSuccess,
      ceiling,
      magnitude: signal.value,
    });

    return {
      newScore: dynamicsResult.newScore,
      delta: dynamicsResult.delta,
      blockedByCooldown: dynamicsResult.blockedByCooldown,
      circuitBreakerTripped: dynamicsResult.circuitBreakerTripped,
    };
  }

  /**
   * Check if agent can perform action
   */
  async canPerform(entityId: string, requiredLevel: TrustLevel): Promise<CanPerformResult> {
    const score = await this.getScore(entityId);

    if (score.circuitBreakerTripped) {
      return { allowed: false, reason: 'Circuit breaker tripped', score };
    }

    if (score.level < requiredLevel) {
      return { allowed: false, reason: `Requires trust level ${requiredLevel}, have ${score.level}`, score };
    }

    return { allowed: true, score };
  }
}
```

**Acceptance Criteria:**
- [ ] Single interface for all trust operations
- [ ] atsf-core handles persistence and decay
- [ ] a3i handles asymmetric dynamics
- [ ] No conflicting state between engines
- [ ] Clear which engine is source of truth

---

#### P1.4: Agent Lifecycle Management
**Priority:** P1
**Effort:** 2 days
**Location:** `packages/runtime/src/agents/lifecycle.ts`

```typescript
interface AgentRegistration {
  agentId: string;
  name: string;
  capabilities: string[];
  observationTier: ObservationTier;
  metadata?: Record<string, unknown>;
}

interface AgentState {
  agentId: string;
  status: 'active' | 'suspended' | 'terminated';
  trustScore: UnifiedTrustScore;
  registeredAt: Date;
  lastActiveAt: Date;
  suspendedAt?: Date;
  suspensionReason?: string;
}

class AgentLifecycleManager {
  /**
   * Register a new agent - starts at T0 Sandbox
   */
  async register(registration: AgentRegistration): Promise<AgentState> {
    // 1. Validate capabilities against observation tier
    // 2. Initialize trust at T0
    // 3. Record registration in proof plane
    // 4. Return initial state
  }

  /**
   * Suspend an agent - blocks all actions
   */
  async suspend(agentId: string, reason: string): Promise<void> {
    // 1. Update state to suspended
    // 2. Trip circuit breaker
    // 3. Record suspension event
  }

  /**
   * Terminate an agent - permanent removal
   */
  async terminate(agentId: string, reason: string): Promise<void> {
    // 1. Kill active executions
    // 2. Update state to terminated
    // 3. Archive trust history
    // 4. Record termination event
  }

  /**
   * Get agent state
   */
  async getState(agentId: string): Promise<AgentState | null>;

  /**
   * List agents by status
   */
  async list(filter: AgentFilter): Promise<AgentState[]>;
}
```

**Acceptance Criteria:**
- [ ] Agents start at T0 Sandbox
- [ ] Suspension blocks all actions
- [ ] Termination is permanent
- [ ] All lifecycle events recorded in proof plane
- [ ] Can query agents by status

---

### Epic P2: Wire Existing Components

---

#### P2.1: Connect GovernanceEngine to Pipeline
**Priority:** P0
**Effort:** 1 day
**Modify:** `packages/atsf-core/src/governance/index.ts`

```typescript
// Add pipeline-compatible interface

export interface GovernancePlugin {
  /**
   * Evaluate a request and return pipeline-compatible result
   */
  evaluate(request: GovernanceRequest): Promise<GovernanceResult>;

  /**
   * Convert to FluidDecision for three-tier model
   */
  toFluidDecision(result: GovernanceResult): FluidDecision;
}

// Implement adapter
export function createGovernancePlugin(
  engine: GovernanceEngine
): GovernancePlugin {
  return {
    async evaluate(request) {
      return engine.evaluate(request);
    },
    toFluidDecision(result) {
      // Map GovernanceResult to FluidDecision
      const tier = this.determineTier(result);
      return {
        // ... mapping
      };
    },
  };
}
```

---

#### P2.2: Connect ProofPlane to Pipeline
**Priority:** P0
**Effort:** 1 day
**Location:** `packages/runtime/src/adapters/proof-plane-adapter.ts`

```typescript
// Adapter that writes to both ProofService and ProofPlane

class ProofPlaneAdapter {
  constructor(
    private proofService: ProofService,
    private proofPlane: ProofPlane
  ) {}

  async recordDecision(
    intent: Intent,
    decision: Decision
  ): Promise<{ proofId: string; eventId: string }> {
    // 1. Record in ProofService (legacy chain)
    const proof = await this.proofService.create({
      intent,
      decision,
      inputs: intent.context,
      outputs: {},
    });

    // 2. Record in ProofPlane (new event store)
    const event = await this.proofPlane.recordEvent({
      type: 'decision_made',
      entityId: intent.entityId,
      payload: {
        intentId: intent.id,
        proofId: proof.id,
        action: decision.action,
      },
    });

    return { proofId: proof.id, eventId: event.id };
  }

  async recordExecution(
    intent: Intent,
    result: ExecutionResult
  ): Promise<{ eventId: string }> {
    const event = await this.proofPlane.recordEvent({
      type: result.success ? 'execution_completed' : 'execution_failed',
      entityId: intent.entityId,
      payload: {
        intentId: intent.id,
        success: result.success,
        outputs: result.outputs,
        resourceUsage: result.resourceUsage,
      },
    });

    return { eventId: event.id };
  }
}
```

---

## Sprint 2 Deliverables Checklist

```
[ ] @vorion/runtime package created
[ ] IntentPipeline wires all layers
[ ] TrustFacade unifies trust engines
[ ] AgentLifecycleManager complete
[ ] GovernanceEngine connected
[ ] ProofPlane connected
[ ] Full integration test passing
[ ] Pipeline handles all edge cases
```

---

# SPRINT 3: Developer SDK
## Week 5-6

### Epic D1: Create @vorion/sdk Package

---

#### D1.1: Initialize SDK Package
**Priority:** P0
**Effort:** 1 day

```
packages/sdk/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── index.ts              # Main export
│   ├── client.ts             # VorionClient class
│   ├── agents.ts             # Agent management
│   ├── trust.ts              # Trust queries
│   ├── intents.ts            # Intent submission
│   ├── proofs.ts             # Proof queries
│   ├── types.ts              # Public types
│   └── errors.ts             # SDK errors
└── examples/
    ├── basic-agent.ts
    ├── custom-handler.ts
    └── trust-monitoring.ts
```

---

#### D1.2: VorionClient - Main Entry Point
**Priority:** P0
**Effort:** 2 days
**Location:** `packages/sdk/src/client.ts`

```typescript
/**
 * Main SDK client - single entry point for all Vorion operations
 */

interface VorionConfig {
  /** API key for authentication */
  apiKey: string;

  /** API endpoint (default: https://api.vorion.io) */
  endpoint?: string;

  /** Environment (affects defaults) */
  environment?: 'development' | 'staging' | 'production';

  /** Request timeout in ms */
  timeout?: number;

  /** Enable debug logging */
  debug?: boolean;

  /** Custom fetch implementation */
  fetch?: typeof fetch;
}

class VorionClient {
  /** Agent management */
  readonly agents: AgentClient;

  /** Trust operations */
  readonly trust: TrustClient;

  /** Intent submission */
  readonly intents: IntentClient;

  /** Proof queries */
  readonly proofs: ProofClient;

  private constructor(config: VorionConfig) {
    const httpClient = new HttpClient(config);

    this.agents = new AgentClient(httpClient);
    this.trust = new TrustClient(httpClient);
    this.intents = new IntentClient(httpClient);
    this.proofs = new ProofClient(httpClient);
  }

  /**
   * Create a new Vorion client
   */
  static create(config: VorionConfig): VorionClient {
    return new VorionClient(config);
  }

  /**
   * Create client from environment variables
   */
  static fromEnv(): VorionClient {
    const apiKey = process.env.VORION_API_KEY;
    if (!apiKey) throw new Error('VORION_API_KEY not set');

    return VorionClient.create({
      apiKey,
      endpoint: process.env.VORION_ENDPOINT,
      environment: process.env.VORION_ENV as any,
    });
  }
}

// Usage:
const vorion = VorionClient.create({ apiKey: 'vk_...' });
```

---

#### D1.3: Agent Client
**Priority:** P0
**Effort:** 2 days
**Location:** `packages/sdk/src/agents.ts`

```typescript
class AgentClient {
  /**
   * Register a new agent
   */
  async register(options: RegisterAgentOptions): Promise<Agent> {
    // POST /api/agents
  }

  /**
   * Get agent by ID
   */
  async get(agentId: string): Promise<Agent | null> {
    // GET /api/agents/:id
  }

  /**
   * List agents with optional filters
   */
  async list(options?: ListAgentsOptions): Promise<PaginatedResult<Agent>> {
    // GET /api/agents
  }

  /**
   * Suspend an agent
   */
  async suspend(agentId: string, reason: string): Promise<void> {
    // POST /api/agents/:id/suspend
  }

  /**
   * Reactivate a suspended agent
   */
  async reactivate(agentId: string): Promise<void> {
    // POST /api/agents/:id/reactivate
  }

  /**
   * Terminate an agent (permanent)
   */
  async terminate(agentId: string, reason: string): Promise<void> {
    // DELETE /api/agents/:id
  }

  /**
   * Get agent's current trust score
   */
  async getTrust(agentId: string): Promise<TrustScore> {
    // GET /api/agents/:id/trust
  }

  /**
   * Get agent's trust history
   */
  async getTrustHistory(agentId: string, options?: HistoryOptions): Promise<TrustHistory> {
    // GET /api/agents/:id/trust/history
  }
}

// Usage:
const agent = await vorion.agents.register({
  name: 'my-assistant',
  capabilities: ['read', 'write'],
});

const trust = await vorion.agents.getTrust(agent.id);
console.log(`Trust level: T${trust.level} (${trust.score}/1000)`);
```

---

#### D1.4: Intent Client
**Priority:** P0
**Effort:** 2 days
**Location:** `packages/sdk/src/intents.ts`

```typescript
class IntentClient {
  /**
   * Submit an intent for governance
   */
  async submit(options: SubmitIntentOptions): Promise<IntentResult> {
    // POST /api/intents
  }

  /**
   * Get intent status
   */
  async get(intentId: string): Promise<Intent> {
    // GET /api/intents/:id
  }

  /**
   * List intents for an agent
   */
  async list(agentId: string, options?: ListOptions): Promise<PaginatedResult<Intent>> {
    // GET /api/agents/:id/intents
  }

  /**
   * Submit refinement for YELLOW decision
   */
  async refine(intentId: string, refinements: Refinement[]): Promise<IntentResult> {
    // POST /api/intents/:id/refine
  }

  /**
   * Cancel a pending intent
   */
  async cancel(intentId: string): Promise<void> {
    // POST /api/intents/:id/cancel
  }
}

// Usage:
const result = await vorion.intents.submit({
  agentId: agent.id,
  action: 'send_email',
  resource: 'users/123',
  context: {
    subject: 'Welcome!',
    template: 'onboarding',
  },
});

if (result.decision.tier === 'GREEN') {
  console.log('Approved! Execution result:', result.execution);
} else if (result.decision.tier === 'YELLOW') {
  console.log('Needs refinement:', result.decision.refinementOptions);
} else {
  console.log('Denied:', result.decision.reasoning);
}
```

---

#### D1.5: Trust Client
**Priority:** P1
**Effort:** 1 day
**Location:** `packages/sdk/src/trust.ts`

```typescript
class TrustClient {
  /**
   * Get trust score for an entity
   */
  async get(entityId: string): Promise<TrustScore> {
    // GET /api/trust/:entityId
  }

  /**
   * Get trust history
   */
  async history(entityId: string, options?: HistoryOptions): Promise<TrustHistory> {
    // GET /api/trust/:entityId/history
  }

  /**
   * Predict when entity will reach target level
   */
  async predictPromotion(entityId: string, targetLevel: number): Promise<Prediction> {
    // GET /api/trust/:entityId/predict
  }

  /**
   * Get tier thresholds
   */
  async thresholds(): Promise<TierThresholds> {
    // GET /api/trust/thresholds
  }
}
```

---

#### D1.6: Proof Client
**Priority:** P1
**Effort:** 1 day
**Location:** `packages/sdk/src/proofs.ts`

```typescript
class ProofClient {
  /**
   * Get proof by ID
   */
  async get(proofId: string): Promise<Proof> {
    // GET /api/proofs/:id
  }

  /**
   * Verify proof integrity
   */
  async verify(proofId: string): Promise<VerificationResult> {
    // POST /api/proofs/:id/verify
  }

  /**
   * Query proofs
   */
  async query(options: ProofQuery): Promise<PaginatedResult<Proof>> {
    // GET /api/proofs
  }

  /**
   * Get Merkle proof for a specific event
   */
  async getMerkleProof(proofId: string): Promise<MerkleProof> {
    // GET /api/proofs/:id/merkle
  }

  /**
   * Export proofs for audit
   */
  async export(options: ExportOptions): Promise<ExportResult> {
    // POST /api/proofs/export
  }
}
```

---

### Epic D2: API Endpoints

---

#### D2.1: Create REST API Routes
**Priority:** P0
**Effort:** 3 days
**Location:** `packages/atsf-core/src/api/routes/`

```
packages/atsf-core/src/api/routes/
├── index.ts           # Route registration
├── agents.ts          # /api/agents/*
├── intents.ts         # /api/intents/*
├── trust.ts           # /api/trust/*
├── proofs.ts          # /api/proofs/*
└── health.ts          # /health, /ready
```

**Example route implementation:**

```typescript
// packages/atsf-core/src/api/routes/agents.ts

import { FastifyPluginAsync } from 'fastify';

export const agentRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/agents - Register new agent
  fastify.post('/api/agents', {
    schema: {
      body: RegisterAgentSchema,
      response: {
        201: AgentSchema,
        400: ErrorSchema,
      },
    },
  }, async (request, reply) => {
    const agent = await agentLifecycle.register(request.body);
    return reply.status(201).send(agent);
  });

  // GET /api/agents/:id - Get agent
  fastify.get('/api/agents/:id', async (request, reply) => {
    const agent = await agentLifecycle.getState(request.params.id);
    if (!agent) return reply.status(404).send({ error: 'Agent not found' });
    return agent;
  });

  // GET /api/agents/:id/trust - Get trust score
  fastify.get('/api/agents/:id/trust', async (request, reply) => {
    const trust = await trustFacade.getScore(request.params.id);
    return trust;
  });

  // POST /api/agents/:id/suspend - Suspend agent
  fastify.post('/api/agents/:id/suspend', async (request, reply) => {
    await agentLifecycle.suspend(request.params.id, request.body.reason);
    return reply.status(204).send();
  });
};
```

---

#### D2.2: Generate OpenAPI Spec
**Priority:** P1
**Effort:** 1 day

```typescript
// packages/atsf-core/src/api/openapi.ts

import { fastifySwagger } from '@fastify/swagger';
import { fastifySwaggerUi } from '@fastify/swagger-ui';

export async function registerOpenAPI(fastify: FastifyInstance) {
  await fastify.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Vorion API',
        description: 'AI Agent Governance Platform',
        version: '1.0.0',
      },
      servers: [
        { url: 'https://api.vorion.io', description: 'Production' },
        { url: 'https://staging-api.vorion.io', description: 'Staging' },
      ],
      components: {
        securitySchemes: {
          ApiKey: {
            type: 'apiKey',
            in: 'header',
            name: 'X-API-Key',
          },
          Bearer: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
  });

  await fastify.register(fastifySwaggerUi, {
    routePrefix: '/docs',
  });
}
```

---

### Epic D3: Documentation & Examples

---

#### D3.1: Getting Started Guide
**Priority:** P1
**Effort:** 1 day
**Location:** `packages/sdk/README.md`

```markdown
# Vorion SDK

The official TypeScript SDK for the Vorion AI Governance Platform.

## Installation

```bash
npm install @vorion/sdk
```

## Quick Start

```typescript
import { VorionClient } from '@vorion/sdk';

// Create client
const vorion = VorionClient.create({
  apiKey: process.env.VORION_API_KEY,
});

// Register an agent
const agent = await vorion.agents.register({
  name: 'my-assistant',
  capabilities: ['read', 'write', 'execute'],
});

// Submit an intent
const result = await vorion.intents.submit({
  agentId: agent.id,
  action: 'process_order',
  resource: 'orders/12345',
  context: { priority: 'high' },
});

// Check result
if (result.decision.tier === 'GREEN') {
  console.log('Order processed:', result.execution.outputs);
}
```

## Trust Tiers

| Tier | Score | Capabilities |
|------|-------|--------------|
| T0 Sandbox | 0-199 | Testing only |
| T1 Observed | 200-349 | Read operations |
| ... | ... | ... |
```

---

#### D3.2: Example Implementations
**Priority:** P1
**Effort:** 2 days
**Location:** `packages/sdk/examples/`

Create working examples:
1. `basic-agent.ts` - Simple agent registration and intent
2. `trust-monitoring.ts` - Watch trust score changes
3. `custom-handler.ts` - Register execution handlers
4. `webhook-integration.ts` - Receive callbacks
5. `batch-operations.ts` - Process multiple intents

---

## Sprint 3 Deliverables Checklist

```
[ ] @vorion/sdk package created
[ ] VorionClient with all sub-clients
[ ] REST API endpoints for all operations
[ ] OpenAPI spec generation
[ ] Swagger UI at /docs
[ ] Getting started guide
[ ] 5+ working examples
[ ] SDK published to npm (private)
```

---

# SPRINT 4: Production Hardening
## Week 7-8

### Epic H1: Observability

---

#### H1.1: Prometheus Metrics
**Priority:** P1
**Effort:** 2 days
**Location:** `packages/atsf-core/src/observability/metrics.ts`

```typescript
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

const registry = new Registry();

// Request metrics
export const httpRequestsTotal = new Counter({
  name: 'vorion_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status', 'tenant'],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'vorion_http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'path', 'tenant'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [registry],
});

// Trust metrics
export const trustScoreGauge = new Gauge({
  name: 'vorion_trust_score',
  help: 'Current trust score',
  labelNames: ['entity_id', 'tenant'],
  registers: [registry],
});

export const trustDecaysTotal = new Counter({
  name: 'vorion_trust_decays_total',
  help: 'Total trust decay events',
  labelNames: ['entity_id', 'tenant', 'profile'],
  registers: [registry],
});

// Intent metrics
export const intentsTotal = new Counter({
  name: 'vorion_intents_total',
  help: 'Total intents submitted',
  labelNames: ['tenant', 'decision'],
  registers: [registry],
});

export const intentDuration = new Histogram({
  name: 'vorion_intent_duration_seconds',
  help: 'Intent processing duration',
  labelNames: ['tenant', 'decision'],
  buckets: [0.1, 0.5, 1, 5, 10, 30],
  registers: [registry],
});

// Execution metrics
export const executionsTotal = new Counter({
  name: 'vorion_executions_total',
  help: 'Total executions',
  labelNames: ['tenant', 'success'],
  registers: [registry],
});

export const executionMemoryUsage = new Histogram({
  name: 'vorion_execution_memory_mb',
  help: 'Execution memory usage',
  labelNames: ['tenant'],
  buckets: [64, 128, 256, 512, 1024, 2048],
  registers: [registry],
});
```

---

#### H1.2: Health Checks
**Priority:** P0
**Effort:** 1 day
**Modify:** `packages/atsf-core/src/api/server.ts`

```typescript
interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    database: CheckResult;
    proofPlane: CheckResult;
    trustEngine: CheckResult;
  };
  version: string;
  uptime: number;
}

// GET /health - Liveness probe
fastify.get('/health', async () => {
  return { status: 'ok' };
});

// GET /ready - Readiness probe
fastify.get('/ready', async () => {
  const checks = await Promise.all([
    checkDatabase(),
    checkProofPlane(),
    checkTrustEngine(),
  ]);

  const allHealthy = checks.every(c => c.healthy);
  const status: HealthStatus = {
    status: allHealthy ? 'healthy' : 'degraded',
    checks: {
      database: checks[0],
      proofPlane: checks[1],
      trustEngine: checks[2],
    },
    version: process.env.npm_package_version ?? 'unknown',
    uptime: process.uptime(),
  };

  if (!allHealthy) {
    return reply.status(503).send(status);
  }
  return status;
});

// GET /metrics - Prometheus metrics
fastify.get('/metrics', async (_, reply) => {
  reply.header('Content-Type', registry.contentType);
  return registry.metrics();
});
```

---

#### H1.3: Structured Logging
**Priority:** P1
**Effort:** 1 day
**Modify:** `packages/atsf-core/src/common/logger.ts`

```typescript
// Add correlation ID and tenant context to all logs

import { AsyncLocalStorage } from 'async_hooks';

const logContext = new AsyncLocalStorage<LogContext>();

interface LogContext {
  correlationId: string;
  tenantId: string;
  userId?: string;
  agentId?: string;
}

export function createLogger(options: LoggerOptions) {
  const baseLogger = pino({
    level: process.env.LOG_LEVEL ?? 'info',
    formatters: {
      level: (label) => ({ level: label }),
    },
    mixin() {
      const ctx = logContext.getStore();
      return ctx ? {
        correlationId: ctx.correlationId,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        agentId: ctx.agentId,
      } : {};
    },
  });

  return baseLogger.child({
    service: 'vorion',
    version: process.env.npm_package_version,
    component: options.component,
  });
}

// Middleware to set context
export function logContextMiddleware(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const ctx: LogContext = {
    correlationId: request.headers['x-correlation-id'] as string ?? crypto.randomUUID(),
    tenantId: request.tenantId,
    userId: request.user?.id,
  };

  logContext.run(ctx, done);
}
```

---

### Epic H2: Deployment

---

#### H2.1: Docker Configuration
**Priority:** P0
**Effort:** 1 day
**Location:** `packages/atsf-core/Dockerfile`

```dockerfile
# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy workspace files
COPY package*.json ./
COPY packages/contracts/package*.json ./packages/contracts/
COPY packages/proof-plane/package*.json ./packages/proof-plane/
COPY packages/atsf-core/package*.json ./packages/atsf-core/

# Install dependencies
RUN npm ci --workspace=@vorionsys/atsf-core

# Copy source
COPY packages/contracts ./packages/contracts
COPY packages/proof-plane ./packages/proof-plane
COPY packages/atsf-core ./packages/atsf-core

# Build
RUN npm run build --workspace=@vorionsys/atsf-core

# Production stage
FROM node:22-alpine AS runner

WORKDIR /app

# Security: non-root user
RUN addgroup -g 1001 -S vorion && \
    adduser -S vorion -u 1001
USER vorion

# Copy built artifacts
COPY --from=builder --chown=vorion:vorion /app/packages/atsf-core/dist ./dist
COPY --from=builder --chown=vorion:vorion /app/packages/atsf-core/package.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["node", "dist/api/server.js"]
```

---

#### H2.2: Kubernetes Manifests
**Priority:** P1
**Effort:** 1 day
**Location:** `deploy/kubernetes/`

```yaml
# deploy/kubernetes/deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vorion-api
spec:
  replicas: 3
  selector:
    matchLabels:
      app: vorion-api
  template:
    metadata:
      labels:
        app: vorion-api
    spec:
      containers:
      - name: vorion-api
        image: vorion/atsf-core:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: production
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: vorion-secrets
              key: jwt-secret
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

---

#### H2.3: Graceful Shutdown
**Priority:** P1
**Effort:** 1 day
**Modify:** `packages/atsf-core/src/api/server.ts`

```typescript
async function startServer() {
  const server = await createServer(config);

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');

    // Stop accepting new connections
    server.close();

    // Wait for active requests (max 30 seconds)
    const timeout = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30000);

    try {
      // Terminate active executions
      const activeExecutions = cognigateGateway.getActiveExecutions();
      await Promise.all(activeExecutions.map(id => cognigateGateway.terminate(id)));

      // Flush proof plane
      await proofPlane.flush();

      // Close database connections
      await persistence.close();

      clearTimeout(timeout);
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ error }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await server.listen({ port: config.port, host: '0.0.0.0' });
}
```

---

### Epic H3: Testing & CI

---

#### H3.1: Integration Test Suite
**Priority:** P0
**Effort:** 2 days
**Location:** `packages/runtime/tests/integration/`

```typescript
// packages/runtime/tests/integration/full-pipeline.test.ts

describe('Full Pipeline Integration', () => {
  let vorion: VorionClient;
  let testAgent: Agent;

  beforeAll(async () => {
    vorion = VorionClient.create({ apiKey: process.env.TEST_API_KEY });
  });

  beforeEach(async () => {
    testAgent = await vorion.agents.register({
      name: `test-agent-${Date.now()}`,
      capabilities: ['read', 'write'],
    });
  });

  afterEach(async () => {
    await vorion.agents.terminate(testAgent.id, 'test cleanup');
  });

  it('should process GREEN intent through full pipeline', async () => {
    // Start at T0, do 50 successful operations to reach T2
    for (let i = 0; i < 50; i++) {
      await vorion.intents.submit({
        agentId: testAgent.id,
        action: 'read_data',
        resource: 'public/data',
        context: {},
      });
    }

    const trust = await vorion.agents.getTrust(testAgent.id);
    expect(trust.level).toBeGreaterThanOrEqual(2);
    expect(trust.score).toBeGreaterThan(350);
  });

  it('should handle YELLOW decision with refinement', async () => {
    const result = await vorion.intents.submit({
      agentId: testAgent.id,
      action: 'delete_data',
      resource: 'sensitive/records',
      context: {},
    });

    expect(result.decision.tier).toBe('YELLOW');
    expect(result.decision.refinementOptions).toBeDefined();
    expect(result.decision.refinementOptions.length).toBeGreaterThan(0);

    // Apply refinement
    const refined = await vorion.intents.refine(result.intentId, [
      { action: 'REDUCE_SCOPE', parameters: { limit: 10 } },
    ]);

    expect(refined.decision.tier).toBe('GREEN');
  });

  it('should apply trust penalty on failure', async () => {
    const initialTrust = await vorion.agents.getTrust(testAgent.id);

    // Simulate failure
    await simulateFailure(testAgent.id);

    const afterTrust = await vorion.agents.getTrust(testAgent.id);

    // 10:1 asymmetric penalty
    expect(afterTrust.score).toBeLessThan(initialTrust.score);
    expect(initialTrust.score - afterTrust.score).toBeGreaterThan(10);
  });

  it('should create verifiable proof for every decision', async () => {
    const result = await vorion.intents.submit({
      agentId: testAgent.id,
      action: 'process_data',
      resource: 'data/123',
      context: {},
    });

    expect(result.proofId).toBeDefined();

    const verification = await vorion.proofs.verify(result.proofId);
    expect(verification.valid).toBe(true);
    expect(verification.issues).toHaveLength(0);
  });
});
```

---

#### H3.2: CI/CD Pipeline
**Priority:** P0
**Effort:** 1 day
**Location:** `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_PASSWORD: postgres
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'

      - run: npm ci

      - run: npm run typecheck --workspaces

      - run: npm run lint --workspaces

      - run: npm test --workspaces
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost:5432/test

      - run: npm run build --workspaces

      - uses: codecov/codecov-action@v4
        with:
          files: ./coverage/lcov.info

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm audit --audit-level=high
      - uses: snyk/actions/node@master
        env:
          SNYK_TOKEN: ${{ secrets.SNYK_TOKEN }}

  deploy-staging:
    needs: [test, security]
    if: github.ref == 'refs/heads/develop'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t vorion/atsf-core:staging .
      - run: docker push vorion/atsf-core:staging
      # Deploy to staging K8s cluster
```

---

## Sprint 4 Deliverables Checklist

```
[ ] Prometheus metrics exported
[ ] Health/ready endpoints working
[ ] Structured logging with correlation
[ ] Docker image builds
[ ] Kubernetes manifests ready
[ ] Graceful shutdown implemented
[ ] Integration test suite passing
[ ] CI/CD pipeline running
[ ] Staging deployment working
```

---

# Final Checklist: Production Ready

```
SECURITY
[ ] JWT authentication enforced on all endpoints
[ ] API key authentication working
[ ] Tenant isolation verified
[ ] Rate limiting configured
[ ] Request signing optional but available
[ ] Secrets not in code

PIPELINE
[ ] Intent → Governance → Enforce → Execute → Proof working
[ ] Trust updates after every execution
[ ] Decay applied correctly
[ ] All events in proof plane

SDK
[ ] @vorion/sdk published
[ ] All CRUD operations available
[ ] TypeScript types complete
[ ] Examples running
[ ] Documentation complete

OPERATIONS
[ ] Metrics exposed on /metrics
[ ] Health checks passing
[ ] Logging structured and searchable
[ ] Alerts configured
[ ] Runbook documented

TESTING
[ ] Unit test coverage > 80%
[ ] Integration tests passing
[ ] Load tests completed
[ ] Security scan clean
```

---

**Total Effort Estimate:** 8 weeks with 1 senior engineer
**Alternative:** 4 weeks with 2 engineers working in parallel (Sprints 1+3 and 2+4)
