# Vorion Roadmap

> **Honest status:** 0 external users. 0 production deployments outside our own.
> This roadmap exists so you can decide whether we're worth watching.

## Current: v0.1.1 — Humble First Release (Feb 2026)

**What shipped:**
- `@vorionsys/basis` — Core governance schema + validation
- `@vorionsys/atsf-core` — Trust scoring engine (T0–T7)
- `@vorionsys/car-id` — Agent identity registry
- `@vorionsys/tripwire` — Pre-reasoning safety checks
- `@vorionsys/cognigate-client` — Client SDK for Cognigate runtime
- [Cognigate](https://cognigate.dev) — Live enforcement runtime (Python/FastAPI)
- 15,309 tests across the monorepo
- [BASIS spec v0.1](BASIS.md) — open for feedback

**What's honest:**
- No external contributors yet
- No independent security audit
- No published benchmarks
- Tier boundaries (T0–T7) are arbitrary starting points
- Two maintainers, both self-taught

## v0.2 — Feedback-Driven (Target: Mid-April 2026)

*This milestone depends entirely on community feedback. If nobody cares, we'll keep building anyway — but priorities shift.*

**Planned:**
- [ ] LangChain integration example (working wrapper, not toy)
- [ ] CrewAI integration example
- [ ] AutoGen integration example
- [ ] Published latency benchmarks (p50/p95/p99)
- [ ] Improved TRIPWIRE patterns based on red-team feedback
- [ ] BASIS spec v0.2 incorporating community input
- [ ] First external contributor PR merged

**Stretch (if we get traction):**
- [ ] Hosted playground at cognigate.dev
- [ ] VS Code extension for policy authoring

## v0.3 — Stability & Security (Target: June 2026)

**Planned:**
- [ ] Independent security review (funded or volunteer)
- [ ] Proof plane improvements (pluggable backends)
- [ ] ATSF decay tuning based on real-world usage data
- [ ] CI/CD hardening (mutation testing gates, coverage floors)
- [ ] Documentation overhaul based on user confusion points
- [ ] npm download milestone: 100 weekly (aspirational)

**Stretch:**
- [ ] Decentralized CAR registry prototype
- [ ] ZK-proof extension for proof plane

## v1.0 — Only If Validated (Target: Q4 2026, maybe later)

We will only ship v1.0 if:
1. At least 3 independent teams have used Vorion in production
2. An external security review has been completed
3. BASIS spec has been through at least 2 revision cycles with community input
4. Trust tier boundaries have been validated against real agent behavior data

**v1.0 would include:**
- Stable API (semver guarantees)
- Production deployment guides
- Compliance documentation (EU AI Act, ISO 42001)
- Published benchmarks
- Multi-framework integration library

If these conditions aren't met by Q4 2026, we push v1.0 to 2027. No rush.

## How to Influence This Roadmap

- **Open an issue** — tell us what's missing or wrong
- **Try the SDK** — `npm i @vorionsys/basis` and tell us where you got stuck
- **Hit Cognigate** — `POST https://cognigate.dev/v1/intent` and report bugs
- **Critique BASIS** — read [BASIS.md](BASIS.md) and tell us what's naive

We have no investors, no board, no deadline pressure. We build what the community needs.

## Who Maintains This

**Alex Blanc** ([@brnxfinest](https://github.com/brnxfinest)) — Architecture & product vision
**Ryan Cason** ([@chunkstar](https://github.com/chunkstar)) — Engineering & infrastructure

Former banquet servers who learned to code with AI tools. Full story at [vorion.org/about](https://vorion.org/about).

---

*Last updated: February 2026*
*Stars when this was written: probably still 0*
