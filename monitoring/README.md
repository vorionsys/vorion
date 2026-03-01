# Vorion Platform Monitoring

Grafana dashboards and provisioning configuration for monitoring the Vorion AI Governance Platform.

## Directory Structure

```
monitoring/
  grafana/
    vorion-overview.json   # Main platform overview dashboard
    provisioning.yaml      # Prometheus datasource provisioning
```

## Quick Start

### 1. Prerequisites

- **Prometheus** scraping Vorion service metrics endpoints
- **Grafana** 11.0+ (schemaVersion 39)
- Vorion services exposing `/metrics` endpoints (Prometheus format)

### 2. Datasource Setup

Copy the provisioning file to your Grafana provisioning directory:

```bash
# Docker / bare-metal
cp monitoring/grafana/provisioning.yaml /etc/grafana/provisioning/datasources/vorion.yaml

# Docker Compose (mount as volume)
volumes:
  - ./monitoring/grafana/provisioning.yaml:/etc/grafana/provisioning/datasources/vorion.yaml
```

Update the `url` field in `provisioning.yaml` to point to your Prometheus instance:

| Deployment          | URL                                                          |
|---------------------|--------------------------------------------------------------|
| Docker Compose      | `http://prometheus:9090`                                     |
| Kubernetes          | `http://prometheus-server.monitoring.svc.cluster.local:9090` |
| Local development   | `http://localhost:9090`                                      |

### 3. Import the Dashboard

**Option A: Grafana UI**

1. Open Grafana and navigate to **Dashboards > Import**
2. Click **Upload JSON file** and select `monitoring/grafana/vorion-overview.json`
3. Select your Prometheus datasource when prompted
4. Click **Import**

**Option B: Provisioning**

Add a dashboard provisioning config at `/etc/grafana/provisioning/dashboards/vorion.yaml`:

```yaml
apiVersion: 1
providers:
  - name: Vorion
    orgId: 1
    folder: Vorion
    type: file
    disableDeletion: false
    editable: true
    updateIntervalSeconds: 30
    options:
      path: /var/lib/grafana/dashboards/vorion
      foldersFromFilesStructure: false
```

Then copy the dashboard JSON:

```bash
mkdir -p /var/lib/grafana/dashboards/vorion
cp monitoring/grafana/vorion-overview.json /var/lib/grafana/dashboards/vorion/
```

### 4. Prometheus Scrape Configuration

Add the following scrape targets to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'vorion-cognigate-api'
    scrape_interval: 15s
    static_configs:
      - targets: ['cognigate-api:3000']
    metrics_path: /metrics

  - job_name: 'vorion-ai-gateway'
    scrape_interval: 15s
    static_configs:
      - targets: ['ai-gateway:3001']
    metrics_path: /metrics

  - job_name: 'vorion-runtime'
    scrape_interval: 15s
    static_configs:
      - targets: ['runtime:3002']
    metrics_path: /metrics
