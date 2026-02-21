/**
 * Filesystem Policy Enforcer
 *
 * Implements filesystem isolation policies for sandboxed agent execution.
 * Supports overlay filesystems, mount namespaces, and access control.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import {
  type FilesystemPolicy,
  type MountConfig,
  type FilesystemActivityLog,
  FilesystemAccessLevel,
} from './types.js';

const logger = createLogger({ component: 'filesystem-policy' });

// ============================================================================
// Types
// ============================================================================

/**
 * Overlay filesystem configuration
 */
export interface OverlayMount {
  /** Lower layer (read-only base) */
  lowerDir: string;

  /** Upper layer (writes go here) */
  upperDir: string;

  /** Work directory for overlay operations */
  workDir: string;

  /** Final merged mount point */
  mergedDir: string;
}

/**
 * Access control entry
 */
export interface AccessControlEntry {
  /** Path pattern (glob-style) */
  path: string;

  /** Allowed operations */
  operations: ('read' | 'write' | 'execute' | 'delete')[];

  /** Allow or deny */
  effect: 'allow' | 'deny';

  /** Priority (higher = processed first) */
  priority: number;
}

/**
 * Filesystem mount state
 */
export interface MountState {
  sandboxId: string;
  policy: FilesystemPolicy;
  overlay: OverlayMount;
  mounts: ActiveMount[];
  quotaUsed: number;
  inodesUsed: number;
  accessControl: AccessControlEntry[];
}

/**
 * Active mount information
 */
export interface ActiveMount {
  source: string;
  target: string;
  readonly: boolean;
  type: string;
  mounted: boolean;
}

// ============================================================================
// Filesystem Policy Enforcer
// ============================================================================

export class FilesystemPolicyEnforcer {
  private mounts: Map<string, MountState> = new Map();
  private activityLogs: Map<string, FilesystemActivityLog[]> = new Map();

  constructor() {
    logger.info('Filesystem policy enforcer initialized');
  }

  // ==========================================================================
  // Mount Management
  // ==========================================================================

  /**
   * Initialize filesystem isolation for a sandbox
   */
  async initializeFilesystem(
    sandboxId: string,
    policy: FilesystemPolicy
  ): Promise<MountState> {
    // Create overlay filesystem structure
    const overlay: OverlayMount = {
      lowerDir: policy.overlay.baseLayer,
      upperDir: `${policy.sandboxRoot}/upper`,
      workDir: `${policy.sandboxRoot}/work`,
      mergedDir: `${policy.sandboxRoot}/merged`,
    };

    // Build access control rules based on policy
    const accessControl = this.buildAccessControl(policy);

    // Process mount configurations
    const mounts: ActiveMount[] = [];
    for (const mountConfig of policy.mounts) {
      const activeMount: ActiveMount = {
        source: mountConfig.source,
        target: mountConfig.target,
        readonly: mountConfig.readonly,
        type: mountConfig.type,
        mounted: false,
      };

      // In production, this would:
      // - Create mount namespace
      // - Mount overlay filesystem
      // - Bind mount additional paths
      // - Set up quota enforcement

      activeMount.mounted = true;
      mounts.push(activeMount);
    }

    const state: MountState = {
      sandboxId,
      policy,
      overlay,
      mounts,
      quotaUsed: 0,
      inodesUsed: 0,
      accessControl,
    };

    this.mounts.set(sandboxId, state);
    this.activityLogs.set(sandboxId, []);

    logger.info(
      { sandboxId, mountCount: mounts.length, accessLevel: policy.accessLevel },
      'Filesystem initialized'
    );

    return state;
  }

  /**
   * Cleanup filesystem mounts for a sandbox
   */
  async cleanupFilesystem(sandboxId: string): Promise<void> {
    const state = this.mounts.get(sandboxId);
    if (!state) return;

    // In production, unmount all mounts and clean up
    // umount -l $mergedDir
    // rm -rf $sandboxRoot

    this.mounts.delete(sandboxId);
    this.activityLogs.delete(sandboxId);

    logger.info({ sandboxId }, 'Filesystem cleaned up');
  }

  // ==========================================================================
  // Access Control
  // ==========================================================================

