# Vorion Project — Claude Code Instructions

## Git Workflow (CRITICAL)

Claude Code resets the working tree to `origin/master` between conversation turns. To prevent loss of work:

1. **Always commit AND push in the same bash call** — commits alone will be wiped
2. **Use atomic bash scripts** for multi-file changes: write to `/tmp/`, then `cp + git add + git commit + git push` in one command
3. **New untracked files** may survive between turns, but don't rely on it
4. **Never leave uncommitted/unpushed work** at the end of a response

### Example safe workflow:
```bash
# All in one bash call:
sed -i '' 's/old/new/' file.txt
git add file.txt
git commit -m "fix: description"
git push origin master
```

## Project Context

- **Monorepo**: Turborepo + npm workspaces, 25 packages, 20+ apps
- **Default branch**: `master` (not main)
- **Test runner**: Vitest
- **Build**: `npx turbo build`
- **Test**: `npx turbo test --filter="./packages/*"`
- **Node**: v20
- **Package manager**: npm with `--legacy-peer-deps`

## Pre-commit Hook

`.husky/pre-commit` runs lint-staged + gitleaks. Use `--no-verify` only if explicitly authorized.
