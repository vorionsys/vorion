# Vorion Ecosystem Report

> **Generated:** February 19, 2026
> **Total Apps:** 13 | **Total Pages:** 180+ | **Total APIs:** 50+ | **Domains:** 9

---

## Executive Summary

The Vorion ecosystem spans **13 applications** across **4 deployment platforms** (Vercel, Cloudflare, Fly.io, self-hosted), serving **9 public domains**. The ecosystem covers the full stack: marketing sites, documentation portals, product applications, backend APIs, and operations dashboards.

**Critical Issues:**
- `bai-cc.com` dashboard SSR routes are broken (DNS points to Vercel, app needs Cloudflare)
- `cognigate.dev` API endpoints are degraded (Fly.io deployment needs attention)
- Cloudflare KV exceeding free tier (2,016 writes/day vs 1,000 limit)

---

## Site-by-Site Report

### 1. vorion.org — Vorion Marketing (Astro SSG → Vercel)

| Page | Purpose |
|------|---------|
| `/` | Main landing page. First impression for the Vorion brand. AI agent governance messaging. |
| `/carid` | CAR ID system — Categorical Agentic Registry — universal agent identification |
| `/feedback` | Feedback collection portal for the platform |
| `/logic` | Logic Engine overview — decision-making framework for agents |
| `/opensource` | Open source philosophy and contribution pathways |
| `/trust` | Trust Framework overview — the core value proposition |
| `/verify` | Verification system — how trust scores are validated |

**Status:** ✅ All 7 pages live
**Audience:** Public, potential adopters, enterprises
**Key Links Out:** → agentanchorai.com, basis.vorion.org, learn.vorion.org

---

### 2. agentanchorai.com — AgentAnchor Marketing (Next.js SSG → Vercel)

| Page | Purpose |
|------|---------|
| `/` | Product landing page. "Trust-Verified AI Agents" hero messaging. |
| `/concepts` | Educational — explains trust tiers, agent governance, verification |
| `/demo` | Interactive live demo of the trust engine |
| `/marketplace` | Agent marketplace — browse and discover trusted agents |
| `/pricing` | Pricing tiers for AgentAnchor platform |

**Status:** ✅ All 5 pages live
**Audience:** Product buyers, AI developers, enterprises
**Key Links Out:** → AgentAnchor portal (signup), basis.vorion.org (standard)

---

### 3. agentanchorai.com — AgentAnchor Portal (Next.js SSR → Vercel)

The **flagship product application** — the largest app in the ecosystem.

**Auth (4 pages):** login, signup, forgot-password, reset-password

**Agent Management (6 pages):** `/agents` list, create new, detail view, edit, trust view, training

**Bot Management (4 pages):** `/bots` list, create new, detail view, trust view

**Dashboard (30+ pages):**
| Section | Pages | Purpose |
|---------|-------|---------|
| Core | dashboard home, welcome | Entry point and onboarding |
| Agents | list, detail, edit, trust, new | Full agent CRUD |
| Trust Engine | main, alerts, audit, ceiling, context, presets, provenance, role-gates, verify | Deep trust management |
| Safety | circuit-breaker, escalations | Emergency controls |
| Governance | governance, council, validator detail, compliance | Policy enforcement |
| Collaboration | collaboration, shadow-training, testing-studio | Team features |
| Analytics | trust-metrics, trust-bridge, truth-chain, usage, observer | Data and monitoring |
| Settings | main, api-keys, notifications, payouts, profile | Account config |

**Other Pages:** academy, chat, conversations, docs/api, docs/phase6, MCP hub, orchestrator, portal/certify, portal/mint, status, teams, templates, verify/[hash], onboarding

**API Routes (29):** agents CRUD, trust operations, chat, compliance, escalations, decisions, webhooks, wallet, health, authentication

**Status:** ✅ Live (SSR, requires backend APIs for full functionality)
**Audience:** Platform users, agent operators, developers
**Data Sources:** Trust Engine, Agents DB, Chat API, Auth provider

---

### 4. status.agentanchorai.com — Status Page (Next.js SSG → Vercel)

| Page | Purpose |
|------|---------|
| `/` | Real-time service health dashboard. Shows uptime for all AgentAnchor services. |
| `/api/status` | JSON API returning current service status for programmatic access |

**Status:** ✅ Live
**Audience:** Public, operations team
**Data Sources:** External health checks against all services

---

