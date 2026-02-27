# Env & Secrets Matrix — Vorion Monorepo

**Owner:** @chunkstar (infrastructure lead)
**Status:** Draft — Wave 1 Foundation Lock
**Last updated:** February 27, 2026
**Next review:** Wave 2 Staging Dress Rehearsal

This document is the canonical reference for every environment variable and secret required across all Vorion services. Verify parity between local, staging, and production before each wave exit.

---

## How to use this document

- **Required** = service will fail to start or a critical feature will be broken without this value
- **Optional** = graceful degradation occurs if absent (feature disabled, simulated mode, or default used)
- **Secret** = must never be committed to source control; must be injected at runtime; rotate on breach
- **Public** = safe to expose to browsers (prefixed with `NEXT_PUBLIC_`), still should not be hardcoded

---

## cognigate-api (`apps/cognigate-api`)

Deploy target: **Fly.io** (`cognigate-api` app, region `iad`)
Secrets managed via: `fly secrets set` or Railway environment panel

| Variable | Required | Secret | Default | Description |
|----------|----------|--------|---------|-------------|
| `NODE_ENV` | Yes | No | `production` | Runtime mode. Controls SQLite vs memory storage. |
| `PORT` | Yes | No | `3000` | HTTP listen port. Set in `fly.toml` env block. |
| `HOST` | No | No | `0.0.0.0` | Bind address. |
| `LOG_LEVEL` | No | No | `info` | Pino log level: `trace`, `debug`, `info`, `warn`, `error`. |
| `ENABLE_AUTH` | No | No | `true` | Set to `false` to disable API key auth in dev. Never disable in prod. |
| `DATA_DIR` | No | No | `./data` | Directory for SQLite database file when `NODE_ENV=production`. |
| `SQLITE_PATH` | No | No | `/data/cognigate.db` | Full path to SQLite file (set in `fly.toml`). Remove when migrating to Postgres. |
| `DATABASE_URL` | Conditional | **Yes** | — | Postgres connection string. Required after SQLite → Postgres migration. Set via `fly secrets set`. |

### cognigate-api Wave 1 checklist

- [ ] `NODE_ENV=production` confirmed in Fly.io environment
- [ ] `SQLITE_PATH` or `DATABASE_URL` confirmed (not both)
- [ ] `ENABLE_AUTH=true` in production (verify — do not default to false)
- [ ] `LOG_LEVEL=info` in production (not `debug` — avoids leaking request bodies in logs)

---

## kaizen / learn.vorion.org (`apps/kaizen`)

Deploy target: **Vercel**
Secrets managed via: Vercel project environment variables panel

### Firebase (Studio agent system)

| Variable | Required | Secret | Default | Description |
|----------|----------|--------|---------|-------------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Yes | Public | — | Firebase web API key. Scoped to your domain in Firebase console. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Yes | Public | — | e.g. `vorion-studio.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Yes | Public | — | Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | Yes | Public | — | Firebase storage bucket |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Yes | Public | — | Firebase messaging sender ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Yes | Public | — | Firebase app ID |
| `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` | No | Public | — | Firebase Analytics measurement ID |
| `NEXT_PUBLIC_STUDIO_APP_ID` | No | No | `vorion-studio-v3.0` | Studio version identifier |

### AI Providers

| Variable | Required | Secret | Default | Description |
|----------|----------|--------|---------|-------------|
| `GOOGLE_GENERATIVE_AI_API_KEY` | Yes | **Yes** | — | Gemini API key. Required for NexusChat + Studio agents. App fails gracefully to simulation if absent. |
| `NEXT_PUBLIC_GEMINI_API_KEY` | No | Public | — | Client-side Gemini key. Only needed if client-direct Gemini calls are used. |
| `ANTHROPIC_API_KEY` | No | **Yes** | — | Enables Claude provider. Simulated mode used if absent. |
| `XAI_API_KEY` | No | **Yes** | — | Enables Grok/xAI provider. Simulated mode used if absent. |

### Supabase

| Variable | Required | Secret | Default | Description |
|----------|----------|--------|---------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | No | Public | — | Required for cloud lexicon sync. Feature disabled if absent. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No | Public | — | Supabase anon key. Safe to expose (row-level security enforced in Supabase). |

### Email / Contact

| Variable | Required | Secret | Default | Description |
|----------|----------|--------|---------|-------------|
| `RESEND_API_KEY` | Yes | **Yes** | — | Required for contact form on `/pitch`. Form broken if absent. |
| `CONTACT_TO_EMAIL` | No | No | `racas@vorion.org` | Destination for contact form submissions. |
| `CONTACT_FROM_EMAIL` | No | No | `team@vorion.org` | Sender address for contact form emails. Must be a verified Resend domain. |

### Vercel / Routing

| Variable | Required | Secret | Default | Description |
|----------|----------|--------|---------|-------------|
| `VERCEL_URL` | No | No | — | Injected automatically by Vercel. Used for internal API base URL resolution. |

### Kaizen Wave 1 checklist

- [ ] All Firebase `NEXT_PUBLIC_` vars set in Vercel production environment
- [ ] `GOOGLE_GENERATIVE_AI_API_KEY` set in Vercel production (not just preview)
- [ ] `RESEND_API_KEY` set — verify by submitting contact form on `/pitch` in staging
- [ ] Confirm `CONTACT_FROM_EMAIL` domain is verified in Resend dashboard
- [ ] `ANTHROPIC_API_KEY` and `XAI_API_KEY`: confirm intentional absent/present decision (simulated vs live)

---

## ai-gateway (`packages/ai-gateway`)

Deploy target: LiteLLM proxy (self-hosted or managed)
Secrets managed via: host environment / Docker secrets

| Variable | Required | Secret | Default | Description |
|----------|----------|--------|---------|-------------|
| `ANTHROPIC_API_KEY` | Yes | **Yes** | — | Required for Claude Sonnet and Opus routing |
| `GOOGLE_API_KEY` | Yes | **Yes** | — | Required for Gemini 2.0 Flash routing |
| `LITELLM_MASTER_KEY` | Conditional | **Yes** | — | Master key for LiteLLM proxy auth. Required if proxy is public-facing. |

### ai-gateway Wave 1 checklist

- [ ] `ANTHROPIC_API_KEY` injected into LiteLLM runtime
- [ ] `GOOGLE_API_KEY` injected into LiteLLM runtime
- [ ] `LITELLM_MASTER_KEY` set if proxy is externally accessible
- [ ] Verify model routing with `litellm --config litellm-config.yaml` before launch

---

## basis (`packages/basis`)

Deploy target: Hardhat scripts (deployment only, not a running service)
Secrets managed via: `.env` (gitignored) or CI secrets

| Variable | Required | Secret | Default | Description |
|----------|----------|--------|---------|-------------|
| `PRIVATE_KEY` | Yes | **Yes** | — | Deployer wallet private key. Never commit. Use a dedicated deployer wallet with minimal funds. |
| `AMOY_RPC_URL` | Yes | No | `https://rpc-amoy.polygon.technology` | Polygon Amoy testnet RPC |
| `POLYGON_RPC_URL` | Yes | No | `https://polygon-rpc.com` | Polygon mainnet RPC. Required for mainnet deploys. |
| `POLYGONSCAN_API_KEY` | No | **Yes** | — | Required for contract verification on PolygonScan. |
| `CERTIFIER_ADDRESS` | Yes | No | — | Vorion CAR certifier contract address |
| `REPORT_GAS` | No | No | `false` | Enable gas usage reporting in tests |
| `COINMARKETCAP_API_KEY` | No | **Yes** | — | Required for USD gas cost estimates in reports. Optional. |
| `MUMBAI_RPC_URL` | Deprecated | No | — | Mumbai testnet is deprecated. Do not use. |

