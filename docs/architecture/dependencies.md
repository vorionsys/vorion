# Circular Dependencies Analysis

**Generated:** 2026-02-04
**Tool Used:** madge v5.x
**Scope:** packages/platform-core/src

## Summary

The initial dependency analysis identified **6 circular dependency chains** in the platform-core package. After implementing fixes, only **1 circular dependency** remains (which is already mitigated with lazy imports).

### Current Status

| Original Count | Fixed | Remaining |
|----------------|-------|-----------|
| 6 | 5 | 1 |

The remaining circular dependency (`security/api-keys/store.ts <-> db-store.ts`) is already mitigated with a lazy import pattern and is low priority.

---

## Fixes Implemented

### 1. agent-registry/routes.ts - FIXED

**Change:** Updated imports to use direct module imports instead of barrel file.

```typescript
// BEFORE
import {
  createAgentRegistryService,
  createA3ICacheService,
  TRUST_TIER_RANGES,
} from './index.js';

// AFTER
import {
  createAgentRegistryService,
  TRUST_TIER_RANGES,
} from './service.js';
import { createA3ICacheService } from './a3i-cache.js';
```

### 2. trust-engine/car-integration.ts - FIXED

**Change:** Removed self-referential `export * from './car-integration.js'` which was causing a trivial cycle.

The file now contains only a deprecation notice pointing users to `@vorionsys/contracts/car`.

### 3. intent/planner/types.ts - CREATED

**Change:** Created new types file to break the cycle between `index.ts`, `rollback.ts`, and `templates.ts`.

Moved types:
- `OnFailureStrategy`
- `ExecutionStep`

Updated imports in:
- `intent/planner/index.ts` - now imports and re-exports from `./types.js`
- `intent/planner/rollback.ts` - imports from `./types.js`
- `intent/planner/templates.ts` - imports from `./types.js`

### 4. intent/replay/types.ts - CREATED

**Change:** Created new types file to break the cycle between `index.ts` and `comparator.ts`.

Moved types:
- `DifferenceType`
- `DifferenceSeverity`
- `Difference`
- `TimingComparison`
- `PolicyComparison`
- `ComparisonReport`
- `ReplayStep`
- `ReplayStepResult`
- `ReplayResult`

Updated imports in:
- `intent/replay/index.ts` - now imports and re-exports from `./types.js`
- `intent/replay/comparator.ts` - imports from `./types.js` and re-exports types

---

## Remaining Circular Dependency

### security/api-keys/store.ts <-> security/api-keys/db-store.ts

**Severity:** Low (Already mitigated)
**Type:** Lazy import pattern

**Chain:**
```
store.ts dynamically imports db-store.ts (lazy loading)
db-store.ts imports IApiKeyStore interface from store.ts
```

**Current Mitigation (in store.ts):**
```typescript
// Lazy import to avoid circular dependencies
let DbApiKeyStore: typeof import('./db-store.js').DbApiKeyStore | null = null;

async function getDbStoreClass() {
  if (!DbApiKeyStore) {
    const module = await import('./db-store.js');
    DbApiKeyStore = module.DbApiKeyStore;
  }
  return DbApiKeyStore;
}
```

**Impact:**
- The codebase already uses a lazy import pattern to mitigate this
- `store.ts` uses `await import('./db-store.js')` to defer loading
- This prevents initialization issues but still represents a logical cycle
- No immediate action needed

**Optional Future Fix:**
Move `IApiKeyStore` interface to `types.ts`:

```typescript
// security/api-keys/types.ts - ADD interface here
export interface IApiKeyStore {
  create(apiKey: ApiKey): Promise<ApiKey>;
  getById(id: string): Promise<ApiKey | null>;
  getByPrefix(prefix: string): Promise<ApiKey | null>;
  update(id: string, updates: Partial<ApiKey>): Promise<ApiKey | null>;
  delete(id: string): Promise<boolean>;
  list(filters: ApiKeyListFilters): Promise<{ keys: ApiKey[]; total: number }>;
  getRateLimitState(keyId: string): Promise<ApiKeyRateLimitState | null>;
  setRateLimitState(state: ApiKeyRateLimitState): Promise<void>;
  incrementRateLimitCounters?(keyId: string): Promise<{ second: number; minute: number; hour: number; }>;
  updateLastUsed(id: string): Promise<void>;
  reset(): void;
  stop(): void;
}

// security/api-keys/store.ts - Import from types
import type { IApiKeyStore } from './types.js';

// security/api-keys/db-store.ts - Import from types
import type { IApiKeyStore } from './types.js';
```

---

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `agent-registry/routes.ts` | Modified | Direct imports from service modules |
| `trust-engine/car-integration.ts` | Modified | Removed self-referential export |
| `intent/planner/types.ts` | Created | New shared types file |
| `intent/planner/index.ts` | Modified | Import/re-export from types.ts |
| `intent/planner/rollback.ts` | Modified | Import from types.ts |
| `intent/planner/templates.ts` | Modified | Import from types.ts |
| `intent/replay/types.ts` | Created | New shared types file |
| `intent/replay/index.ts` | Modified | Import/re-export from types.ts |
| `intent/replay/comparator.ts` | Modified | Import from types.ts |

---

## Verification

Run the following to verify the current state:

```bash
cd packages/platform-core
npx madge --circular --extensions ts src/

# Expected output:
# Found 1 circular dependency!
# 1) security/api-keys/store.ts > security/api-keys/db-store.ts
```

---

## Best Practices for Avoiding Circular Dependencies

1. **Extract shared types to dedicated files:** Create `types.ts` files in module directories for interfaces and types used across multiple files.

2. **Avoid importing from barrel files within the same module:** When files in a module need to import from each other, import directly from the source file rather than the `index.ts` barrel.

3. **Use lazy imports for optional functionality:** When a circular dependency is unavoidable (like factory patterns), use dynamic `import()` to defer loading.

4. **Keep barrel files simple:** Barrel files (`index.ts`) should primarily re-export from other files, not define complex types or logic that other files in the module depend on.

5. **Periodic verification:** Run `npx madge --circular --extensions ts src/` periodically or in CI to catch new circular dependencies early.