```

## Dashboard Overview

The **Vorion Platform Overview** dashboard (`uid: vorion-platform-overview`) contains six row sections:

### System Health
- API health status (up/down) and component readiness (TrustFacade, ProofCommitter, IntentPipeline)
- Process uptime
- Request rate (total, success, error)
- SLA availability and breach count
- Error rate by provider

### Trust Engine
- **Trust Score Distribution**: Agent count per tier band (T0-T1 Untrusted, T2-T3 Limited, T4-T5 Standard, T6-T7 Autonomous)
- **Tier Transitions**: Promotion and demotion rates over time
- **Decay/Accrual Rates**: Trust score changes from success signals (weight 0.1), failure signals (weight 0.5), and time-based decay. Observation ceilings: BLACK_BOX=500, GRAY_BOX=800, WHITE_BOX=1000

### AI Gateway
- **Routing Distribution**: Pie chart of privacy/specialized/green/cost-optimized routes
- **Latency Percentiles**: p50/p95/p99 with SLA threshold lines (p50 < 1000ms, p95 < 3000ms, p99 < 5000ms)
- **Model Usage by Provider**: Stacked bar chart per provider (anthropic, google, ollama, openai, azure, bedrock)
- **Degraded Mode %**: Gauge showing fallback response percentage from DegradedTracker
- **Fallback Invocations**: Per-fallback-model breakdown
- **Token Throughput**: Input/output token rates by provider

### Governance (Intent Pipeline)
- **Intent Throughput**: Submitted/allowed/denied rates (ops/min)
- **Allow/Deny Ratio**: Pie chart with gate denials, auth denials, and execution failures
- **Processing Latency**: p50/p95/p99 for the full pipeline (gate + auth + execution + proof)
- **Escalation Rate**: Percentage of intents requiring human review

### Proof Plane
- **Proof Commit Rate**: Commitments per second by event type (intent_submitted, decision_made, execution_started, execution_completed)
- **Batch Processing**: Merkle tree batch flush rate and flush latency
- **Buffer & Batch Sizes**: Current buffer size with backpressure thresholds
- **Chain Integrity Failures**: Count of hash verification failures (should be 0)
- **Commit Latency Heatmap**: Distribution of synchronous commit latencies (target < 1ms)

### Circuit Breakers
- **State Timeline**: Per-provider state history (CLOSED/HALF-OPEN/OPEN)
- **Failure Rates**: Percentage failure rate per provider
- **Trip & Recovery Events**: Circuit breaker open/close events over time
- **Requests Blocked vs Allowed**: Traffic impact of circuit breakers
- **Recovery Time**: Average time from failure to circuit closure
- **Provider Health Summary**: Table with status, latency, and success rate per provider

## Template Variables

The dashboard includes four template variables for filtering:

| Variable      | Label       | Description                                         |
|---------------|-------------|-----------------------------------------------------|
| `DS_PROMETHEUS` | Datasource | Prometheus datasource selector                     |
| `environment` | Environment | Filter by deployment environment (production, staging, etc.) |
| `service`     | Service     | Filter by Vorion service instance (multi-select)   |
| `provider`    | Provider    | Filter by AI provider (anthropic, google, ollama, etc., multi-select) |

## Metric Reference

### Metric Naming Convention

All Vorion metrics use the prefix `vorion_` followed by subsystem and metric name. The SLA tracker uses `ai_gateway_sla_` prefix as defined in its Prometheus export function.

### Key Metrics

| Metric | Type | Source | Description |
|--------|------|--------|-------------|
| `vorion_gateway_requests_total` | counter | AI Gateway | Total gateway requests by provider, route, status |
| `vorion_gateway_request_duration_ms_bucket` | histogram | AI Gateway | Request latency distribution |
| `vorion_gateway_degraded_rate` | gauge | DegradedTracker | Current degraded response percentage |
| `vorion_gateway_fallback_total` | counter | DegradedTracker | Fallback invocations by model and reason |
| `vorion_gateway_tokens_total` | counter | QuotaManager | Token consumption by provider and type |
| `ai_gateway_sla_availability` | gauge | SlaTracker | Provider availability percentage |
| `ai_gateway_sla_latency_p95` | gauge | SlaTracker | 95th percentile latency per provider |
| `ai_gateway_sla_error_rate` | gauge | SlaTracker | Error rate percentage per provider |
| `ai_gateway_sla_breaches_total` | counter | SlaTracker | Total SLA breach count per provider |
| `vorion_trust_score_gauge` | gauge | TrustFacade | Current trust score per agent (0-1000) |
| `vorion_trust_tier_transitions_total` | counter | TrustFacade | Tier transition count by direction |
| `vorion_trust_score_delta_sum` | counter | TrustFacade | Cumulative trust score changes by signal type |
| `vorion_intent_submitted_total` | counter | IntentPipeline | Total intents submitted |
| `vorion_intent_allowed_total` | counter | IntentPipeline | Intents that passed gate + auth |
| `vorion_intent_denied_total` | counter | IntentPipeline | Intents denied by gate or authorization |
| `vorion_intent_escalated_total` | counter | IntentPipeline | Intents requiring human escalation |
| `vorion_intent_processing_duration_ms_bucket` | histogram | IntentPipeline | Intent processing latency |
| `vorion_proof_commits_total` | counter | ProofCommitter | Total proof commitments by event type |
| `vorion_proof_batches_total` | counter | ProofCommitter | Total Merkle tree batches flushed |
| `vorion_proof_buffer_size` | gauge | ProofCommitter | Current proof buffer size |
| `vorion_proof_batch_size` | summary | ProofCommitter | Batch size distribution |
| `vorion_proof_commit_duration_ms_bucket` | histogram | ProofCommitter | Synchronous commit latency |
| `vorion_proof_chain_integrity_failures_total` | counter | ProofCommitter | Hash chain verification failures |
| `vorion_circuit_breaker_state` | gauge | CircuitBreaker | Circuit state (0=closed, 1=half-open, 2=open) |
| `vorion_circuit_breaker_failure_rate` | gauge | CircuitBreaker | Failure rate percentage per provider |
| `vorion_circuit_breaker_trips_total` | counter | CircuitBreaker | Circuit trip (open) events |
| `vorion_circuit_breaker_recoveries_total` | counter | CircuitBreaker | Circuit recovery (close) events |
| `vorion_circuit_breaker_requests_blocked_total` | counter | CircuitBreaker | Requests blocked by open circuits |
| `vorion_circuit_breaker_requests_allowed_total` | counter | CircuitBreaker | Requests allowed through circuits |
| `vorion_provider_health_status` | gauge | HealthChecker | Provider status (0=unhealthy, 1=degraded, 2=healthy) |
| `vorion_provider_health_latency_ms` | gauge | HealthChecker | Provider health check latency |
| `vorion_provider_health_success_rate` | gauge | HealthChecker | Provider success rate percentage |
| `vorion_component_ready` | gauge | CogniGate API | Component readiness (0/1) |

## Alerting Recommendations

Consider adding Grafana alerts for these critical conditions:

1. **SLA breach**: `ai_gateway_sla_availability < 99.9` for 5 minutes
2. **Circuit breaker open**: `vorion_circuit_breaker_state == 2` for more than 2 minutes
3. **High degraded mode**: `vorion_gateway_degraded_rate > 20` for 5 minutes
4. **Intent pipeline denial spike**: rate of `vorion_intent_denied_total` exceeds 50% of submissions
5. **Proof chain integrity failure**: `vorion_proof_chain_integrity_failures_total` increases
6. **Proof buffer backpressure**: `vorion_proof_buffer_size > 500` for 2 minutes
7. **Trust score collapse**: average `vorion_trust_score_gauge` drops below 200
