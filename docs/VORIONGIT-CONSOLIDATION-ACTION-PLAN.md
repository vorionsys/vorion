# Voriongit Consolidation & CAR Integration Action Plan
**Date**: January 25, 2026  
**Status**: Ready for execution  
**Priority**: CRITICAL - Ship CAR Spec + Merge Alex's work

---

## Executive Summary

**Current State**:
- **master branch**: Stable, production-ready core (242+ tests passing)
- **feature/aci-integration**: Alex's complete CAR integration (3 major commits, Jan 25)
  - SPEC-003: CAR-Vorion Unified Trust Architecture
  - 10 new modules (CAR types, semantic governance, security hardening, extensions)
  - Breaking change: CAR format no longer includes trust tier (-T removed)
  - Trust computed at runtime from attestations + behaviors + context
- **27 feature branches**: Various experimental work from Alex and Claude
- **Cognigate, Kaizen**: Separate repos needing coordination

**The Problem**: 
Alex's feature/aci-integration branch has critical improvements but isn't merged to master. Need to consolidate his work + ship CAR spec + clean up branches.

**The Solution**:
1. Merge feature/aci-integration to master (CAR integration live)
2. Create new repo: voriongit/car-spec (publish standard)
3. Clean up 27 feature branches (archive, don't delete)
4. Coordinate across cognigate + kaizen repos
5. Update all repo READMEs with ecosystem positioning

---

## Vorion Repository Status

### vorion (Main Repository)
**Branches**: 27 total (10 Alex-, 6 claude/, 5 dependabot/, 6 others)

**Critical Branch: feature/aci-integration** ⭐
```
Latest commits (Jan 25, 2026):
├─ 0c3e20365 fix(aci): remove trust tier from CAR identifier (BREAKING)
├─ 8f89713578 docs: add CAR spec v1.1.0 reference bundle
├─ 776ff9ecc8 feat(aci): implement complete CAR-Vorion unified trust architecture
└─ b50e7f981 feat: Phase B+C — output contracts and execution pipeline
```

**What's in feature/aci-integration**:
- ✅ SPEC-003: CAR-Vorion Unified Trust Architecture (comprehensive)
- ✅ 10 new CAR modules in packages/contracts/src/aci/
- ✅ 9 semantic governance modules in src/semantic-governance/
- ✅ 10 security hardening modules in src/security/
- ✅ 9 extension protocol modules in src/aci-extensions/
- ✅ 3 trust engine updates in src/trust-engine/
- ✅ Breaking change documented: -T tier removed from CAR format
- ✅ Runtime trust computation model fully specified

**Status**: 🔴 NOT MERGED TO MASTER

**Master Branch Status** (current):
- Last commit: a7c463870 (Jan 23) - "chore: fixes across packages"
- MISSING: All CAR integration work
- PROBLEM: master is 2 days behind feature/aci-integration

---

### cognigate (Python Runtime)
**Branches**: 3 total
- main (primary)
- Alex-CognigateV1
- claude/review-and-merge-master-rD2bi

**Status**: Separate from master integration work  
**Action**: Needs CAR spec reference in docs/

---

### kaizen (Knowledge Base)
**Branches**: 1 only (master)
**Status**: Stable, no pending work  
**Action**: Update README to link to CAR spec

---

## Action Plan: 4-Phase Delivery

### PHASE 1: Immediate (Today - Jan 25)
**Goal**: Merge Alex's work + publish CAR spec

**1.1 Merge feature/aci-integration to master**
```bash
cd vorion
git checkout master
git pull origin master
git merge --no-ff feature/aci-integration
git push origin master
```

**Validation**:
- [ ] All tests pass (expecting 1300+)
- [ ] No conflicts
- [ ] CI/CD completes successfully
- [ ] CAR types available in contracts package

**1.2 Create voriongit/car-spec repository**
```bash
# On GitHub.com:
1. Create new repo: voriongit/car-spec
2. Set description: "Categorical Agentic Registry (CAR) - The certification standard for AI agents"
3. Add README (use bundle README.md)
4. Add Apache 2.0 license
```

**1.3 Push CAR spec bundle to GitHub**
```bash
cd c:\Users\racas\Downloads\agentAIID\car-spec-v1.1.0\aci-bundle
git init
git add .
git commit -m "Initial commit: CAR specification v1.0.0"
git remote add origin https://github.com/voriongit/car-spec.git
git branch -M main
git push -u origin main
git tag v1.0.0
git push origin v1.0.0
```

**Result**: CAR spec published to GitHub

---

### PHASE 2: Branch Cleanup (Tomorrow - Jan 26)
**Goal**: Organize 27 feature branches

**Status of branches**:

| Branch | Author | Status | Action |
|--------|--------|--------|--------|
| Alex-CognigateV1 | Alex | Experimental | Archive |
| Alex-Foundation-Fixes | Alex | Improvements | Review+Merge or Archive |
| Alex-Intent | Alex | Old (Intent) | Covered by feature/aci-integration |
| Alex-Intent.2 | Alex | Merged | Delete (already in master) |
| Alex-Intent-4 | Alex | Variant | Archive |
| Alex-ProofV1 | Alex | Experimental | Review |
| Alex-Trust-6Tier | Alex | Experimental | Archive |
| Alex-enforce-1 | Alex | Experimental | Archive |
| Alex-intent-3 | Alex | Variant | Archive |
| claude/* (6 branches) | Claude | Code review PRs | Archive/Delete |
| dependabot/* (5 branches) | Dependabot | Auto-update | Delete (can regenerate) |
| cleanup/marketplace-removal | Claude | Cleanup | Merged or Delete |
| feature/aci-integration | Alex | **PRIMARY** | ✅ MERGED to master |
| fix/intent-enterprise-hardening-tests | Claude | Fixes | Review |

**2.1 Create archive branch for preserved history**
```bash
git checkout -b archive/pre-consolidation-jan25
git push origin archive/pre-consolidation-jan25
```

**2.2 Delete safe-to-delete branches**
```bash
# Auto-generated branches (can regenerate)
git push origin --delete dependabot/*

# Claude code-review branches (PRs captured in commit history)
git push origin --delete claude/aci-discovery-routing-TcuYo
git push origin --delete claude/code-review-ERpLS
git push origin --delete claude/fix-risklevel-type-AiXXM
git push origin --delete claude/push-acdr-new-repo-mgr7o
git push origin --delete claude/review-iterate-code-Hq5HK
git push origin --delete claude/review-master-pr-GaMRG

# Old marketplace cleanup (already merged)
git push origin --delete cleanup/marketplace-removal
```

**2.3 Evaluate remaining branches**
```
Evaluate & decide:
- Alex-Foundation-Fixes: Does it improve master? 
  - If YES → Create PR, merge if tests pass
  - If NO → Archive for reference
  
- Alex-ProofV1: Is this newer than master?
  - If YES → Merge
  - If NO → Archive
  
- fix/intent-enterprise-hardening-tests: Critical fixes?
  - If YES → Merge
  - If NO → Archive
```

**Result**: Clean branch list, preservation of useful history

---

### PHASE 3: Ecosystem Coordination (Jan 26-27)
**Goal**: Link all repos together

**3.1 Update vorion/README.md**
Add new "CAR Integration" section:
```markdown
## CAR Integration (New!)

Vorion now implements the complete CAR (Categorical Agentic Registry) standard:

- **[CAR Specification](https://github.com/voriongit/car-spec)** - Industry standard
- **[SPEC-003](docs/spec/spec-003-aci-vorion-unified-trust.md)** - Our integration
- **Packages**: `@vorion/aci` in `packages/contracts/src/aci/`
- **Trust Model**: Certification × Competence × Runtime (three-axis)

### CAR Format (v1.0.0)
```
a3i.acme-corp.bot:ABF-L3@1.0.0
├─ Registry: a3i (AgentAnchor International)
├─ Organization: acme-corp
├─ Class: bot
├─ Domains: ABF (Authority, Behavior, Finance)
└─ Level: L3 (Constrained execution)

NOTE: Trust tier (T0-T5) is computed at runtime, not embedded in identifier.
```

### Semantic Governance (Layer 5)
Defends against confused deputy + prompt injection:
- Instruction integrity validation
- Output schema binding
- Inference scope enforcement
- Dual-channel context authentication

See: [src/semantic-governance/](src/semantic-governance/)
```

**3.2 Update cognigate/README.md**
Add reference to CAR:
```markdown
## CAR Compliance

This runtime engine implements CAR (Categorical Agentic Registry) 
specification for agent certification and trust scoring.

See: https://github.com/voriongit/car-spec
```

**3.3 Update kaizen/README.md**
```markdown
## Knowledge Base for CAR-Governed Agents

Kaizen provides semantic knowledge infrastructure for CAR-certified agents.
Integrates with Vorion trust engine and BASIS governance framework.

See: https://github.com/voriongit/car-spec
```

**3.4 Create docs/ECOSYSTEM.md in vorion**
```markdown
# Vorion Ecosystem

## Core Projects
- **[car-spec](https://github.com/voriongit/car-spec)** - Industry standard
- **[vorion](https://github.com/voriongit/vorion)** - Trust engine (this repo)
- **[cognigate](https://github.com/voriongit/cognigate)** - Runtime execution
- **[kaizen](https://github.com/voriongit/kaizen)** - Knowledge base
- **[vorion-www](https://github.com/voriongit/vorion-www)** - Marketing website

## Integration Points
- vorion ← links to → car-spec
- cognigate ← implements → CAR
- kaizen ← provides knowledge for → agents
- vorion-www ← documents → ecosystem
```

**Result**: Cross-linked ecosystem, clear positioning

---

### PHASE 4: Documentation & Release (Jan 27-28)
**Goal**: Ship everything public-facing

**4.1 Create Release Notes**
In [voriongit/car-spec](voriongit/car-spec):
```markdown
# CAR v1.0.0 Release Notes

## What's New
- Complete Categorical Agentic Registry specification
- 7 core specifications (core, extensions, security hardening, semantic governance, DIDs, OpenID, registry)
- 3 guidance documents (OWASP, framework analysis, security audit)
- TypeScript reference implementation
- JSON-LD vocabulary for semantic web

## Integration Status
- ✅ Integrated into Vorion (SPEC-003: CAR-Vorion Unified Trust)
- ✅ Implemented in cognigate runtime
- ✅ Ready for OpenID Foundation submission
- ✅ Ready for W3C AI Agent Protocol group

## Key Changes from Pre-Release
- Trust tier (T0-T5) moved from identifier to runtime computation
- Added semantic governance (Layer 5) for confused deputy defense
- Dual system: CAR certification + Vorion runtime trust
- Three-axis model: Certification × Competence × Runtime

## Breaking Changes
- CAR format: `a3i.org.bot:ABF-L3-T2@1.0.0` → `a3i.org.bot:ABF-L3@1.0.0`
- Trust now computed via attestations + behaviors + context
- Implementers must update parsers
```

**4.2 Create GitHub Release**
```
Tag: v1.0.0
Title: "CAR Specification v1.0.0 - Complete & Production-Ready"
Body: [Release notes above]
Assets: None (all in repo)
```

**4.3 Announce**
Create announcement document at c:\Axiom\docs\CAR-LAUNCH-ANNOUNCEMENT.md

**Result**: Public release, ready for community

---

## Detailed Merge Instructions

### Safe Merge of feature/aci-integration

**Pre-merge checklist**:
```bash
cd vorion

# 1. Ensure master is up to date
git checkout master
git pull origin master

# 2. Check feature branch status
git checkout feature/aci-integration
git pull origin feature/aci-integration

# 3. Run tests locally
npm install
npm run test
# Expected: 1300+ tests passing

# 4. Check for conflicts
git checkout master
git merge --no-commit --no-ff feature/aci-integration
# If conflicts: resolve, then continue
```

**Execute merge**:
```bash
git merge --no-ff feature/aci-integration -m "feat: merge complete CAR integration (SPEC-003)

Merges feature/aci-integration branch containing:
- SPEC-003: CAR-Vorion Unified Trust Architecture
- 10 CAR type modules (aci-string, domains, levels, tiers, etc)
- 9 semantic governance modules (Layer 5 security)
- 10 security hardening modules (DPoP, TEE, pairwise DIDs)
- 9 CAR extension protocol modules (Layer 4)
- 3 trust engine updates for runtime integration

BREAKING CHANGE: CAR format no longer includes trust tier.
- OLD: a3i.acme-corp.bot:ABF-L3-T2@1.0.0
- NEW: a3i.acme-corp.bot:ABF-L3@1.0.0
Trust is now computed at runtime from attestations + behaviors + context.

Fixes: Unified CAR-Vorion nomenclature collision
Closes: All CAR integration work items
Co-authored-by: Alex <brnxfinest@github> (feature/aci-integration)"

git push origin master
```

---

## Files Modified by This Plan

### New Files Created
- [ ] voriongit/car-spec (new repository)
- [ ] vorion/docs/ECOSYSTEM.md
- [ ] c:\Axiom\docs\CAR-LAUNCH-ANNOUNCEMENT.md

### Modified Files
- [ ] vorion/README.md (add CAR section)
- [ ] cognigate/README.md (add CAR link)
- [ ] kaizen/README.md (add CAR link)

### Branches Affected
- [ ] master ← feature/aci-integration (MERGE)
- [ ] feature/aci-integration (preserve as historical)
- [ ] 6 dependabot/* (DELETE)
- [ ] 6 claude/* (DELETE or ARCHIVE)
- [ ] 8 Alex-* (evaluate individually)

---

## Timeline

| Phase | Target | Duration | Owner |
|-------|--------|----------|-------|
| **Phase 1**: Merge + Publish | Jan 25 (TODAY) | 2 hours | You |
| **Phase 2**: Cleanup | Jan 26 | 1 hour | You |
| **Phase 3**: Coordination | Jan 26-27 | 2 hours | You |
| **Phase 4**: Release | Jan 27-28 | 1 hour | You |

**Total**: ~6 hours to complete full consolidation

---

## Success Criteria

✅ **Phase 1 Complete When**:
- master branch has all CAR commits from feature/aci-integration
- voriongit/car-spec repo exists with v1.0.0 tag
- 1300+ tests passing on master
- No merge conflicts

✅ **Phase 2 Complete When**:
- All safe branches deleted
- 27 branches → ~15 branches (mostly archived)
- history preserved in archive/pre-consolidation-jan25

✅ **Phase 3 Complete When**:
- All 4 repo READMEs updated with CAR references
- ecosystem/ECOSYSTEM.md created
- Cross-links validated

✅ **Phase 4 Complete When**:
- GitHub release published for v1.0.0
- Announcement document created
- Ready for OpenID/W3C submissions

---

## Risk Mitigation

**Risk**: Merge conflicts in feature/aci-integration
- **Mitigation**: Pre-test merge locally, create detailed conflict resolution plan
- **Fallback**: Merge with --no-ff to preserve commit history

**Risk**: Breaking change (-T removal) breaks downstream code
- **Mitigation**: SPEC-003 documents migration path, parse legacy format support
- **Fallback**: Release as v1.1.0 minor version instead of v1.0.0 hard break

**Risk**: Tests fail after merge
- **Mitigation**: Run full test suite before push
- **Fallback**: Revert merge, debug on feature branch, retry

**Risk**: Branch cleanup removes important experimental work
- **Mitigation**: Create archive/pre-consolidation-jan25 branch first
- **Fallback**: Branches never truly deleted from GitHub (can undelete)

---

## Post-Merge Actions

Once everything ships:

1. **Notify teams**:
   - Alex: CAR work merged ✓
   - Chunkstar: voriongit/car-spec ready
   - BanquetAI: trustbot updated

2. **Next submissions** (Week of Jan 27):
   - OpenID Foundation: CAR spec adoption
   - W3C AI Agent Protocol group: SPEC-003 presentation
   - NIST: Update cyber AI RMF mapping with CAR

3. **Marketing** (Week of Feb 3):
   - Blog post: "CAR Goes Live"
   - Twitter/LinkedIn: Ecosystem positioning
   - Press kit: Available for coverage

---

**Next Step**: Execute Phase 1 now. Merge feature/aci-integration to master.

Ready?
