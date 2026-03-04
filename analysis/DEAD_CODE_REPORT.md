# Dead Code Analysis Report

**Generated:** 2026-02-04
**Tool:** ts-prune v0.10.3
**Scope:** packages/platform-core/src

## Executive Summary

ts-prune analysis identified **4,885 exports** that may be unused or only used internally. After categorization, the findings break down as:

| Category                            | Count  | Recommendation             |
| ----------------------------------- | ------ | -------------------------- |
| Barrel Re-exports (False Positives) | ~1,500 | Ignore - Public API        |
| Internal-Only Exports               | 1,077  | Review for visibility      |
| Cross-Package Contracts             | 190    | Ignore - Used by consumers |
| Potential Dead Code                 | ~2,000 | Investigate and clean up   |

## High-Level Module Breakdown

| Module               | Unused Exports | Notes                            |
| -------------------- | -------------- | -------------------------------- |
| security/            | 1,686          | Largest module - many submodules |
| index.ts (barrel)    | 1,142          | Re-exports for package API       |
| common/              | 728            | Utility functions and types      |
| intent/              | 384            | Core intent processing           |
| api/                 | 184            | API middleware and routes        |
| audit/               | 159            | Audit logging infrastructure     |
| car-extensions/      | 151            | CAR extension system             |
| semantic-governance/ | 140            | Semantic governance layer        |
| policy/              | 97             | Policy evaluation engine         |
| enforce/             | 13             | Enforcement layer                |
| db/                  | 10             | Database utilities               |
| trust-engine/        | 2              | Trust calculation engine         |

## Detailed Findings by Module

### 1. Security Module (1,686 exports)

The security module has the highest count, broken down by submodule:

| Submodule      | Count | Status                                  |
| -------------- | ----- | --------------------------------------- |
| trust-oracle/  | 182   | Potentially unused - verify integration |
| zkp/           | 99    | ZK proofs - may be future feature       |
| encryption/    | 97    | Encryption utilities                    |
| policy-engine/ | 93    | Security policies                       |
| incident/      | 82    | Incident response                       |
| pam/           | 77    | Privileged access management            |
| siem/          | 74    | SIEM integration                        |
| hsm/           | 64    | HSM integration                         |
| crypto/        | 62    | Cryptographic utilities                 |
| ai-governance/ | 58    | AI governance framework                 |
| anomaly/       | 48    | Anomaly detection                       |
| webauthn/      | 36    | WebAuthn/FIDO2 support                  |
| kms/           | 22    | Key management                          |
| api-keys/      | 18    | API key management                      |
| threat-intel/  | 17    | Threat intelligence                     |
| mfa/           | 15    | Multi-factor authentication             |

**Recommendation:** Many security submodules appear to be feature-complete implementations that may not yet be fully integrated. Review:

- `trust-oracle/` - Comprehensive trust assessment system, may need integration
- `zkp/` - Zero-knowledge proof system, likely future feature
- `incident/` - Incident response system
- `pam/` - Privileged access management

### 2. Common Module (728 exports)

| Submodule              | Count | Notes                     |
| ---------------------- | ----- | ------------------------- |
| index.ts               | 224   | Re-exports                |
| telemetry/             | 130   | OpenTelemetry integration |
| canonical-bridge.ts    | 90    | Type bridging utilities   |
| contracts/             | 14    | Contract types            |
| redis-resilience.ts    | 14    | Redis circuit breaker     |
| database-resilience.ts | 9     | Database circuit breaker  |
| trust-cache.ts         | 9     | Trust score caching       |

**Notable patterns:**

- Many telemetry exports are comprehensive OpenTelemetry integrations
- Resilience utilities (circuit breakers) have extensive APIs

### 3. Intent Module (384 exports)

| File       | Count | Notes                   |
| ---------- | ----- | ----------------------- |
| schema.ts  | 34    | Database schema types   |
| webhooks/  | 24    | Webhook delivery system |
| tracing.ts | 15    | Intent tracing          |
| metrics.ts | 10    | Prometheus metrics      |
| queues.ts  | 8     | Queue management        |

**Recommendation:** Review schema.ts exports - many database row types may be over-exported.

### 4. API Module (184 exports)

Most API exports are middleware and plugins intended for Fastify integration:

