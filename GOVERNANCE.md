# Governance

How decisions get made in the Vorion project.

> **Status:** v0.1 — two maintainers, no formal council yet.
> This document will evolve as contributors join. Transparency now beats perfection later.

---

## Maintainers

| Name | GitHub | Role |
|------|--------|------|
| Alex Blanc | [@vorionsys](https://github.com/vorionsys) | Co-founder, spec lead |
| Ryan Cason (Bo Xandar Lee) | [@chunkstar](https://github.com/chunkstar) | Co-founder, engineering lead |

Maintainers have merge authority on all repositories under `vorionsys/`.

---

## Decision-Making

### Day-to-Day (Code, Docs, Tests)

- Any maintainer can merge PRs after CI passes.
- External contributors need one maintainer approval.
- Conventional Commits required (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

### Spec Changes (BASIS, ATSF Tiers, CAR Schema)

Changes to the core specifications require a higher bar because downstream users depend on them.

1. **Proposal** — Open a GitHub Issue using the Feature Request template. Describe the change, motivation, and impact on existing implementations.
2. **Discussion** — Minimum 7-day comment period. Anyone can participate.
3. **Decision** — Both maintainers must approve. If there is disagreement, the discussion period extends until consensus or one maintainer formally defers.
4. **Implementation** — Spec change PR must include:
   - Updated spec document (`docs/BASIS.md` or relevant package README)
   - Migration notes if breaking
   - Updated tests proving the new behavior
5. **Release** — Spec changes ship in a minor version bump (e.g., v0.1 → v0.2) with a CHANGELOG entry.

### Trust Tier Modifications (T0–T7)

The ATSF trust tiers (T0–T7) are explicitly acknowledged as arbitrary starting points. Changes follow the spec change process above, with one addition:

- Any proposal to add, remove, or redefine a tier must include **rationale grounded in observed behavior** — not theoretical arguments alone.
- Community benchmarks or red-team results carry significant weight.

### Security Policy Changes

- Follow the process in [SECURITY.md](.github/SECURITY.md).
- Vulnerability disclosures go to `security@vorion.org`, not public issues.
- Security fixes may bypass the 7-day discussion period at maintainer discretion.

---

## Contributions

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for development setup and PR process.

### What Earns Commit Access

We intend to grant commit access to contributors who demonstrate:

1. Multiple quality PRs merged (code, docs, or tests all count equally).
2. Constructive participation in issue discussions.
3. Respect for the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

There is no fixed threshold. We would rather grant access too early than lose a good contributor to bureaucracy.

---

## Versioning

- **Pre-1.0:** Breaking changes can happen in minor versions. We document them in the CHANGELOG and try to provide migration paths.
- **Post-1.0 (aspirational):** Semantic versioning strictly enforced. Breaking changes only in major versions.
- **v1.0 criteria:** See [ROADMAP](docs/ROADMAP.md) — requires independent security review and at least 3 independent production users.

---

## Licensing

All code is Apache-2.0. All specifications (BASIS, ATSF, CAR) are Apache-2.0.

Contributions are accepted under the same license. By submitting a PR, you agree that your contribution is licensed under Apache-2.0.

---

## Roadmap Authority

The [ROADMAP](docs/ROADMAP.md) reflects current priorities. Community feedback directly influences it:

- Feature requests with multiple thumbs-up get prioritized.
- If a contributor submits a working PR for a roadmap item, it moves to the front of the review queue.
- We will not add items to the roadmap that we cannot realistically deliver or review.

---

## Changing This Document

This governance document follows the same spec change process: open an issue, 7-day discussion, both maintainers approve. The only exception is typo fixes, which any maintainer can merge directly.

---

*Last updated: March 2026*
