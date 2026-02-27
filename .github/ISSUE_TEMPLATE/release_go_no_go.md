---
name: Release Go-No-Go
about: Launch/release gate checklist with required CI sequence
title: 'Release Go/No-Go: '
labels: release, governance
assignees: ''
---

## Release Scope
- Release name/version:
- Target environment:
- Owner:
- Planned release window:

## Required Gate Sequence (in order)
- [ ] `CI / Build, Typecheck & Test` passed
- [ ] `CI / Coverage Gates` passed
- [ ] `PR Check / Lint & Typecheck` passed
- [ ] `PR Check / Circular Dependency Check` passed
- [ ] `Secret Scan / Gitleaks Scan` passed

## Branch Protection Validation
- [ ] PR approval requirement met
- [ ] Branch up-to-date with `main`
- [ ] No force-push or admin bypass used

## Security & Secrets Validation
- [ ] No plaintext secrets in diff
- [ ] Environment variables configured only in secret managers
- [ ] Security-impacting changes reviewed

## Operational Readiness
- [ ] Rollback plan confirmed
- [ ] Owner/on-call confirmed for release window
- [ ] Post-release verification plan documented

## Decision
- [ ] **GO**
- [ ] **NO-GO**

## Notes
Include links to the release PR, dashboards, and any risk exceptions.