  /**
   * Build access control rules from policy
   */
  private buildAccessControl(policy: FilesystemPolicy): AccessControlEntry[] {
    const rules: AccessControlEntry[] = [];

    // Default deny all
    rules.push({
      path: '/**',
      operations: ['read', 'write', 'execute', 'delete'],
      effect: 'deny',
      priority: 0,
    });

    switch (policy.accessLevel) {
      case FilesystemAccessLevel.READONLY_SANDBOX:
        // Only read from base layer
        rules.push({
          path: '/**',
          operations: ['read', 'execute'],
          effect: 'allow',
          priority: 10,
        });
        // Allow writes to /tmp only
        rules.push({
          path: '/tmp/**',
          operations: ['read', 'write', 'delete'],
          effect: 'allow',
          priority: 20,
        });
        break;

      case FilesystemAccessLevel.WORKSPACE:
        // Read anywhere, write to workspace
        rules.push({
          path: '/**',
          operations: ['read', 'execute'],
          effect: 'allow',
          priority: 10,
        });
        rules.push({
          path: '/workspace/**',
          operations: ['read', 'write', 'delete'],
          effect: 'allow',
          priority: 20,
        });
        rules.push({
          path: '/tmp/**',
          operations: ['read', 'write', 'delete'],
          effect: 'allow',
          priority: 20,
        });
        break;

      case FilesystemAccessLevel.EXTENDED:
        // Read anywhere, write to allowed paths
        rules.push({
          path: '/**',
          operations: ['read', 'execute'],
          effect: 'allow',
          priority: 10,
        });
        for (const mount of policy.mounts) {
          if (!mount.readonly) {
            rules.push({
              path: `${mount.target}/**`,
              operations: ['read', 'write', 'delete'],
              effect: 'allow',
              priority: 20,
            });
          }
        }
        break;

      case FilesystemAccessLevel.FULL:
        // Full access (still audited)
        rules.push({
          path: '/**',
          operations: ['read', 'write', 'execute', 'delete'],
          effect: 'allow',
          priority: 100,
        });
        break;
    }

    // Always deny access to sensitive paths
    const sensitivePaths = [
      '/etc/shadow',
      '/etc/passwd',
      '/etc/sudoers',
      '/root/**',
      '/proc/*/mem',
      '/dev/mem',
      '/dev/kmem',
      '/sys/**',
    ];

    for (const path of sensitivePaths) {
      rules.push({
        path,
        operations: ['read', 'write', 'execute', 'delete'],
        effect: 'deny',
        priority: 1000, // High priority = always applied
      });
    }

    // Sort by priority descending
    rules.sort((a, b) => b.priority - a.priority);

    return rules;
  }

  /**
   * Check if an operation is allowed
   */
  checkAccess(
    sandboxId: string,
    path: string,
    operation: 'read' | 'write' | 'execute' | 'delete'
  ): { allowed: boolean; reason?: string } {
    const state = this.mounts.get(sandboxId);
    if (!state) {
      return { allowed: false, reason: 'Sandbox not found' };
    }

    // Normalize path
    const normalizedPath = this.normalizePath(path);

    // Check against access control rules
    for (const rule of state.accessControl) {
      if (this.pathMatches(normalizedPath, rule.path)) {
        if (rule.operations.includes(operation)) {
          if (rule.effect === 'allow') {
            return { allowed: true };
          } else {
            return {
              allowed: false,
              reason: `Access denied by policy: ${rule.path}`,
            };
          }
        }
      }
    }

    // Default deny if no rule matched
    return { allowed: false, reason: 'No matching access rule' };
  }

  /**
   * Normalize a filesystem path
   */
  private normalizePath(path: string): string {
    // Remove duplicate slashes, resolve . and ..
    const parts = path.split('/').filter((p) => p && p !== '.');
    const normalized: string[] = [];

    for (const part of parts) {
      if (part === '..') {
        normalized.pop();
      } else {
        normalized.push(part);
      }
    }

    return '/' + normalized.join('/');
  }

  /**
   * Check if path matches a pattern
   */
  private pathMatches(path: string, pattern: string): boolean {
    // Simple glob matching
    if (pattern === '/**') return true;

    const patternParts = pattern.split('/');
    const pathParts = path.split('/');

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const pathPart = pathParts[i];

      if (patternPart === '**') {
        // ** matches any remaining path
        return true;
      }

      if (patternPart === '*') {
        // * matches any single segment
        if (!pathPart) return false;
        continue;
      }

      if (patternPart !== pathPart) {
        return false;
      }
    }

