# ATSF Wave 1 Adjustment Plan

**Scope:** Wave 1 launch hardening for ATSF in the CARID + BASIS + ATSF + Cognigate release track.

**Owner:** ATSF engineering lead  
**Status:** Draft (execution-ready)  
**Target window:** Week 1 (Foundation Lock)

## Objectives

- Ensure ATSF trust behavior is deterministic, auditable, and launch-safe
- Close high-risk gaps in Phase 6 hardening assets
- Align ATSF messaging and integration surfaces with CARID Mission Control narrative
- Ship with verified CI, coverage, and production-readiness evidence

## Findings from Current Package State

1. **Phase 6 test suite is placeholder-heavy and not fully active in standard test paths**
   - File: [tests/phase6/phase6.test.ts](tests/phase6/phase6.test.ts)
   - Contains many TODO placeholders for the declared 200+ test matrix
2. **Hash helper in Phase 6 types is a placeholder implementation**
   - File: [src/phase6/types.ts](src/phase6/types.ts)
   - `generateHash` currently uses base64 truncation placeholder text
3. **Coverage thresholds are currently minimal for launch-critical trust logic**
   - File: [vitest.config.ts](vitest.config.ts)
   - Thresholds: lines/functions/statements 30, branches 25
4. **Deprecation aliases are present and should be tracked for launch messaging/API clarity**
   - File: [src/phase6/types.ts](src/phase6/types.ts)
   - `ACI_CANONICAL_PRESETS` alias deprecated in favor of `BASIS_CANONICAL_PRESETS`

## Wave 1 Must-Do Adjustments

## A1. Activate and normalize Phase 6 test execution

- Move or include `tests/**/*.test.ts` in Vitest include configuration
- Fix/import-align Phase 6 tests so they can run in CI
- Convert placeholder TODO blocks into tracked test cases (start with ceiling, role gate, and integration paths)

**Done when:** Phase 6 tests are actively executed by `npm run test` and `npm run test:coverage`.

## A2. Replace placeholder hash generation with cryptographic SHA-256

- Update `generateHash` in `src/phase6/types.ts` to use Node `crypto` SHA-256
- Add deterministic unit tests for hash format and stability
- Ensure no behavioral regressions in existing consumers

**Done when:** No placeholder hashing remains in launch path.

## A3. Raise launch-critical coverage floor for ATSF trust paths

- Increase thresholds for Phase 6/trust-engine related code (target incremental, not big-bang)
- Add tests for role gates, context ceilings, score clamping, and preset integrity
- Keep package-wide thresholds realistic while requiring stronger coverage for critical files

**Done when:** Critical trust files meet agreed higher threshold and CI enforces it.

## A4. Finalize API and deprecation policy for Wave 1

- Explicitly document supported public exports for Wave 1 (`trust-engine`, `basis`, `cognigate`, `phase6` usage)
- Mark deprecated aliases with migration guidance and removal timeline
- Ensure README examples match production-recommended APIs

**Done when:** ATSF README and changelog communicate a stable Wave 1 API surface.

## A5. Integration validation with BASIS and Cognigate

- Validate ATSF + BASIS evaluator interaction in one integration test path
- Validate ATSF trust outputs are consumable by Cognigate enforcement path
- Add launch smoke assertions for trust decision auditability

**Done when:** One e2e launch smoke path covers CARID identity context -> ATSF trust -> Cognigate decision.

## Suggested Execution Order (Recommended)

1. A2 cryptographic hash replacement
2. A1 Phase 6 test activation
3. A3 coverage uplift for critical trust paths
4. A4 API/deprecation documentation pass
5. A5 integration smoke validation

## Launch Exit Checklist (ATSF)

- [ ] No placeholder cryptographic helpers in launch path
- [ ] Phase 6 tests active and green in CI
- [ ] Critical trust logic coverage targets met
- [ ] README/API docs aligned with Wave 1 scope
- [ ] BASIS + Cognigate integration smoke checks passing

## Next Steps (Immediate)

1. Assign owners for A1-A5
2. Implement A2 in first pass (small, high-value, low-risk)
3. Activate Phase 6 tests with minimal CI-safe subset
4. Re-run ATSF package tests and coverage; capture baseline
5. Promote ATSF checklist status into top-level launch tracker