### basis Wave 1 checklist

- [ ] `PRIVATE_KEY` confirmed as a dedicated deployer wallet (not a personal wallet)
- [ ] `PRIVATE_KEY` balance checked before any mainnet deploy
- [ ] `POLYGONSCAN_API_KEY` set for contract verification
- [ ] `CERTIFIER_ADDRESS` confirmed correct for target network

---

## Cross-Service / Vorion SDK Consumers

Any service using `@vorionsys/cognigate` SDK:

| Variable | Required | Secret | Default | Description |
|----------|----------|--------|---------|-------------|
| `COGNIGATE_API_KEY` | Yes | **Yes** | — | API key for authenticating against cognigate-api. Rotate per environment. |
| `COGNIGATE_BASE_URL` | No | No | `https://cognigate.dev/v1` | Override to route to a regional endpoint. See `apps/cognigate-api/DEPLOYMENT.md`. |
| `COGNIGATE_REGION` | No | No | `iad` | Logical region for `X-Cognigate-Region` header. Used for observability. |

---

## Secrets Rotation Policy

| Secret | Rotation trigger | Rotation interval |
|--------|-----------------|-------------------|
| `PRIVATE_KEY` (basis deployer) | On any team member change | Never auto-rotate; rotate on access change |
| `COGNIGATE_API_KEY` | On breach / team change | Every 90 days |
| `GOOGLE_GENERATIVE_AI_API_KEY` | On breach | Every 90 days |
| `ANTHROPIC_API_KEY` | On breach | Every 90 days |
| `RESEND_API_KEY` | On breach | Every 180 days |
| `POLYGONSCAN_API_KEY` | On breach | On demand |
| Firebase API keys | Domain-scoped — low rotation priority | On breach only |
| Supabase anon key | RLS-protected — low rotation priority | On breach only |

---

## Staging vs Production Parity Matrix

Before each wave exit, verify every required secret is present in both staging and production with **different values** (no shared secrets between environments).

| Service | Staging env | Production env | Same values? |
|---------|------------|----------------|--------------|
| cognigate-api | Fly.io staging app or local Docker | Fly.io `cognigate-api` | **NO** — different API keys |
| kaizen | Vercel preview environment | Vercel production | **NO** — different Firebase project |
| ai-gateway | Local / dev LiteLLM | Managed LiteLLM | **NO** — different API keys |
| basis | `.env.amoy` (testnet) | `.env.polygon` (mainnet) | **NO** — different wallet |

---

## Storage Locations by Environment

| Secret | Dev | Staging | Production |
|--------|-----|---------|------------|
| Fly.io secrets | `fly secrets set --app cognigate-api-staging` | `fly secrets set --app cognigate-api-staging` | `fly secrets set --app cognigate-api` |
| Vercel secrets | `.env.local` (gitignored) | Vercel Preview env panel | Vercel Production env panel |
| CI secrets | Not needed | GitHub Actions Secrets → `STAGING_*` | GitHub Actions Secrets → `PROD_*` |
| Basis wallet | `.env` (gitignored, never committed) | CI secret `DEPLOYER_PRIVATE_KEY_AMOY` | CI secret `DEPLOYER_PRIVATE_KEY_POLYGON` |

---

## What is NOT in this document

- Firebase service account JSON (used only in server-side admin SDK if added later)
- TLS certificates (managed by Fly.io / Vercel automatically)
- GitHub Actions `GITHUB_TOKEN` (injected automatically)
- Turbo remote cache token (monorepo build optimization, not required for launch)

---

*This document must be updated whenever a new env variable is added to any service.*
*Breaking change: never remove a variable from this document without confirming the consuming code is also removed.*
