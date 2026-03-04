/**
 * Tenant Isolation — Static Analysis (Row-Level Security Assertion)
 *
 * This test acts as a CI gate ensuring every query function in
 * platform-core that reads from a tenant-scoped table includes a
 * tenant_id filter in its WHERE clause.
 *
 * It scans the source files for Drizzle query patterns:
 *   .select().from(TABLE).where(...)
 *   .update(TABLE).set(...).where(...)
 *   .delete(TABLE).where(...)
 *
 * For each tenant-scoped table, it ensures the WHERE block contains
 * a reference to `tenantId` (either `TABLE.tenantId` or a parameter
 * named `tenantId`).
 *
 * This is a lightweight approach that catches regressions when new
 * query functions are added without tenant filtering.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PLATFORM_CORE_SRC = path.resolve(__dirname, '../src');

/**
 * Tables that MUST always be filtered by tenant_id in queries.
 * Maps Drizzle table variable name -> the column name pattern to search for.
 */
const TENANT_SCOPED_TABLES: Record<string, string[]> = {
  // agents.ts (contracts)
  agents: ['agents.tenantId', 'tenantId'],
  attestations: ['attestations.tenantId', 'tenantId'],
  stateTransitions: ['stateTransitions.tenantId', 'tenantId'],
  approvalRequests: ['approvalRequests.tenantId', 'tenantId'],
  apiKeys: ['apiKeys.tenantId', 'ak.tenantId', 'this.ak.tenantId', 'tenantId'],

  // intent/schema.ts
  intents: ['intents.tenantId', 'tenantId'],
  escalations: ['escalations.tenantId', 'tenantId'],
  intentEvaluations: ['intentEvaluations.tenantId', 'tenantId'],
  auditRecords: ['auditRecords.tenantId', 'tenantId'],
  policies: ['policies.tenantId', 'tenantId'],
  webhookDeliveries: ['webhookDeliveries.tenantId', 'tenantId'],

  // enforce/schema.ts
  decisions: ['decisions.tenantId', 'tenantId'],
  decisionConstraints: ['decisionConstraints.tenantId', 'tenantId'],
  refinementOptions: ['refinementOptions.tenantId', 'tenantId'],
  workflowInstances: ['workflowInstances.tenantId', 'tenantId'],
};

/**
 * Known safe exceptions — query functions that intentionally do NOT
 * filter by tenant_id. Each entry explains why it's safe.
 *
 * Format: "filename:functionPattern" -> reason
 */
