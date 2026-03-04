# ADR-009: Observability & Operations

## Status
**Accepted** - January 2025

## Context

Operating an AI governance platform requires comprehensive observability to:

1. **Monitor trust dynamics** - Track score changes, tier transitions, and attestation patterns
2. **Trace A2A interactions** - Follow request chains across distributed agents
3. **Debug sandbox issues** - Understand policy violations and resource usage
4. **Alert on anomalies** - Detect and respond to trust score drops, failures, and abuse

Without unified observability:
- Operators can't understand why trust scores change
- A2A call chains are opaque and hard to debug
- Sandbox violations go unnoticed until impact occurs
- Alerting is fragmented across components

## Decision

We implement a **unified observability stack** with four pillars:

### 1. Metrics (Prometheus)

All subsystems export Prometheus metrics to a dedicated registry:

```typescript
export const anchorRegistry = new Registry();

// Trust metrics
export const trustScoreDistribution = new Histogram({
  name: 'anchor_trust_score_distribution',
  buckets: [0, 100, 200, 350, 500, 650, 800, 876, 951, 1000],
});

// A2A metrics
export const a2aInvocationDuration = new Histogram({
  name: 'anchor_a2a_invocation_duration_seconds',
  labelNames: ['caller_tenant', 'action'],
});

// Sandbox metrics
export const sandboxContainersActive = new Gauge({
  name: 'anchor_sandbox_containers_active',
  labelNames: ['tier', 'runtime'],
});
```

**Key Metrics by Subsystem:**

| Subsystem | Key Metrics |
|-----------|-------------|
| Agent Registry | `agents_registered_total`, `agents_current`, `agent_state_transitions` |
| Trust Scoring | `trust_score_distribution`, `tier_transitions`, `human_approval_requests` |
| Attestations | `attestations_submitted_total`, `attestations_pending` |
| A2A | `a2a_invocations_total`, `a2a_chain_depth`, `circuit_breaker_state_changes` |
| Sandbox | `sandbox_containers_active`, `capability_requests`, `policy_violations` |
| A3I Cache | `cache_operations`, `sync_operations`, `sync_duration` |

### 2. Structured Logging

All logs include:
- **Trace context** - Automatic OpenTelemetry trace/span ID injection
- **Tenant context** - Multi-tenant isolation
- **Component context** - Which subsystem generated the log
- **Agent context** - CAR for agent-related operations

```typescript
interface LogContext {
  traceId?: string;
  spanId?: string;
  tenantId?: string;
  aci?: string;
  requestId?: string;
  component?: string;
}
```

**Log Levels by Event Type:**

| Event | Level | Example |
|-------|-------|---------|
| Agent lifecycle | INFO | `Agent registered: aci://vorion.acme.invoice:AF-L3@1.0.0` |
| Trust tier change | INFO | `Tier changed: T4 -> T5` |
| A2A success | INFO | `A2A invoke: caller -> callee:action` |
| A2A failure | WARN | `A2A failed: caller -> callee:action` |
| Policy violation | WARN | `Sandbox violation: containerId` |
| System error | ERROR | `Attestation flush failed` |

### 3. Distributed Tracing (OpenTelemetry)

All operations create spans with semantic attributes:

```typescript
export const AnchorAttributes = {
  AGENT_CAR: 'anchor.agent.aci',
  A2A_CALLER_CAR: 'anchor.a2a.caller_aci',
  A2A_CHAIN_DEPTH: 'anchor.a2a.chain_depth',
  TRUST_SCORE: 'anchor.trust.score',
  SANDBOX_CONTAINER_ID: 'anchor.sandbox.container_id',
};
```

**Traced Operations:**

| Operation | Span Name | Key Attributes |
|-----------|-----------|----------------|
| Agent registration | `agent.register` | aci, tenant |
| Trust computation | `trust.verify` | aci, score, tier |
| A2A client call | `a2a.invoke.{action}` | caller, callee, chain_depth |
| A2A server handling | `a2a.handle.{action}` | caller, action |
| Sandbox execution | `sandbox.execute` | container_id, runtime |
| Attestation processing | `attestation.process.{type}` | attestation_id, aci |

