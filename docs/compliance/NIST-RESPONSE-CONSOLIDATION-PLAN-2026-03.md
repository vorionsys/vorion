# NIST Response Consolidation Plan

**Date:** 2026-03-06  
**Input Baseline:** `docs/compliance/NIST-RESPONSE-INVENTORY-2026-03.md`

## Goal

Consolidate NIST response artifacts into a single discoverable operating structure while preserving case-by-case canonical ownership between `vorion-public`, `vorion`, and `cognigate` evidence sources.

## Consolidation Model

- Keep **one canonical source per artifact** (defined in inventory table)
- Allow mirrors only where intentional
- Track every mirror pair explicitly with parity checks

## Target Structure (no content loss)

### 1) Canonical Index

- Create/maintain one navigation index at:
  - `vorion-public/docs/compliance/NIST-RESPONSE-INVENTORY-2026-03.md`
- This index is the single entry point for all response documents, OSCAL artifacts, and evidence source links.

### 2) Submission Docs (Primary Bucket)

- Keep all NIST submission/readiness docs under:
  - `vorion-public/docs/`
- Keep mirrored authoritative variants in `vorion/docs/` only when explicitly designated canonical in inventory.

### 3) OSCAL / SSP Artifacts (Assessment Bucket)

- Maintain machine-readable artifacts under `compliance/oscal/` in both repos.
- Treat mirror parity as mandatory for shared artifacts.
- For generated files (e.g., `ssp-summary.md`), regenerate from canonical JSON then sync.

### 4) Evidence Support (Provenance Bucket)

- Keep evidence design + runtime sources in `cognigate`:
  - `cognigate/docs/evidence-schema.md`
  - `cognigate/app/core/evidence_hook.py`
  - `cognigate/app/core/evidence_mapper.py`
- Reference these from NIST response inventory as provenance links, not duplicated docs.

---

## Execution Checklist

## Phase A — Canonical Lock (Immediate)

- [ ] Approve case-by-case canonical assignments listed in inventory.
- [ ] Confirm whether binary attachment canonicals (`.pdf`) require hash-level parity checks.

## Phase B — Mirror Synchronization

- [x] Sync `nist-caisi-rfi-response-2026-02.md` from canonical repo to mirror.
- [x] Sync `nist-cyber-ai-profile-comment-2026-01.md` from canonical repo to mirror.
- [x] Sync OSCAL `ssp-draft.json` from canonical repo to mirror.
- [x] Sync `ssp-summary.md` from canonical repo and validate parity.
- [x] Validate `assessment-plan.json` remains byte-identical in both repos.

## Phase C — Process Hardening

- [ ] Add a parity check script (hash comparison) for mirror-managed NIST artifacts.
- [ ] Run parity check in CI before release-tagging response packages.
- [ ] Add owner metadata (who updates canonical, who syncs mirrors).

---

## Recommended Automation Spec

A minimal script should:

1. Read a manifest list of mirror-managed paths.
2. Compute SHA-256 for canonical + mirror files.
3. Fail if mismatch is found on parity-required artifacts.
4. Emit a simple report: `artifact | canonical hash | mirror hash | status`.

---

## Risks and Controls

- **Risk:** Silent drift between `vorion-public` and `vorion` on submission docs.  
  **Control:** Mandatory parity check + designated canonical owner.

- **Risk:** Generated summaries (`ssp-summary.md`) become stale against JSON source.  
  **Control:** Generate from canonical `ssp-draft.json` in a deterministic step.

- **Risk:** Response packets reference outdated supporting evidence.  
  **Control:** Link to current `cognigate` evidence schema and mapper files in inventory.

---

## Recommended Actions

1. Approve canonical assignments in inventory immediately.
2. Implement Phase C parity automation in CI and local pre-release checks.
3. Add owner metadata before next NIST-facing submission update.

## Next Steps

- Create a short changelog entry documenting this synchronization event and hash-verified parity.
- Implement and run the parity script on every response artifact update.
