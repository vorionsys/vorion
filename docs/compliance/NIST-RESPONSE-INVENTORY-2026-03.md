# NIST Response Inventory (Consolidation Baseline)

**Prepared:** 2026-03-06  
**Last Synced:** 2026-03-06  
**Purpose:** Dedupe and consolidate all NIST response artifacts across `vorion-public`, `vorion`, and supporting evidence in `cognigate`.

## Scope Included

- Official response/submission documents (RFI, public comments, listening session submissions)
- OSCAL/SSP assessment artifacts used in response packages
- Evidence-model support artifacts in `cognigate` used to substantiate response claims

## Scope Excluded

- General NIST mentions in architecture docs, roadmaps, launch copy, and marketing content
- Generated/test sandbox content (`.stryker-tmp`, archive snapshots)

---

## Canonical Artifact Inventory (Case-by-Case)

| Artifact | Category | Current Status | Recommended Canonical | Mirror / Related | Mirror Match | Decision Basis |
|---|---|---|---|---|---|---|
| `nist-caisi-rfi-response-2026-02.md` | Submission doc | Submission-ready | `vorion/docs/nist-caisi-rfi-response-2026-02.md` | `vorion-public/docs/nist-caisi-rfi-response-2026-02.md` | **Identical** | Synced from canonical (`vorion`) and hash-verified on 2026-03-06. |
| `nist-cyber-ai-profile-comment-2026-01.md` | Submission doc | Submitted/public comment | `vorion/docs/nist-cyber-ai-profile-comment-2026-01.md` | `vorion-public/docs/nist-cyber-ai-profile-comment-2026-01.md` | **Identical** | Synced from canonical (`vorion`) and hash-verified on 2026-03-06. |
| `nist-cyber-ai-profile-comment-2026-01.pdf` | Attachment | Submission attachment | `vorion-public/docs/nist-cyber-ai-profile-comment-2026-01.pdf` | `vorion/docs/nist-cyber-ai-profile-comment-2026-01.pdf` | Not compared in this pass | Use public path for distribution until binary hash verification pass. |
| `nist-rfi-draft.md` | Draft doc | Draft / not submitted | `vorion-public/docs/nist-rfi-draft.md` | `vorion/docs/nist-rfi-draft.md` | **Identical** | Exact hash match; prefer public-safe location for draft review. |
| `CAISI-LISTENING-SESSION-SUBMISSIONS.md` | Submission packet | Submission packet | `vorion-public/docs/CAISI-LISTENING-SESSION-SUBMISSIONS.md` | `vorion/docs/CAISI-LISTENING-SESSION-SUBMISSIONS.md` | **Identical** | Exact hash match; use public doc as canonical packet. |
| `nist-caisi-listening-finance.md` | Submission one-pager | Submission one-pager | `vorion-public/docs/nist-caisi-listening-finance.md` | Referenced by CAISI packet | n/a | Exists only in `vorion-public`. |
| `nist-caisi-listening-healthcare.md` | Submission one-pager | Submission one-pager | `vorion-public/docs/nist-caisi-listening-healthcare.md` | Referenced by CAISI packet | n/a | Exists only in `vorion-public`. |
| `nist-caisi-listening-education.md` | Submission one-pager | Submission one-pager | `vorion-public/docs/nist-caisi-listening-education.md` | Referenced by CAISI packet | n/a | Exists only in `vorion-public`. |
| `caisi-listening-session-interest-2026-04.md` | Submission-interest variant | Submission-interest | `vorion-public/docs/caisi-listening-session-interest-2026-04.md` | Related variants in same folder | n/a | Exists only in `vorion-public`; keep as variant input artifact. |
| `caisi-listening-session-healthcare-2026-04.md` | Submission-interest variant | Submission-interest | `vorion-public/docs/caisi-listening-session-healthcare-2026-04.md` | Related variants in same folder | n/a | Exists only in `vorion-public`; keep as variant input artifact. |
| `caisi-listening-session-education-2026-04.md` | Submission-interest variant | Submission-interest | `vorion-public/docs/caisi-listening-session-education-2026-04.md` | Related variants in same folder | n/a | Exists only in `vorion-public`; keep as variant input artifact. |
| `nccoe-agent-identity-comment-2026-04-02.md` | Submission doc | Submission-ready comment | `vorion-public/docs/nccoe-agent-identity-comment-2026-04-02.md` | none found | n/a | Exists only in `vorion-public`. |
| `compliance/oscal/ssp-draft.json` | OSCAL SSP | Draft | `vorion/compliance/oscal/ssp-draft.json` | `vorion-public/compliance/oscal/ssp-draft.json` | **Identical** | Synced from canonical (`vorion`) and hash-verified on 2026-03-06. |
| `compliance/oscal/assessment-plan.json` | OSCAL assessment plan | Draft/active | `vorion-public/compliance/oscal/assessment-plan.json` | `vorion/compliance/oscal/assessment-plan.json` | **Identical** | Exact hash match; prefer public canonical for package visibility. |
| `compliance/oscal/ssp-summary.md` | Generated summary | Generated from SSP | `vorion/compliance/oscal/ssp-summary.md` | `vorion-public/compliance/oscal/ssp-summary.md` | **Identical** | Synced from canonical (`vorion`) and hash-verified on 2026-03-06. |
| `compliance/oscal/README.md` | OSCAL process doc | Authoritative process doc | `vorion-public/compliance/oscal/README.md` | `vorion/compliance/oscal/README.md` | Not compared in this pass | Treat public as operator-facing reference; re-check parity in sync pass. |
| `docs/evidence-schema.md` (cognigate) | Evidence support | Authoritative support doc | `cognigate/docs/evidence-schema.md` | backed by core modules | n/a | Defines how proof events become control evidence. |
| `app/core/evidence_hook.py` (cognigate) | Evidence support code | Authoritative support code | `cognigate/app/core/evidence_hook.py` | mapper + repository | n/a | Runtime evidence generation entrypoint. |
| `app/core/evidence_mapper.py` (cognigate) | Evidence support code | Authoritative support code | `cognigate/app/core/evidence_mapper.py` | hook + repository | n/a | Framework/control mapping logic used by evidence pipeline. |

---

## Divergence Snapshot (Post-Sync Verification)

- **Diverged:** none in tracked mirror-managed artifacts.
- **Identical:**
  - `nist-caisi-rfi-response-2026-02.md`
  - `nist-cyber-ai-profile-comment-2026-01.md`
  - `nist-rfi-draft.md`
  - `CAISI-LISTENING-SESSION-SUBMISSIONS.md`
  - `compliance/oscal/ssp-draft.json`
  - `compliance/oscal/assessment-plan.json`
  - `compliance/oscal/ssp-summary.md`

---

## Recommended Actions

1. **Finalize canonical ownership decisions in this table as policy** (submission docs may stay split across repos when needed).
2. **Preserve parity with a scheduled or pre-release sync check** across mirror-managed artifacts.
3. **Regenerate `ssp-summary.md` from the canonical `ssp-draft.json` whenever the draft changes**.
4. **Add a lightweight guardrail script/check** that flags NIST-response mirror divergence before release.

## Next Steps

- Execute Phase C hardening in `docs/compliance/NIST-RESPONSE-CONSOLIDATION-PLAN-2026-03.md`.
- Re-run parity verification whenever any canonical artifact is edited.