| Category         | Examples                                                  |
| ---------------- | --------------------------------------------------------- |
| Rate Limiting    | `rateLimit`, `rateLimitPerTenant`, `redisRateLimitPlugin` |
| Security Headers | `securityHeaders`, `securityHeadersMiddleware`            |
| Validation       | `validateBody`, `validateQuery`, `validateParams`         |
| Authentication   | `apiKeyMiddleware`, `dpopMiddleware`                      |

**Status:** Likely false positives - these are registration functions for Fastify plugins.

### 5. Audit Module (159 exports)

| Submodule       | Count | Notes                                   |
| --------------- | ----- | --------------------------------------- |
| index.ts        | 88    | Audit system core                       |
| siem/           | 31    | SIEM connectors (Loki, Splunk, Elastic) |
| event-schema.ts | 40    | Event definitions                       |

**Notable:** SIEM connectors are complete implementations for Loki, Splunk, and Elasticsearch.

### 6. CAR Extensions Module (151 exports)

The CAR (Certified Agent Runtime) extension system provides:

- Extension registry and executor
- Built-in extensions (cognigate, monitoring, audit)
- Extension service configuration

**Status:** This appears to be a complete extension framework. Verify if extensions are registered at runtime.

### 7. Semantic Governance Module (140 exports)

Complete semantic governance system including:

- Instruction validation
- Output binding and filtering
- Inference scope control
- Context authentication
- Dual-channel enforcement

**Status:** Comprehensive AI governance framework. Verify integration points.

## False Positives to Ignore

### 1. Package Barrel Exports (index.ts)

Exports from `src/index.ts` at lines 31-1200+ are intentional public API re-exports. These should be ignored as they are consumed by external packages.

### 2. Cross-Package Contract Types

Exports from `packages/contracts/dist/index.d.ts` (190 entries) are shared type definitions consumed by other packages in the monorepo.

### 3. Database Schema Types

Exports ending in `Row`, `NewRow` patterns in schema files are Drizzle ORM type exports for database operations.

### 4. Zod Schema Exports

Exports ending in `Schema` (e.g., `intentPayloadSchema`, `trustTierSchema`) are Zod validation schemas used at runtime.

### 5. Factory Functions and Singletons

Functions like `get*`, `create*`, `reset*` are factory/singleton patterns common in the codebase.

## Recommendations for Cleanup

### High Priority (Clear Dead Code)

1. **Review `security/zkp/`** - Zero-knowledge proof implementation. If not planned for near-term use, consider:
   - Moving to a separate experimental package
   - Adding explicit "experimental" documentation

2. **Review `security/trust-oracle/`** - Complete trust oracle system. Verify if:
   - Integration is complete
   - This is a planned future feature

3. **Review `security/incident/`** - Incident response system. Check integration status.

### Medium Priority (Potential Optimization)

1. **Reduce Schema Type Exports** - Many database row types in `intent/schema.ts` could be kept internal.

2. **Consolidate Telemetry Exports** - `common/telemetry/` has 130 exports. Consider grouping into namespace objects.

3. **Review Security Submodule Integration** - Several security submodules appear complete but may lack integration:
   - `pam/` - Privileged access management
   - `hsm/` - Hardware security module integration
   - `threat-intel/` - Threat intelligence

### Low Priority (Code Style)

1. **Internal Exports** - 1,077 exports marked "(used in module)" could potentially be made non-exported if only used within their file.

2. **Constants** - Many exported constants like `DEFAULT_*` and `*_CONFIG` could be consolidated.

## Metrics Summary

```
Total Exports Analyzed:     4,885
Barrel Re-exports:          ~1,500 (ignore)
Internal-Only:              1,077 (review)
Cross-Package Contracts:    190 (ignore)
True Dead Code Candidates:  ~2,000 (investigate)
```

## Action Items

1. [ ] Review security submodules for integration status
2. [ ] Audit trust-oracle module usage
3. [ ] Consolidate schema type exports
4. [ ] Document intentionally unused exports (future features)
5. [ ] Consider moving experimental features to separate packages

---

_This report was generated using ts-prune. Some false positives are expected due to:_

- _Barrel exports for package API_
- _Runtime dynamic imports_
- _Test utility exports_
- _Framework plugin patterns_