### 4. Health Checks

Kubernetes-compatible health endpoints:

| Endpoint | Purpose | Behavior |
|----------|---------|----------|
| `/health` | Full health | Returns component breakdown |
| `/health/live` | Liveness probe | Returns if event loop running |
| `/health/ready` | Readiness probe | Returns if critical deps healthy |
| `/metrics` | Prometheus scrape | Returns all metrics |

**Component Health Checks:**

```typescript
registerHealthCheck(createAgentAnchorHealthCheck({
  agentCount, pendingAttestations, cacheStatus
}));

registerHealthCheck(createA2AHealthCheck({
  endpoints, activeChains, circuitBreakersOpen
}));

registerHealthCheck(createSandboxHealthCheck({
  activeContainers, maxContainers, runtimeAvailable
}));
```

### 5. Alerting Rules

Pre-defined alert rules with severity levels:

**Critical Alerts:**
- `anchor_trust_tier_drops` - High rate of tier demotions
- `anchor_a2a_high_failure_rate` - A2A failures > 10%
- `anchor_attestation_backlog` - > 1000 pending attestations
- `anchor_sandbox_runtime_unavailable` - No sandbox containers

**Warning Alerts:**
- `anchor_trust_score_computation_slow` - > 500ms computation
- `anchor_a2a_latency_high` - > 5s latency
- `anchor_a2a_circuit_breakers_open` - Multiple open breakers
- `anchor_sandbox_near_capacity` - > 80% container capacity

**Info Alerts:**
- `anchor_new_agents_registered` - Registration spike
- `anchor_tier_promotions` - Multiple promotions
- `anchor_policy_violations` - Sandbox violations

## Implementation

### Files Created

- `src/observability/metrics.ts` - Prometheus metrics registry
- `src/observability/logging.ts` - Structured logging with trace context
- `src/observability/tracing.ts` - OpenTelemetry span builders
- `src/observability/health.ts` - Health check endpoints
- `src/observability/alerts.ts` - Alert rules and manager
- `src/observability/index.ts` - Module exports and initialization

### Integration Points

```typescript
// Initialize all observability
import { initObservability } from './observability/index.js';

initObservability({
  logging: { level: 'info', pretty: false },
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL,
});

// Register health checks in each module
registerHealthCheck(createAgentAnchorHealthCheck(getAnchorStats));
registerHealthCheck(createA2AHealthCheck(getA2AStats));

// Use tracing in operations
const agent = await traceAgentRegistration(aci, tenantId, async (span) => {
  const result = await registerAgent(options);
  addTrustToSpan(span, result.score, result.tier, true);
  return result;
});

// Use metrics in operations
recordA2AInvocation(caller, callee, action, 'success', 0.15, 2);
```

## Consequences

### Positive
- **Full visibility** - Every operation is traced and measured
- **Multi-tenant isolation** - Logs and metrics include tenant context
- **Kubernetes-native** - Standard health endpoints for orchestration
- **Actionable alerts** - Pre-configured rules for common issues

### Negative
- **Cardinality risk** - High-cardinality labels (CAR) need careful management
- **Storage costs** - Traces and metrics require significant storage
- **Performance overhead** - ~1-2% overhead from instrumentation

### Mitigations
- Use histogram buckets for trust scores (not raw values)
- Sample traces at 10% in production
- TTL metrics and traces after 7 days
- Aggregate high-cardinality metrics in dashboards

## Dashboards

Recommended Grafana dashboards:

1. **Agent Overview** - Agent counts, registrations, state distribution
2. **Trust Dynamics** - Score distributions, tier transitions, approvals
3. **A2A Traffic** - Invocation rates, latencies, chain depths
4. **Sandbox Health** - Container counts, resource usage, violations
5. **System Health** - API latency, error rates, cache performance

## References

- [ADR-002: 8-Tier Trust Model](ADR-002-8-tier-trust-model.md)
- [ADR-004: Trust Computed at Runtime](ADR-004-trust-computed-at-runtime.md)
- [ADR-008: A2A Communication Protocol](ADR-008-a2a-communication-protocol.md)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
- [Prometheus Naming Conventions](https://prometheus.io/docs/practices/naming/)
