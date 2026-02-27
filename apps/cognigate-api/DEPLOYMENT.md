# cognigate-api — Deployment & Regional Architecture

## Current State (Wave 1)

Single-region deployment on Fly.io (`iad` — Ashburn, US East).

```
Consumer → HTTPS → cognigate-api (iad) → SQLite (local volume)
```

**Baseline measured latency (same-region consumer):**
- Trust read (`GET /api/v1/trust/:agentId`): ~2–5ms
- Trust signal (`POST /api/v1/trust/:agentId/signal`) + autoPersist SQLite write: ~5–15ms
- Governance evaluate: ~5–20ms

---

## Latency Budget by Deployment Pattern

| Pattern | Network RTT | Compute | Persistence | **Total p50** | **Total p95** |
|---------|-------------|---------|-------------|--------------|--------------|
| Consumer co-located in `iad` | ~1ms | ~2ms | ~5ms (SQLite local) | **~8ms** | **~20ms** |
| US West consumer → `iad` | ~60ms | ~2ms | ~5ms | **~67ms** | **~85ms** |
| EU consumer → `iad` | ~90ms | ~2ms | ~5ms | **~97ms** | **~120ms** |
| APAC consumer → `iad` | ~170ms | ~2ms | ~5ms | **~175ms** | **~200ms** |

> **Target SLO:** Core trust + governance decisions under **100ms p95** for co-located consumers.
> Cross-region consumers **will exceed 100ms** until regional replicas are activated.

---

## When to Add a Region

Spin up a regional replica when:
- A consumer account has **>500 trust evaluations/day** in a region more than 60ms RTT from `iad`
- A customer SLA requires **<50ms p95**
- A geography has **regulatory data residency requirements** (EU/APAC)

Current rule of thumb: **one region per major consumer cluster.**

---

## Fly.io Multi-Region Setup

### Step 1 — Add replica regions

```bash
# Scale up machines in additional regions
fly scale count 2 --region lhr   # London — EU consumers
fly scale count 2 --region nrt   # Tokyo — APAC consumers
fly scale count 2 --region sjc   # San Jose — US West consumers
```

### Step 2 — Persistence strategy (SQLite → Fly Postgres)

**SQLite on a mounted volume is single-region only.** Before adding replicas:

1. Provision a Fly Postgres cluster with read replicas:
   ```bash
   fly postgres create --name cognigate-db --region iad --initial-cluster-size 2
   fly postgres attach cognigate-db --app cognigate-api
   ```

2. Add read replica in each active region:
   ```bash
   fly postgres create --name cognigate-db-lhr --region lhr --fork-from cognigate-db
   ```

3. Update `fly.toml` env:
   ```toml
   [env]
     NODE_ENV = "production"
     PORT = "3000"
     # Remove SQLITE_PATH — set DATABASE_URL via fly secrets
   ```

4. Set the secret:
   ```bash
   fly secrets set DATABASE_URL="postgres://..." --app cognigate-api
   ```

### Step 3 — Consumer SDK routing

Each regional instance gets its own URL. Direct large consumers to their nearest region:

```typescript
// US consumers (default)
const cognigate = new Cognigate({
  apiKey: 'your-key',
  region: 'iad',
  // baseUrl defaults to https://cognigate.dev/v1 → resolves to iad
});

// EU consumers — explicit regional endpoint
const cognigate = new Cognigate({
  apiKey: 'your-key',
  region: 'lhr',
  baseUrl: 'https://eu.cognigate.dev/v1',
});

// APAC consumers
const cognigate = new Cognigate({
  apiKey: 'your-key',
  region: 'nrt',
  baseUrl: 'https://apac.cognigate.dev/v1',
});
```

The SDK forwards `X-Cognigate-Region` on every request — use this in your observability dashboards to track per-region latency distributions.

---

## fly.toml Reference — Multi-Region

See `fly.toml` in this directory. The replica region block is commented out; uncomment and run `fly deploy` to activate new regions after completing the Postgres migration above.

---

## Railway Deployment Notes

Railway does not currently support multi-region read replicas for a single service. For Railway:
- Single-region is the default — pin to `us-west2` or `europe-west4` based on primary consumer geography
- For multi-region, use Fly.io as the primary platform at scale; Railway is suitable for staging and single-region production

---

## Persistence Latency Notes

The `autoPersistRecord` call in ATSF trust-engine is **synchronously awaited in the trust decision path**. This means persistence RTT directly adds to every trust mutation response time.

| Persistence backend | RTT (same host) | RTT (same region) | RTT (cross-region) |
|---------------------|-----------------|-------------------|--------------------|
| SQLite (local volume) | <1ms | N/A | N/A |
| Fly Postgres (same region) | ~2–5ms | ~5–10ms | ~50–120ms |
| Redis (Upstash, same region) | ~1–3ms | ~3–8ms | ~40–100ms |

**Recommendation:** Keep persistence co-located with the cognigate-api instance in every region. Never cross a region boundary for a synchronous trust write in the hot path.

If latency must be minimized below 5ms (e.g. inline agent request gating), consider moving persistence to a **fire-and-forget** write with immediate in-memory response. Raise a tech debt ticket before doing this — it trades durability for speed and requires careful failure handling.

---

## Observability Checkpoints

Before activating a new region, confirm:

- [ ] `X-Cognigate-Region` header visible in your APM tool per region
- [ ] p50/p95 latency dashboards segmented by region
- [ ] Postgres replication lag monitored and alerted (threshold: >500ms)
- [ ] `/health/ready` check passes in every active region before traffic ramp
- [ ] Rollback command tested per region (`fly scale count 0 --region <region>`)

---

## DNS / Routing Strategy (Future)

For Wave 2+, consider Anycast / GeoDNS routing:

```
cognigate.dev/v1        → routes to nearest healthy region automatically
us.cognigate.dev/v1     → pinned to iad
eu.cognigate.dev/v1     → pinned to lhr
apac.cognigate.dev/v1   → pinned to nrt
```

Cloudflare Workers or Fly.io's built-in anycast can handle this without extra infrastructure.

---

*Last updated: Wave 1 Foundation Lock — February 2026*
*Owner: Infrastructure / SRE Lead*
*Next review: Wave 2 Staging Dress Rehearsal*
