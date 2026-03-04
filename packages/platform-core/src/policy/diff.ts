/**
 * Policy Diff Utility
 *
 * Provides deep comparison of policy definitions with human-readable summaries.
 * Supports comparing any two versions of a policy to understand what changed.
 *
 * @packageDocumentation
 */

import type { PolicyDefinition, PolicyRule, PolicyCondition } from './types.js';

/**
 * Type of change detected
 */
export type ChangeType = 'added' | 'removed' | 'changed';

/**
 * Single change in a diff result
 */
export interface DiffChange {
  /** JSON path to the changed value (e.g., "rules[0].name") */
  path: string;

  /** Value before the change (undefined if added) */
  before: unknown;

  /** Value after the change (undefined if removed) */
  after: unknown;

  /** Type of change */
  type: ChangeType;
}

/**
 * Complete diff result between two policy versions
 */
export interface PolicyDiffResult {
  /** Whether any changes were detected */
  hasChanges: boolean;

  /** Total number of changes */
  changeCount: number;

  /** List of individual changes */
  changes: DiffChange[];

  /** Human-readable summary of the changes */
  summary: string;

  /** Categorized changes for easier consumption */
  categorized: {
    rules: DiffChange[];
    target: DiffChange[];
    metadata: DiffChange[];
    other: DiffChange[];
  };
}

/**
 * Deep diff two objects and return a list of changes
 */
function deepDiff(
  before: unknown,
  after: unknown,
  path: string = ''
): DiffChange[] {
  const changes: DiffChange[] = [];

  // Handle null/undefined cases
  if (before === after) {
    return changes;
  }

  if (before === null || before === undefined) {
    if (after !== null && after !== undefined) {
      changes.push({ path: path || 'root', before, after, type: 'added' });
    }
    return changes;
  }

  if (after === null || after === undefined) {
    changes.push({ path: path || 'root', before, after, type: 'removed' });
    return changes;
  }

  // Handle different types
  const beforeType = typeof before;
  const afterType = typeof after;

  if (beforeType !== afterType) {
    changes.push({ path: path || 'root', before, after, type: 'changed' });
    return changes;
  }

  // Handle primitives
  if (beforeType !== 'object') {
    if (before !== after) {
      changes.push({ path: path || 'root', before, after, type: 'changed' });
    }
    return changes;
  }

  // Handle arrays
  if (Array.isArray(before) && Array.isArray(after)) {
    return diffArrays(before, after, path);
  }

  // Handle arrays vs objects
  if (Array.isArray(before) !== Array.isArray(after)) {
    changes.push({ path: path || 'root', before, after, type: 'changed' });
    return changes;
  }

  // Handle objects
  const beforeObj = before as Record<string, unknown>;
  const afterObj = after as Record<string, unknown>;

  const allKeys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);

  for (const key of allKeys) {
    const keyPath = path ? `${path}.${key}` : key;
    const beforeValue = beforeObj[key];
    const afterValue = afterObj[key];

    if (!(key in beforeObj)) {
      changes.push({ path: keyPath, before: undefined, after: afterValue, type: 'added' });
    } else if (!(key in afterObj)) {
      changes.push({ path: keyPath, before: beforeValue, after: undefined, type: 'removed' });
    } else {
      changes.push(...deepDiff(beforeValue, afterValue, keyPath));
    }
  }

  return changes;
}

/**
 * Diff two arrays, attempting to match elements by ID if available
 */
function diffArrays(
  before: unknown[],
  after: unknown[],
  path: string
): DiffChange[] {
  const changes: DiffChange[] = [];

  // Try to match by ID if elements have an 'id' property
  const beforeHasIds = before.every(
    (item) => item !== null && typeof item === 'object' && 'id' in (item as Record<string, unknown>)
  );
  const afterHasIds = after.every(
    (item) => item !== null && typeof item === 'object' && 'id' in (item as Record<string, unknown>)
  );

  if (beforeHasIds && afterHasIds) {
    return diffArraysById(
      before as Array<Record<string, unknown>>,
      after as Array<Record<string, unknown>>,
      path
    );
  }

  // Fall back to positional comparison
  const maxLength = Math.max(before.length, after.length);

  for (let i = 0; i < maxLength; i++) {
    const itemPath = `${path}[${i}]`;

    if (i >= before.length) {
      changes.push({ path: itemPath, before: undefined, after: after[i], type: 'added' });
    } else if (i >= after.length) {
      changes.push({ path: itemPath, before: before[i], after: undefined, type: 'removed' });
    } else {
      changes.push(...deepDiff(before[i], after[i], itemPath));
    }
  }

  return changes;
}

