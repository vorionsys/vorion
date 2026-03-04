# Vorion Quickstart Guide

Get up and running with the Vorion AI Governance Platform in 5 minutes.

## Prerequisites

- Node.js 20+
- pnpm 8+
- Docker (for local PostgreSQL)
- Git

## Setup

### 1. Clone and Install

```bash
git clone https://github.com/vorion/vorion.git
cd vorion
pnpm install
```

### 2. Environment Setup

```bash
# Copy environment template
cp .env.shared.example .env.shared

# Edit with your values
# DATABASE_URL is required
```

### 3. Start Database

```bash
# Start PostgreSQL
docker-compose up -d postgres

# Run migrations
pnpm db:migrate

# Seed development data (optional)
pnpm db:seed
```

### 4. Build Packages

```bash
# Build all packages
pnpm build
```

### 5. Start Development Server

```bash
# Start the main API
pnpm dev
```

Server runs at `http://localhost:3000`

## Day 1 Commands

| Task | Command |
|------|---------|
| Install dependencies | `pnpm install` |
| Build all | `pnpm build` |
| Run tests | `pnpm test` |
| Type check | `pnpm typecheck` |
| Start dev server | `pnpm dev` |
| Run migrations | `pnpm db:migrate` |
| Seed database | `pnpm db:seed` |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Module not found | Run `pnpm install && pnpm build` |
| Type errors | Run `pnpm typecheck` to see all errors |
| Database connection | Check `DATABASE_URL` in `.env.shared` |
| Build failures | Run `pnpm clean && pnpm build` |

## Project Structure

```
vorion/
├── packages/
│   ├── contracts/       # Shared types & schemas
│   └── platform-core/   # Business logic
├── apps/
│   └── agentanchor/     # Main web app
└── docs/
    └── STRUCTURE.md     # Full structure guide
```

See [STRUCTURE.md](./STRUCTURE.md) for complete project layout.

## Key Concepts

### Import Rules

```typescript
// ✅ Correct - import from packages
import { Decision } from '@vorionsys/contracts';
import { TrustEngine } from '@vorionsys/platform-core';

// ❌ Wrong - relative paths to src/
import { Decision } from '../../src/common/types';
```

### Feature Flags

```typescript
import { FLAGS } from '@vorionsys/contracts';

// Check flag in code
if (isEnabled(FLAGS.TRUST_EDGE_CACHE)) {
  // Use cached trust scores
}
```

### Database Access

```typescript
import { getDb } from '@vorionsys/platform-core/db/client';

const db = getDb();
const agents = await db.query.agents.findMany();
```

## Next Steps

1. Read [STRUCTURE.md](./STRUCTURE.md) for project organization
2. Check out [CONTRIBUTING.md](./CONTRIBUTING.md) for development workflow
3. Review the architecture in `_bmad-output/planning-artifacts/architecture.md`

## Getting Help

- **Documentation**: Check the `/docs` folder
- **Issues**: [GitHub Issues](https://github.com/vorion/vorion/issues)
- **Discussions**: [GitHub Discussions](https://github.com/vorion/vorion/discussions)