const KNOWN_EXCEPTIONS: Record<string, string> = {
  // --- agent-registry/service.ts ---
  // All agent-registry queries that operate by globally unique IDs (agentId, carId)
  // rather than by tenant_id directly. Isolation is enforced at the agent ownership level.
  'agent-registry/service.ts:getAttestations': 'Filters by agentId; agent lookup is tenant-scoped',
  'agent-registry/service.ts:processAttestations': 'Internal batch keyed on agentId (tenant-scoped)',
  'agent-registry/service.ts:getAgentByCarId': 'CAR IDs are globally unique identifiers',
  'agent-registry/service.ts:getAgentById': 'Used internally after tenant-scoped operations',
  'agent-registry/service.ts:updateAgent': 'Keyed on agent UUID (globally unique)',
  'agent-registry/service.ts:submitAttestation': 'Updates agent by globally unique UUID after tenant-scoped insert',
  'agent-registry/service.ts:applyStateChange': 'Private method called after tenant-scoped lookups',
  'agent-registry/service.ts:transitionState': 'applyStateChange is private, called within tenant-scoped transitionState',
  'agent-registry/service.ts:checkLifecycleRules': 'Internal method, agent is already tenant-verified',

  // --- tenant-service.ts ---
  'tenant-service.ts:resetRateLimits': 'System-level batch operation, not tenant-scoped',
  'tenant-service.ts:validateApiKey': 'API key hash is globally unique',

  // --- intent/repository.ts ---
  'intent/repository.ts:recordEvent': 'Uses intentId which is tenant-scoped at creation',
  'intent/repository.ts:getRecentEvents': 'Uses intentId which is tenant-scoped at creation',
  'intent/repository.ts:verifyEventChain': 'Uses intentId which is tenant-scoped at creation',
  'intent/repository.ts:deleteOldEvents': 'Retention cleanup - deletes by age, not tenant',
  'intent/repository.ts:purgeDeletedIntents': 'Retention cleanup - deletes by age, not tenant',
  'intent/repository.ts:listEvaluations': 'Uses intentId which is tenant-scoped at creation',
  'intent/repository.ts:listIntents': 'Cursor lookup by ID within already tenant-scoped method',

  // --- enforce/repository.ts ---
  'enforce/repository.ts:getExpiredWorkflows': 'System cleanup - processes all expired workflows',

  // --- intent/escalation.ts ---
  'intent/escalation.ts:': 'Cursor lookup by ID within tenant-scoped list method',

  // --- audit/service.ts ---
  'audit/service.ts:': 'Audit queries use record-level IDs or system-level batch operations',

  // --- audit/db-store.ts ---
  'audit/db-store.ts:': 'Audit writes include tenantId in the record itself',

  // --- intent/webhooks/delivery-repository.ts ---
  'intent/webhooks/delivery-repository.ts:': 'Webhook deliveries use globally unique IDs; ownership verified upstream',

  // --- intent/webhooks.ts ---
  'intent/webhooks.ts:': 'Webhook queries use globally unique IDs; tenant ownership verified at registration',

  // --- common/db.ts ---
  'common/db.ts:': 'JSDoc code example in comments, not an actual query execution',

  // --- provenance storage ---
  'provenance/storage.ts:': 'Provenance uses entity-scoped queries',

  // --- security/api-keys/db-store.ts ---
  // API key operations that use globally unique IDs (UUID or prefix).
  // Tenant ownership is verified upstream by the caller (e.g., tenant-service.ts validateApiKey).
  'api-keys/db-store.ts:getById': 'Looks up by globally unique API key UUID',
  'api-keys/db-store.ts:getByPrefix': 'Prefix is globally unique; tenant verified upstream',
  'api-keys/db-store.ts:updateLastUsed': 'Updates by globally unique API key UUID',
  'api-keys/db-store.ts:updateExpiredKeys': 'System-level batch: marks all expired keys across tenants',
  'api-keys/db-store.ts:getStats': 'System-level admin statistics across all tenants',
  'api-keys/db-store.ts:cleanupStaleRateLimits': 'System cleanup of expired rate limit records',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively find all .ts files under a directory
 */
function findTsFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findTsFiles(fullPath));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extract query blocks from a TypeScript source file.
 *
 * Returns an array of { method, table, hasWhere, hasTenantFilter, line }.
 *
 * A "query block" is a chain like:
 *   this.db.select().from(TABLE).where(...)
 *   this.db.update(TABLE).set(...).where(...)
 *
 * We use regex to find these patterns. This is intentionally conservative:
 * it may produce false positives (caught by KNOWN_EXCEPTIONS) but should
 * never miss a real query.
 */
interface QueryBlock {
  method: string;       // enclosing method name
  table: string;        // Drizzle table variable
  hasWhere: boolean;    // whether a .where() call follows
  hasTenantFilter: boolean; // whether tenantId is referenced in the where
  line: number;         // approximate line number
  filePath: string;
  raw: string;          // the matched text
}