/**
 * Diff arrays by matching elements with the same ID
 */
function diffArraysById(
  before: Array<Record<string, unknown>>,
  after: Array<Record<string, unknown>>,
  path: string
): DiffChange[] {
  const changes: DiffChange[] = [];

  const beforeMap = new Map(before.map((item) => [item.id as string, item]));
  const afterMap = new Map(after.map((item) => [item.id as string, item]));

  // Find removed items
  for (const [id, item] of beforeMap) {
    if (!afterMap.has(id)) {
      const index = before.findIndex((b) => b.id === id);
      changes.push({
        path: `${path}[${index}]`,
        before: item,
        after: undefined,
        type: 'removed',
      });
    }
  }

  // Find added and changed items
  for (const [id, item] of afterMap) {
    const beforeItem = beforeMap.get(id);
    const afterIndex = after.findIndex((a) => a.id === id);

    if (!beforeItem) {
      changes.push({
        path: `${path}[${afterIndex}]`,
        before: undefined,
        after: item,
        type: 'added',
      });
    } else {
      const beforeIndex = before.findIndex((b) => b.id === id);
      changes.push(...deepDiff(beforeItem, item, `${path}[${beforeIndex}]`));
    }
  }

  return changes;
}

/**
 * Categorize changes by their path prefix
 */
function categorizeChanges(changes: DiffChange[]): PolicyDiffResult['categorized'] {
  const categorized: PolicyDiffResult['categorized'] = {
    rules: [],
    target: [],
    metadata: [],
    other: [],
  };

  for (const change of changes) {
    if (change.path.startsWith('rules')) {
      categorized.rules.push(change);
    } else if (change.path.startsWith('target')) {
      categorized.target.push(change);
    } else if (change.path.startsWith('metadata')) {
      categorized.metadata.push(change);
    } else {
      categorized.other.push(change);
    }
  }

  return categorized;
}

/**
 * Generate a human-readable summary of the changes
 */
function generateSummary(changes: DiffChange[], categorized: PolicyDiffResult['categorized']): string {
  if (changes.length === 0) {
    return 'No changes detected';
  }

  const parts: string[] = [];

  // Summarize rule changes
  if (categorized.rules.length > 0) {
    const added = categorized.rules.filter((c) => c.type === 'added' && c.path.match(/^rules\[\d+\]$/));
    const removed = categorized.rules.filter((c) => c.type === 'removed' && c.path.match(/^rules\[\d+\]$/));
    const modified = categorized.rules.filter((c) => c.type === 'changed');

    const ruleSummary: string[] = [];

    if (added.length > 0) {
      const ruleNames = added
        .map((c) => {
          const rule = c.after as Record<string, unknown>;
          return rule?.name || 'unnamed';
        })
        .join(', ');
      ruleSummary.push(`added ${added.length} rule(s): ${ruleNames}`);
    }

    if (removed.length > 0) {
      const ruleNames = removed
        .map((c) => {
          const rule = c.before as Record<string, unknown>;
          return rule?.name || 'unnamed';
        })
        .join(', ');
      ruleSummary.push(`removed ${removed.length} rule(s): ${ruleNames}`);
    }

    if (modified.length > 0) {
      // Extract unique rule indices
      const modifiedRules = new Set<string>();
      for (const change of modified) {
        const match = change.path.match(/^rules\[(\d+)\]/);
        if (match) {
          modifiedRules.add(match[1]);
        }
      }
      if (modifiedRules.size > 0) {
        ruleSummary.push(`modified ${modifiedRules.size} rule(s)`);
      }
    }

    if (ruleSummary.length > 0) {
      parts.push(`Rules: ${ruleSummary.join('; ')}`);
    }
  }

  // Summarize target changes
  if (categorized.target.length > 0) {
    const targetFields = new Set(
      categorized.target.map((c) => c.path.replace('target.', '').split('[')[0])
    );
    parts.push(`Target: updated ${Array.from(targetFields).join(', ')}`);
  }

  // Summarize metadata changes
  if (categorized.metadata.length > 0) {
    parts.push(`Metadata: ${categorized.metadata.length} change(s)`);
  }

  // Summarize other changes
  if (categorized.other.length > 0) {
    const otherFields = categorized.other.map((c) => c.path.split('.')[0]);
    const uniqueFields = [...new Set(otherFields)];
    parts.push(`Other: ${uniqueFields.join(', ')}`);
  }

  return parts.join('. ');
}

