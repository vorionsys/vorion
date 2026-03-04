# ADR-014: Next.js 15 with React 19

**Status:** Accepted
**Date:** 2026-02-11
**Deciders:** Vorion Architecture Team

## Context

Vorion's web applications -- AgentAnchor B2B portal, marketing sites, and operational dashboards -- require:

1. **Server-side rendering (SSR)** for SEO and fast initial load performance
2. **React Server Components (RSC)** to reduce client-side JavaScript bundles
3. **A mature deployment story** with zero-config hosting on Vercel
4. **Strong TypeScript support** across the full stack

These applications serve both public-facing content (marketing, docs) and authenticated experiences (agent management, trust dashboards), making SSR and progressive hydration essential.

## Decision

Adopt **Next.js 15 (App Router)** with **React 19** as the standard framework for all Vorion web applications.

### React 19 Provides

- `useFormStatus` / `useOptimistic` for declarative form handling
- Server Components by default (no client JS unless opted in)
- Improved Suspense boundaries for streaming SSR

### Next.js 15 Provides

- **App Router** with nested layouts and parallel routes
- **Server Actions** for type-safe mutations without API routes
- **Middleware** for Supabase SSR auth checks at the edge
- **Image / Font optimization** out of the box

### Key Patterns

| Pattern | Approach |
|---------|----------|
| Directory structure | `/app` directory with route groups |
| Component default | Server Components; `'use client'` only when needed |
| Authentication | Supabase SSR auth via Next.js middleware |
| Client data fetching | SWR for cache-aware revalidation |
| Styling | Tailwind CSS with design tokens |
| Forms & mutations | Server Actions + `useFormStatus` |

## Consequences

### Positive

- **SEO-friendly SSR** for marketing and public pages
- **Smaller client bundles** via React Server Components
- **Vercel zero-config deployments** with preview environments per PR
- **Strong TypeScript support** end-to-end (server and client)
- **Built-in optimization** for images, fonts, and code splitting

### Negative

- **React 19 peer dependency override** needed in workspace (`package.json` overrides) due to libraries pinned to React 18
- **App Router learning curve** for developers accustomed to Pages Router
- **RSC library compatibility** -- some third-party libraries are not yet RSC-compatible and require `'use client'` wrappers
- **ESLint version conflict** -- Next.js 15 bundles ESLint 8, which conflicts with root workspace ESLint 9 flat config

### Mitigations

- Pin React 19 override in root `package.json`; track upstream library adoption
- Maintain internal App Router patterns guide with examples
- Wrap incompatible libraries in client boundary components
- Use `ESLINT_USE_FLAT_CONFIG=true` and a separate Next.js-specific ESLint config

## Alternatives Considered

| Alternative | Why Not |
|-------------|---------|
| **Remix** | Strong SSR story but less Vercel-native; smaller middleware ecosystem |
| **SvelteKit** | Smaller ecosystem; team expertise is React-based |
| **Vite + React (SPA)** | No SSR out of the box; requires custom server for SEO |

## References

- [Next.js 15 Documentation](https://nextjs.org/docs)
- [React 19 Blog Post](https://react.dev/blog)
- [ADR-010: Persistence Strategy](ADR-010-persistence-strategy.md)