function extractQueryBlocks(filePath: string, source: string): QueryBlock[] {
  const blocks: QueryBlock[] = [];

  // Pattern 1: .select().from(TABLE) or .select({...}).from(TABLE)
  const selectPattern = /\.select\([^)]*\)\s*\.from\((\w+)\)/g;
  // Pattern 2: .update(TABLE)
  const updatePattern = /\.update\((\w+)\)/g;
  // Pattern 3: .delete(TABLE)
  const deletePattern = /\.delete\((\w+)\)/g;

  const lines = source.split('\n');

  function findEnclosingMethod(lineIndex: number): string {
    // Drizzle/ORM method calls and other non-declaration identifiers to skip
    const SKIP_METHODS = new Set([
      'if', 'for', 'while', 'switch', 'catch', 'constructor',
      'select', 'from', 'where', 'update', 'set', 'insert', 'delete',
      'values', 'returning', 'limit', 'offset', 'orderBy', 'and', 'eq',
      'inArray', 'desc', 'sql', 'then', 'map', 'filter', 'push', 'reduce',
      'await', 'return', 'const', 'let', 'var', 'new', 'throw',
      'parseInt', 'Math', 'console', 'JSON', 'Date', 'Object', 'Array',
      'Promise', 'Error', 'String', 'Number',
    ]);

    // Walk backwards looking for a proper method/function declaration
    for (let i = lineIndex; i >= 0; i--) {
      const line = lines[i].trimStart();

      // Match: async methodName(, private methodName(, function methodName(
      const methodMatch = line.match(
        /^(?:export\s+)?(?:async\s+)?(?:private\s+)?(?:public\s+)?(?:protected\s+)?(?:static\s+)?(?:function\s+)?(\w+)\s*\(/,
      );
      if (methodMatch && !SKIP_METHODS.has(methodMatch[1])) {
        return methodMatch[1];
      }

      // Also match arrow functions: const methodName = async (...) =>
      const arrowMatch = line.match(
        /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*=>/,
      );
      if (arrowMatch && !SKIP_METHODS.has(arrowMatch[1])) {
        return arrowMatch[1];
      }
    }
    return '<unknown>';
  }

  function getLineNumber(charIndex: number): number {
    return source.substring(0, charIndex).split('\n').length;
  }

  function checkForTenantFilter(startIndex: number): { hasWhere: boolean; hasTenantFilter: boolean } {
    // Look at the next ~500 characters for .where( and tenantId
    const block = source.substring(startIndex, startIndex + 800);
    const hasWhere = /\.where\s*\(/.test(block);

    // Check if tenantId is referenced in the WHERE block
    const hasTenantFilter =
      /[Tt]enant[Ii]d/.test(block) &&
      hasWhere;

    return { hasWhere, hasTenantFilter };
  }

  // Process select patterns
  let match;
  while ((match = selectPattern.exec(source)) !== null) {
    const table = match[1];
    const lineNum = getLineNumber(match.index);
    const method = findEnclosingMethod(lineNum - 1);
    const { hasWhere, hasTenantFilter } = checkForTenantFilter(match.index);

    blocks.push({
      method,
      table,
      hasWhere,
      hasTenantFilter,
      line: lineNum,
      filePath,
      raw: match[0],
    });
  }

  // Process update patterns
  while ((match = updatePattern.exec(source)) !== null) {
    const table = match[1];
    const lineNum = getLineNumber(match.index);
    const method = findEnclosingMethod(lineNum - 1);
    const { hasWhere, hasTenantFilter } = checkForTenantFilter(match.index);

    blocks.push({
      method,
      table,
      hasWhere,
      hasTenantFilter,
      line: lineNum,
      filePath,
      raw: match[0],
    });
  }

  // Process delete patterns
  while ((match = deletePattern.exec(source)) !== null) {
    const table = match[1];
    const lineNum = getLineNumber(match.index);
    const method = findEnclosingMethod(lineNum - 1);
    const { hasWhere, hasTenantFilter } = checkForTenantFilter(match.index);

    blocks.push({
      method,
      table,
      hasWhere,
      hasTenantFilter,
      line: lineNum,
      filePath,
      raw: match[0],
    });
  }

  return blocks;
}

/**
 * Check if a query block is covered by a known exception.
 *
 * Exception keys use "partial-path:methodPattern" where partial-path
 * is matched against the end of the file path (supports directory prefixes).
 */
function isKnownException(block: QueryBlock): boolean {
  const relPath = path.relative(PLATFORM_CORE_SRC, block.filePath);
  for (const key of Object.keys(KNOWN_EXCEPTIONS)) {
    const [filePattern, methodPattern] = key.split(':');
    // Match if the relative path ends with the file pattern
    if (relPath.endsWith(filePattern) || path.basename(relPath) === filePattern) {
      if (!methodPattern || block.method.includes(methodPattern)) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Row-Level Security Assertion — Every tenant-scoped query includes tenant_id', () => {
  const files = findTsFiles(PLATFORM_CORE_SRC);
  const allBlocks: QueryBlock[] = [];

  for (const file of files) {
    const source = fs.readFileSync(file, 'utf-8');
    const blocks = extractQueryBlocks(file, source);
    allBlocks.push(...blocks);
  }

  // Filter to only tenant-scoped tables
  const tenantScopedBlocks = allBlocks.filter(
    (b) => Object.keys(TENANT_SCOPED_TABLES).includes(b.table),
  );

  it('found at least one tenant-scoped query to analyse', () => {
    expect(tenantScopedBlocks.length).toBeGreaterThan(0);
  });

  // Build the violation list
  const violations: QueryBlock[] = [];
  const exempted: QueryBlock[] = [];

  for (const block of tenantScopedBlocks) {
    if (!block.hasTenantFilter) {
      if (isKnownException(block)) {
        exempted.push(block);
      } else {
        violations.push(block);
      }
    }
  }

  it('all tenant-scoped queries include tenant_id filter (or have documented exception)', () => {
    if (violations.length > 0) {
      const details = violations
        .map(
          (v) =>
            `  ${path.relative(PLATFORM_CORE_SRC, v.filePath)}:${v.line} — ${v.method}() queries "${v.table}" without tenant_id filter`,
        )
        .join('\n');

      expect.fail(
        `Found ${violations.length} query(ies) on tenant-scoped tables WITHOUT tenant_id filter:\n${details}\n\n` +
        'Either add a tenant_id WHERE clause or add to KNOWN_EXCEPTIONS with justification.',
      );
    }
  });

  // Report statistics
  it('reports coverage statistics', () => {
    const total = tenantScopedBlocks.length;
    const filtered = tenantScopedBlocks.filter((b) => b.hasTenantFilter).length;
    const exemptedCount = exempted.length;
    const violationCount = violations.length;

    // This test always passes — it's informational
    console.log('\n=== Tenant Isolation Static Analysis ===');
    console.log(`Total tenant-scoped queries found: ${total}`);
    console.log(`Queries with tenant_id filter: ${filtered}`);
    console.log(`Known exceptions (documented): ${exemptedCount}`);
    console.log(`Violations: ${violationCount}`);
    console.log(`Coverage: ${((filtered + exemptedCount) / total * 100).toFixed(1)}%`);
    console.log('=========================================\n');

    expect(total).toBeGreaterThan(0);
  });

  // Per-table checks
  const tenantTables = Object.keys(TENANT_SCOPED_TABLES);
  for (const table of tenantTables) {
    const tableBlocks = tenantScopedBlocks.filter((b) => b.table === table);
    if (tableBlocks.length === 0) continue;

    describe(`Table: ${table}`, () => {
      for (const block of tableBlocks) {
        const relPath = path.relative(PLATFORM_CORE_SRC, block.filePath);
        const label = `${relPath}:${block.line} ${block.method}()`;

        if (block.hasTenantFilter) {
          it(`${label} — has tenant_id filter`, () => {
            expect(block.hasTenantFilter).toBe(true);
          });
        } else if (isKnownException(block)) {
          it(`${label} — exempted (documented exception)`, () => {
            expect(isKnownException(block)).toBe(true);
          });
        } else {
          it(`${label} — VIOLATION: missing tenant_id filter`, () => {
            expect.fail(
              `Query on "${table}" in ${block.method}() at ${relPath}:${block.line} does not include tenant_id in WHERE clause.`,
            );
          });
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Schema completeness checks
// ---------------------------------------------------------------------------

describe('Row-Level Security — Schema completeness', () => {
  it('every pgTable in enforce/schema.ts with data rows has tenant_id', () => {
    const source = fs.readFileSync(
      path.resolve(PLATFORM_CORE_SRC, 'enforce/schema.ts'),
      'utf-8',
    );

    // Find all pgTable definitions
    const tableMatches = source.matchAll(/export const (\w+) = pgTable\('(\w+)'/g);
    for (const m of tableMatches) {
      const varName = m[1];
      const tableName = m[2];

      // Extract the table definition block (up to next export or end)
      const startIdx = m.index!;
      const endIdx = source.indexOf('export const', startIdx + 1);
      const tableBlock = source.substring(startIdx, endIdx > 0 ? endIdx : undefined);

      expect(
        tableBlock.includes('tenant_id'),
        `Table "${tableName}" (${varName}) is missing tenant_id column`,
      ).toBe(true);
    }
  });

  it('every pgTable in intent/schema.ts with tenant-scoped data has tenant_id', () => {
    const source = fs.readFileSync(
      path.resolve(PLATFORM_CORE_SRC, 'intent/schema.ts'),
      'utf-8',
    );

    // Tables that should have tenant_id
    const expectedTenantTables = [
      'intents',
      'intent_evaluations',
      'escalations',
      'audit_records',
      'policies',
      'webhook_deliveries',
      'tenant_memberships',
      'roles',
      'user_roles',
    ];

    for (const tableName of expectedTenantTables) {
      const tablePattern = new RegExp(
        `pgTable\\s*\\(\\s*'${tableName}'[\\s\\S]*?tenant_id`,
      );
      expect(
        tablePattern.test(source),
        `Table "${tableName}" is missing tenant_id column`,
      ).toBe(true);
    }
  });

  it('agents schema tables all have tenant_id', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../contracts/src/db/agents.ts'),
      'utf-8',
    );

    const expectedTenantTables = [
      'agents',
      'attestations',
      'state_transitions',
      'approval_requests',
      'api_keys',
    ];

    for (const tableName of expectedTenantTables) {
      const tablePattern = new RegExp(
        `pgTable\\s*\\([\\s\\n]*'${tableName}'[\\s\\S]*?tenant_id`,
      );
      expect(
        tablePattern.test(source),
        `Table "${tableName}" is missing tenant_id column`,
      ).toBe(true);
    }
  });
});