/**
 * Compare two policy definitions and return detailed diff
 *
 * @param before - The earlier version of the policy definition
 * @param after - The later version of the policy definition
 * @returns Complete diff result with changes and summary
 */
export function diffPolicyDefinitions(
  before: PolicyDefinition,
  after: PolicyDefinition
): PolicyDiffResult {
  const changes = deepDiff(before, after);
  const categorized = categorizeChanges(changes);
  const summary = generateSummary(changes, categorized);

  return {
    hasChanges: changes.length > 0,
    changeCount: changes.length,
    changes,
    summary,
    categorized,
  };
}

/**
 * Format a change for display
 */
export function formatChange(change: DiffChange): string {
  switch (change.type) {
    case 'added':
      return `+ ${change.path}: ${JSON.stringify(change.after)}`;
    case 'removed':
      return `- ${change.path}: ${JSON.stringify(change.before)}`;
    case 'changed':
      return `~ ${change.path}: ${JSON.stringify(change.before)} -> ${JSON.stringify(change.after)}`;
  }
}

/**
 * Format all changes for display
 */
export function formatDiff(result: PolicyDiffResult): string {
  if (!result.hasChanges) {
    return 'No changes';
  }

  const lines = [
    `Changes: ${result.changeCount}`,
    `Summary: ${result.summary}`,
    '',
    'Details:',
    ...result.changes.map((c) => `  ${formatChange(c)}`),
  ];

  return lines.join('\n');
}

/**
 * Get a brief description of what changed between versions
 */
export function getChangeSummary(
  before: PolicyDefinition,
  after: PolicyDefinition
): string {
  const result = diffPolicyDefinitions(before, after);
  return result.summary;
}

/**
 * Check if two policy definitions are equivalent
 */
export function arePoliciesEquivalent(
  a: PolicyDefinition,
  b: PolicyDefinition
): boolean {
  const result = diffPolicyDefinitions(a, b);
  return !result.hasChanges;
}

/**
 * Extract rule-specific changes from a diff result
 */
export function getRuleChanges(result: PolicyDiffResult): {
  added: Array<{ index: number; rule: PolicyRule }>;
  removed: Array<{ index: number; rule: PolicyRule }>;
  modified: Array<{ index: number; changes: DiffChange[] }>;
} {
  const added: Array<{ index: number; rule: PolicyRule }> = [];
  const removed: Array<{ index: number; rule: PolicyRule }> = [];
  const modifiedMap = new Map<number, DiffChange[]>();

  for (const change of result.categorized.rules) {
    const indexMatch = change.path.match(/^rules\[(\d+)\]/);
    if (!indexMatch) continue;

    const index = parseInt(indexMatch[1], 10);

    // Check if this is a whole rule addition/removal
    if (change.path === `rules[${index}]`) {
      if (change.type === 'added') {
        added.push({ index, rule: change.after as PolicyRule });
      } else if (change.type === 'removed') {
        removed.push({ index, rule: change.before as PolicyRule });
      }
    } else {
      // This is a modification within a rule
      if (!modifiedMap.has(index)) {
        modifiedMap.set(index, []);
      }
      modifiedMap.get(index)!.push(change);
    }
  }

  const modified = Array.from(modifiedMap.entries()).map(([index, changes]) => ({
    index,
    changes,
  }));

  return { added, removed, modified };
}