### 5. bai-cc.com — BAI CC Marketing (Astro SSG → Vercel)

| Page | Purpose |
|------|---------|
| `/` | Landing page for Banquet AI / Command Center |
| `/about` | Company background and mission |
| `/architecture` | Technical architecture overview |
| `/ecosystem` | Visual map of the entire ecosystem |
| `/packages` | npm package registry browser |
| `/projects` | Portfolio of all projects |
| `/projects/*` | 7 individual project detail pages (agentanchor, atsf, aurais, basis, cognigate, learn-vorion, vorion) |

**Status:** ✅ All 13 pages live (static marketing site)
**Audience:** Public, technical evaluators

---

### 6. bai-cc.com — BAI CC Dashboard (Astro SSR → Cloudflare Pages)

| Page | Purpose |
|------|---------|
| `/` | Dashboard home — aggregated stats, quick view |
| `/agents` | Agent registry — all registered agents and their trust scores |
| `/architecture` | System architecture viewer |
| `/governance` | Governance metrics — policy compliance, voting |
| `/health` | Service health monitor — domain health, API status |
| `/tests` | CI/CD test results — test pass rates, coverage |

**API Endpoints (8):** health, stats.json, agents.json, ci.json, domains.json, npm.json, status.json, governance.json

**SVG Badges (4):** agents.svg, ci.svg, npm.svg, trust.svg

**Status:** ⚠️ CRITICAL — Only `/` and `/architecture` (prerendered) work. All SSR routes return 404 because DNS points to Vercel but the app requires Cloudflare Workers + KV.
**Data Sources:** Cloudflare KV (`BAI_CC_CACHE` — 7 keys updated every 5 minutes)
**Issue:** Cloudflare KV free tier exceeded (2,016 writes/day vs 1,000 limit)

---

### 7. basis.vorion.org — BASIS Standard Docs (Docusaurus → Vercel)

| Page | Purpose |
|------|---------|
| `/` | BASIS overview — the open standard for AI agent governance |
| `/layers/car` | CAR layer specification |
| `/layers/intent` | INTENT layer specification |
| `/layers/enforce` | ENFORCE layer specification |
| `/layers/proof` | PROOF layer specification |
| `/layers/chain` | CHAIN layer specification |
| `/cognigate` | Cognigate product documentation |
| `/agentanchor` | AgentAnchor product documentation |
| `/community` | Community page — how to contribute |
| `/blog` | Blog posts and announcements |

**Status:** ✅ All pages live with search
**Audience:** Public, standards adopters, developers
**Key Links Out:** → github.com/voriongit, discord

---

### 8. aci.vorion.org — CAR Specification Docs (Docusaurus → Vercel)

| Page | Purpose |
|------|---------|
| `/` | CAR overview — Categorical Agentic Registry |
| `/vocabulary` | Vocabulary/glossary of CAR terms |
| `/guides/quickstart` | Getting started guide |
| `/guides/integration` | Integration patterns |
| `/guides/framework-analysis` | Framework comparison |
| `/security/hardening` | Security hardening guide |
| `/security/owasp-cheatsheet` | OWASP security cheatsheet |
| `/security/semantic-governance` | Semantic governance model |
| `/specs/core` | Core CAR specification |
| `/specs/did-method` | DID method specification |
| `/specs/extensions` | Extension mechanisms |
| `/specs/openid-claims` | OpenID claims mapping |
| `/specs/registry-api` | Registry API specification |

**Status:** ✅ All 13 pages live
**Audience:** Developers, standards implementers

---

### 9. learn.vorion.org — Kaizen Learning Platform (Next.js SSR → Vercel)

| Page | Purpose |
|------|---------|
| `/` | Learning platform home — course catalog |
| `/certificates` | Earned certificates and credentials |
| `/cortex` | Cortex — AI-assisted learning |
| `/docs` | Platform documentation |
| `/internal` | Internal admin tools |
| `/lexicon` | Terminology dictionary index |
| `/lexicon/[slug]` | Individual term definitions |
| `/neural` | Neural network visualizations |
| `/paths` | Learning path catalog |
| `/paths/[slug]` | Individual learning path |
| `/paths/[slug]/quiz` | Assessment quizzes |
| `/pitch` | Platform pitch/marketing |
| `/profile` | User profile and progress |
| `/studio` | Content creation studio |

**Status:** ✅ All 15 pages live
**Audience:** Learners, HITL certification candidates, content creators
**Key Links Out:** → AgentAnchor (for certified operators)

