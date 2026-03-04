# ADR-002: Next.js with React 19

## Status: Accepted

## Date: 2026-02-25

## Context

Vorion's web layer serves two distinct audiences with different requirements:

1. **Authenticated B2B portal (AgentAnchor)** -- Enterprise users managing AI agents, viewing trust dashboards, reviewing escalations, and auditing proof chains. Requires real-time data, complex forms, and role-based access control.
2. **Public-facing sites** -- Marketing pages (agentanchorai.com, basis.vorion.org), status pages (status-www), and documentation (kaizen learning platform). Requires SEO, fast initial load, and minimal client JavaScript.

The platform has 7 Next.js applications currently deployed:

| App | Purpose | Config |
|-----|---------|--------|
| `agentanchor` | B2B governance portal | `next.config.js` with Sentry, transpilePackages |
| `agentanchor-www` | Product marketing site | `next.config.js` |
| `aurais` | AI interface | `next.config.js` |
| `dashboard` | Operational dashboard | `next.config.js` |
| `kaizen` | Learning platform | `next.config.ts` |
| `status-www` | Status page | `next.config.js` |
| `vorion-admin` | Admin panel | `next.config.ts` |

Additionally, the `marketing` app uses Astro for static multi-domain landing pages, and `cognigate-api` is a Python FastAPI service. The framework choice needed to support both server-rendered authenticated experiences and SEO-friendly public content.

## Decision

Adopt **Next.js (App Router)** with **React 19** as the standard framework for all Vorion web applications.

### React 19 Features Used

- **Server Components by default** -- Components are server-rendered unless explicitly marked with `'use client'`, reducing client bundle size for data-heavy governance dashboards.
- **`useFormStatus` / `useOptimistic`** -- Declarative form handling for agent registration, policy editing, and escalation review workflows.
- **Improved Suspense boundaries** -- Streaming SSR for dashboard pages that load trust scores, proof chains, and compliance data from multiple sources.

### Next.js App Router Patterns

| Pattern | Implementation |
|---------|---------------|
| Directory structure | `/app` directory with route groups |
| Component default | Server Components; `'use client'` only for interactive widgets |
| Authentication | Supabase SSR auth via Next.js middleware at the edge |
| Client data fetching | SWR for cache-aware revalidation of trust scores |
| Styling | Tailwind CSS with shared design tokens (`packages/design-tokens`) |
| Forms & mutations | Server Actions + `useFormStatus` |
| Error handling | Sentry integration via `@sentry/nextjs` (see `agentanchor/next.config.js`) |

### Configuration Patterns

The `agentanchor` app demonstrates the standard configuration:

```javascript
const nextConfig = {
  serverExternalPackages: ['pino', 'pino-pretty', 'thread-stream'],
  transpilePackages: ['@vorionsys/atsf-core'],
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
};
module.exports = withSentryConfig(nextConfig);
```

Key patterns:
- **`transpilePackages`** allows importing workspace packages from source without pre-building, enabling faster development cycles.
- **`serverExternalPackages`** excludes Node.js-native logging libraries from the client bundle.
- **Sentry wrapping** provides error tracking and performance monitoring in production.

### React 19 Override

The root `package.json` pins React 19 across the monorepo via `overrides`:

```json
{
  "overrides": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

This is necessary because some third-party libraries (Sentry, certain shadcn/ui components) still declare React 18 as a peer dependency.

## Consequences

### Positive

- **SEO-friendly SSR** for marketing pages and public documentation without additional infrastructure.
- **Smaller client bundles** via React Server Components -- governance data tables, proof chain displays, and compliance reports render entirely on the server.
- **Vercel zero-config deployments** with preview environments per PR, enabling rapid iteration on UI changes.
- **Unified framework** across 7 web apps reduces context-switching overhead for developers.
- **Built-in image and font optimization** reduces page weight without manual configuration.
- **Middleware-based auth** -- Supabase session validation at the edge before any page renders.

### Negative

- **React 19 peer dependency overrides** required workspace-wide due to libraries pinned to React 18.
- **App Router learning curve** for developers accustomed to Pages Router conventions.
- **RSC library compatibility** -- Some third-party libraries (charting, drag-and-drop) are not RSC-compatible and require `'use client'` wrapper components.
- **ESLint version conflict** -- Next.js bundles ESLint 8 internally, which conflicts with the root workspace ESLint 9 flat config. Resolved via `ESLINT_USE_FLAT_CONFIG=true`.
- **TypeScript build errors suppressed** -- `agentanchor` sets `typescript.ignoreBuildErrors: true` to avoid blocking deploys on upstream package type issues.

### Mitigations

- React 19 override pinned in root `package.json`; upstream library adoption tracked via Renovate.
- Internal patterns guide maintained for App Router conventions.
- Incompatible libraries wrapped in client boundary components.
- Separate ESLint configs for Next.js apps vs. packages.
- TypeScript errors addressed in packages independently; `ignoreBuildErrors` is a temporary measure.

## Alternatives Considered

| Alternative | Reason for Rejection |
|-------------|---------------------|
| **Remix** | Strong SSR story but less Vercel-native; smaller middleware ecosystem for edge auth. |
| **SvelteKit** | Smaller ecosystem; team expertise concentrated in React. Would fragment the component library. |
| **Vite + React (SPA)** | No SSR out of the box; SEO requirements for marketing sites would require a separate solution. |
| **Astro for everything** | Used for the `marketing` app's static sites, but lacks the interactive component model needed for the governance portal. |

## References

- [AgentAnchor next.config.js](/apps/agentanchor/next.config.js)
- [Kaizen next.config.ts](/apps/kaizen/next.config.ts)
- [Root package.json React 19 override](/package.json)
- [Design tokens package](/packages/design-tokens)
- [Next.js Documentation](https://nextjs.org/docs)
- [React 19 Release Notes](https://react.dev/blog)
