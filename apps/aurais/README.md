# Aurais - Trust-Verified AI Agents

Aurais is the consumer/business frontend for the Vorion AI governance platform. It provides access to trust-verified AI agents backed by AgentAnchor certification.

## Product Tiers

| Tier | Price | Target | Key Features |
|------|-------|--------|--------------|
| **Core** | Free | Individual/Hobbyist | 3 agents, T0-T3, 1K exec/mo, community support |
| **Starter** | $12/mo | Individual/SMB | 10 agents, T0-T4, 10K exec/mo, API access |
| **Pro** | $49/mo | Professional/Teams | Unlimited agents, T0-T5, 50K exec/mo, team collab |
| **Team** | $99/mo | Growing Teams | T0-T6, 200K exec/mo, SSO/SAML, RBAC, compliance |
| **Enterprise** | Custom | Enterprise | T0-T7, unlimited exec, on-prem, dedicated support |

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Styling**: Tailwind CSS 4
- **Backend**: Supabase (via shared Vorion infrastructure)
- **Trust**: AgentAnchor API integration

## Development

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Build for production
pnpm build
```

## Backend Access

| Tier | AgentAnchor | Kaizen | Cognigate |
|------|-------------|--------|-----------|
| Core | Query only | Basic logging | — |
| Starter | Query only | Basic logging | Lite |
| Pro | Query + submit | Full layers | Lite |
| Team | Query + submit | Full layers + policies | Standard |
| Enterprise | Full API + webhooks | Custom policies | Dedicated |

## URLs

- Production: `aurais.net`

## Part of Vorion

Aurais is a product of the [Vorion](https://vorion.org) AI governance ecosystem:

- **AgentAnchor** - Trust authority & certification
- **Kaizen** - Execution integrity layers
- **Cognigate** - Optimized governance runtime
- **BASIS** - Open capability standard
