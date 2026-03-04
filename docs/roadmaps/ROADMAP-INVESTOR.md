# Vorion for Investors

> **Read time**: 8 minutes | **Audience**: Investors, Advisors, Board Observers

## Thesis

AI governance is an infrastructure layer, not a feature. Every AI agent deployed in production will need identity, constraints, and audit trails — the same way every web application needed authentication, authorization, and logging. Vorion is building this infrastructure as an open standard with a commercial platform on top.

## Market Context

### The Problem is Quantifiable

- **$4.1T**: Projected AI market by 2030 (Grand View Research)
- **100M+**: Estimated autonomous AI agents in production by 2028
- **0**: Standardized governance frameworks for agent behavior today

### Regulatory Forcing Function

| Regulation | Status | Requirement | Vorion Coverage |
|-----------|--------|-------------|----------------|
| EU AI Act | Enforceable 2026 | Risk classification, transparency, human oversight | Article-by-article mapping complete |
| NIST AI RMF | Published | Govern, Map, Measure, Manage functions | All 4 functions mapped |
| ISO 42001 | Published | AI management system standard | Core clauses addressed |
| Executive Order 14110 | Active | Federal AI safety and security | Audit trail + trust scoring |

Companies that deploy AI agents without governance infrastructure face regulatory risk, reputational risk, and operational risk. Vorion eliminates all three.

## Product Architecture

### Open Core Model

| Layer | License | Revenue |
|-------|---------|---------|
| Standards (BASIS, CAR, ATSF, contracts) | Apache-2.0 | Community adoption, ecosystem lock-in |
| Client SDKs (TypeScript, Python, Go) | Apache-2.0 | Developer onboarding funnel |
| Governance API (Cognigate) | Proprietary | Usage-based pricing |
| Enterprise Portal (AgentAnchor) | Proprietary | Seat-based + usage-based |
| Operations Console (Aurais) | Proprietary | Enterprise add-on |

### Revenue Model

| Tier | Price | Includes |
|------|-------|----------|
| Free | $0 | Open-source packages, 1,000 API calls/month |
| Pro | $99/mo | 100K API calls, 10 agents, basic dashboard |
| Enterprise | Custom | Unlimited, SSO, audit exports, SLA, dedicated support |

### Comparable Companies

| Company | What They Do | Last Valuation | Relevance |
|---------|-------------|----------------|-----------|
| Okta | Identity for humans | $15B (public) | We do identity for AI agents |
| Datadog | Observability for infra | $40B (public) | We do observability for AI governance |
| Snyk | Security for code | $7.4B | We do security for AI behavior |
| HashiCorp | Infrastructure automation | $5.7B (acquired) | We do governance automation |

Vorion sits at the intersection of identity (Okta), observability (Datadog), and security (Snyk) — applied to AI agents instead of humans, infrastructure, or code.

## What's Built

### Current State (Feb 2026)

| Metric | Value |
|--------|-------|
| Packages | 25 (TypeScript, Python, Go) |
| Published npm packages | 3 (v1.0.x) |
| Tests passing | 452+ |
| CI/CD pipelines | 15 |
| Architecture Decision Records | 18 |
| Live production sites | 13 |
| GitHub Actions workflows | 15 |
| Security vulnerabilities (critical/high) | 0 |

### Technology Stack

- **Monorepo**: Turborepo + npm workspaces
- **Backend**: Node.js (TypeScript), Python (FastAPI)
- **Frontend**: Next.js 15/16, Astro
- **Database**: Supabase (PostgreSQL + RLS)
- **Auth**: Supabase Auth (SSO-ready)
- **Deployment**: Vercel, Docker, Cloudflare
- **Security**: Semgrep SAST, CodeQL, Trivy, Gitleaks, SBOM generation

## Go-to-Market

### Five-Wave Release (Feb 26 – May 4, 2026)

| Wave | Date | Target | Metric |
|------|------|--------|--------|
| W1: The Standard | Feb 26 | Community | npm downloads, GitHub stars |
| W2: The Pipeline | Mar 16 | Developers | API registrations, Docker pulls |
| W3: The Platform | Mar 30 | Enterprise | Beta sign-ups, design partner commits |
| W4: The Console | Apr 20 | Operators | Active dashboards, alert configurations |
| W5: The Academy | May 4 | Everyone | Course completions, contributor PRs |

### Design Partner Pipeline

Target: 5-10 enterprise design partners for Wave 3 (Mar 30) invite-only beta.

Ideal profile:
- Deploying 10+ AI agents in production
- Subject to EU AI Act or similar regulation
- Has a compliance/governance team
- Needs audit trails for agent decisions

## Honest Disclosures

| Area | Status | Risk |
|------|--------|------|
| Revenue | Pre-revenue | High |
| Team size | Small (founder + AI-assisted dev) | Medium — hiring plan needed for W3+ |
| a3i orchestration | 34 test failures | Medium — core component, triage planned for March |
| Auth implementation | Stubs in signup/login | Medium — must complete for W3 |
| RBAC persistence | TODO stubs | Medium — permission system incomplete |
| Competitive moat | npm scope `@vorionsys` + first-mover | Medium — large players could build |
| IP protection | Trade secrets, not patents | Low — open core model is defensible |

## Use of Funds (If Raising)

| Category | Allocation | Purpose |
|----------|-----------|---------|
| Engineering (60%) | 2 senior engineers | Parallelize Waves 3-4, backend + security |
| Community (15%) | $50K bounty pool | Contributor incentives, hackathon prizes |
| Legal (10%) | Trademark + compliance | "Vorion", "BASIS" trademark filing |
| Infrastructure (10%) | Cloud + CI costs | Production scaling for enterprise beta |
| Marketing (5%) | Content + events | Dev relations, conference talks |

## Timeline to Key Milestones

| Milestone | Target Date |
|-----------|-------------|
| First public npm packages | Feb 26, 2026 |
| First external API user | Mar 16, 2026 |
| First enterprise beta user | Mar 30, 2026 |
| First revenue | Q2 2026 |
| v1.0.0 release | May 4, 2026 |
| Series A readiness | Q4 2026 |

## One Line

We're building Okta for AI agents — open standard, commercial platform, shipping before the regulatory deadline.