    return patternParts.length === pathParts.length;
  }

  // ==========================================================================
  // Quota Management
  // ==========================================================================

  /**
   * Check and update quota usage
   */
  checkQuota(
    sandboxId: string,
    bytesToWrite: number
  ): { allowed: boolean; reason?: string } {
    const state = this.mounts.get(sandboxId);
    if (!state) {
      return { allowed: false, reason: 'Sandbox not found' };
    }

    const quota = state.policy.quotas;

    // Check if unlimited
    if (quota.maxBytes === -1) {
      return { allowed: true };
    }

    // Check bytes quota
    if (state.quotaUsed + bytesToWrite > quota.maxBytes) {
      return { allowed: false, reason: 'Disk quota exceeded' };
    }

    // Check warning threshold
    const usagePercent = (state.quotaUsed + bytesToWrite) / quota.maxBytes;
    if (usagePercent > quota.warnThreshold) {
      logger.warn(
        { sandboxId, usagePercent, quotaUsed: state.quotaUsed },
        'Disk quota warning threshold reached'
      );
    }

    return { allowed: true };
  }

  /**
   * Update quota usage after write
   */
  updateQuota(sandboxId: string, bytesWritten: number, inodesUsed: number = 0): void {
    const state = this.mounts.get(sandboxId);
    if (!state) return;

    state.quotaUsed += bytesWritten;
    state.inodesUsed += inodesUsed;
  }

  /**
   * Get current quota usage
   */
  getQuotaUsage(sandboxId: string): {
    bytesUsed: number;
    bytesLimit: number;
    inodesUsed: number;
    inodesLimit: number;
    percentUsed: number;
  } | null {
    const state = this.mounts.get(sandboxId);
    if (!state) return null;

    const quota = state.policy.quotas;

    return {
      bytesUsed: state.quotaUsed,
      bytesLimit: quota.maxBytes,
      inodesUsed: state.inodesUsed,
      inodesLimit: quota.maxInodes,
      percentUsed: quota.maxBytes > 0 ? state.quotaUsed / quota.maxBytes : 0,
    };
  }

  // ==========================================================================
  // Activity Logging
  // ==========================================================================

  /**
   * Log filesystem activity
   */
  logActivity(
    sandboxId: string,
    operation: 'read' | 'write' | 'delete' | 'create' | 'chmod',
    path: string,
    allowed: boolean,
    bytes?: number,
    blockedReason?: string
  ): void {
    const logs = this.activityLogs.get(sandboxId) || [];

    logs.push({
      timestamp: new Date(),
      operation,
      path,
      bytes,
      allowed,
      blockedReason,
    });

    // Keep only last 1000 entries
    if (logs.length > 1000) {
      logs.splice(0, logs.length - 1000);
    }

    this.activityLogs.set(sandboxId, logs);

    if (!allowed) {
      logger.warn({ sandboxId, operation, path, blockedReason }, 'Filesystem access blocked');
    }
  }

  /**
   * Get activity logs for a sandbox
   */
  getActivityLogs(sandboxId: string): FilesystemActivityLog[] {
    return this.activityLogs.get(sandboxId) || [];
  }

  // ==========================================================================
  // Secrets Handling
  // ==========================================================================

  /**
   * Mount secrets for a sandbox
   */
  async mountSecrets(sandboxId: string): Promise<void> {
    const state = this.mounts.get(sandboxId);
    if (!state) return;

    // Only mount secrets if tier allows
    if (!this.canAccessSecrets(state.policy.accessLevel)) {
      logger.debug({ sandboxId }, 'Secrets access not allowed for this tier');
      return;
    }

    for (const secret of state.policy.secrets) {
      switch (secret.type) {
        case 'env':
          // Would set environment variable in container
          logger.debug({ sandboxId, name: secret.name, type: 'env' }, 'Secret mounted as env');
          break;

        case 'file':
          // Would mount secret as file (tmpfs, memory-only)
          logger.debug(
            { sandboxId, name: secret.name, path: secret.filePath },
            'Secret mounted as file'
          );
          break;

        case 'memory':
          // Would make available via memory-mapped file
          logger.debug({ sandboxId, name: secret.name }, 'Secret available in memory');
          break;
      }
    }
  }

  /**
   * Check if tier can access secrets
   */
  private canAccessSecrets(level: FilesystemAccessLevel): boolean {
    return level !== FilesystemAccessLevel.READONLY_SANDBOX;
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get filesystem statistics for a sandbox
   */
  getStats(sandboxId: string): {
    totalReads: number;
    totalWrites: number;
    totalBytesWritten: number;
    blockedOperations: number;
    mountCount: number;
  } | null {
    const state = this.mounts.get(sandboxId);
    const logs = this.activityLogs.get(sandboxId);

    if (!state || !logs) return null;

    const totalReads = logs.filter((l) => l.operation === 'read').length;
    const totalWrites = logs.filter(
      (l) => l.operation === 'write' || l.operation === 'create'
    ).length;
    const totalBytesWritten = logs
      .filter((l) => l.operation === 'write' && l.bytes)
      .reduce((sum, l) => sum + (l.bytes || 0), 0);
    const blockedOperations = logs.filter((l) => !l.allowed).length;

    return {
      totalReads,
      totalWrites,
      totalBytesWritten,
      blockedOperations,
      mountCount: state.mounts.length,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let instance: FilesystemPolicyEnforcer | null = null;

export function createFilesystemPolicyEnforcer(): FilesystemPolicyEnforcer {
  if (!instance) {
    instance = new FilesystemPolicyEnforcer();
  }
  return instance;
}

export function getFilesystemPolicyEnforcer(): FilesystemPolicyEnforcer {
  if (!instance) {
    throw new Error('FilesystemPolicyEnforcer not initialized');
  }
  return instance;
}