---

### 10. aurais.net — Aurais Portal (Next.js SSR → Vercel)

**Marketing Pages (14):** home, about, blog, careers, changelog, contact, demo, docs, features, marketplace, pricing, privacy, security, terms

**Auth Pages (4):** login, signup, forgot-password, verify-email

**Dashboard Pages (6):** dashboard home, activity, settings, agents list, create agent, agent detail

**Status:** ✅ All 24 pages live
**Audience:** Public (marketing) + Users (dashboard)
**Purpose:** Trust-verified AI agents portal — parallel product to AgentAnchor

---

### 11. vorion-admin — Admin Panel (Next.js SSR → Vercel)

| Page | Purpose |
|------|---------|
| `/` | Admin home |
| `/dashboard` | Admin dashboard |
| `/dashboard/agents` | Manage all agents across platforms |
| `/dashboard/api-keys` | API key management |
| `/dashboard/audit-logs` | Full audit trail viewer |
| `/dashboard/monitoring` | System monitoring |
| `/dashboard/organizations` | Organization management |
| `/dashboard/security` | Security settings and controls |
| `/dashboard/settings` | System configuration |
| `/dashboard/users` | User management |

**Status:** ✅ 10 pages (internal only, no public domain assigned)
**Audience:** Internal administrators

---

### 12. cognigate.dev — Cognigate API (Fastify → Fly.io)

| Endpoint | Purpose |
|----------|---------|
| `POST /v1/agents` | Register a new agent |
| `GET /v1/agents/:id` | Get agent details |
| `GET /v1/agents/:id/trust` | Get trust score |
| `POST /v1/intents` | Submit an intent for evaluation |
| `POST /v1/verify` | Verify a proof |
| `GET /v1/chain/:hash` | Look up chain entry by hash |
| `GET /health` | Health check |

**Status:** ⚠️ DEGRADED — API endpoints returning errors
**Audience:** Machines, developer integrations
**Purpose:** The core REST API gateway for the entire trust framework

---

### 13. Internal API (Fastify → Self-hosted)

| Command | Purpose |
|---------|---------|
| `sentinel:audit` | Security audit of codebase |
| `scribe:map` | Map codebase structure |
| `curator:scan` | Scan dependencies |
| `watchman:monitor` | Monitor services |
| `librarian:index` | Index content |
| `envoy:plan` | AI-powered planning |
| `envoy:draft` | AI-powered content drafting |
| `council:list` | List governance proposals |
| `council:submit` | Submit governance proposal |
| `herald:run` | Run herald announcements |

**Status:** ⚠️ Not deployed (development only)
**Audience:** Internal agents and automation

---

## Deployment Summary

| Platform | Apps | Pages | APIs | Cost |
|----------|------|-------|------|------|
| **Vercel** | 10 | 160+ | 30+ | Pro plan |
| **Cloudflare Pages** | 1 | 6 | 12 | Free → needs $5/mo |
| **Fly.io** | 1 | 0 | 7 | Pay-per-use |
| **Self-hosted** | 1 | 0 | 10 | Local |
| **TOTAL** | **13** | **166+** | **59+** | — |

---

## Critical Issues & Recommended Actions

| # | Issue | Severity | Action |
|---|-------|----------|--------|
| 1 | bai-cc-dashboard DNS mismatch | **CRITICAL** | Point bai-cc.com DNS to Cloudflare Pages OR switch to Vercel adapter |
| 2 | Cloudflare KV rate limit | **HIGH** | Upgrade to Workers Paid ($5/month) |
| 3 | cognigate-api degraded | **HIGH** | Check Fly.io deployment, redeploy if needed |
| 4 | agent-card.json 404 at root | **MEDIUM** | Add redirect from /agent-card.json to /.well-known/agents.json |
| 5 | No unified monitoring | **MEDIUM** | Fix bai-cc dashboard to become the single source of truth |

---

## Files

| File | Description |
|------|-------------|
| `docs/reports/ecosystem-inventory.csv` | Sortable spreadsheet — 170+ rows, 13 columns |
| `docs/reports/ecosystem-architecture.mmd` | Mermaid — Platform architecture diagram |
| `docs/reports/ecosystem-data-flow.mmd` | Mermaid — Data and information flow |
| `docs/reports/ecosystem-user-journey.mmd` | Mermaid — User journey and knowledge pathways |
| `docs/reports/ecosystem-report.md` | This report |
