/**
 * System Isolation Action
 *
 * Automated system isolation for incident containment.
 * Provides network isolation, session termination, and access restriction.
 *
 * @packageDocumentation
 * @module security/incident/actions/isolate-system
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../../common/logger.js';
import type { ActionDefinition, ActionContext, ActionResult } from '../types.js';

const logger = createLogger({ component: 'action-isolate-system' });

// ============================================================================
// Isolation Types
// ============================================================================

export interface IsolationTarget {
  type: 'server' | 'container' | 'service' | 'network_segment' | 'user_account';
  identifier: string;
  metadata?: Record<string, unknown>;
}

export interface IsolationResult {
  targetId: string;
  isolated: boolean;
  method: string;
  previousState: Record<string, unknown>;
  timestamp: Date;
}

export interface IsolationRollbackData {
  isolations: IsolationResult[];
  incidentId: string;
}

// ============================================================================
// Isolation Service Interface
// ============================================================================

export interface IsolationService {
  /** Isolate a network segment by applying firewall rules */
  isolateNetworkSegment(segmentId: string): Promise<{ success: boolean; previousRules: unknown[] }>;

  /** Remove a container/service from network */
  isolateContainer(containerId: string): Promise<{ success: boolean; previousNetwork: string }>;

  /** Block external access to a server */
  isolateServer(serverId: string): Promise<{ success: boolean; previousConfig: Record<string, unknown> }>;

  /** Disable a user account */
  disableUserAccount(userId: string): Promise<{ success: boolean; previousStatus: string }>;

  /** Restore network segment */
  restoreNetworkSegment(segmentId: string, previousRules: unknown[]): Promise<boolean>;

  /** Restore container network */
  restoreContainer(containerId: string, previousNetwork: string): Promise<boolean>;

  /** Restore server access */
  restoreServer(serverId: string, previousConfig: Record<string, unknown>): Promise<boolean>;

  /** Re-enable user account */
  enableUserAccount(userId: string): Promise<boolean>;
}

// ============================================================================
// Default Mock Isolation Service
// ============================================================================

class MockIsolationService implements IsolationService {
  async isolateNetworkSegment(segmentId: string): Promise<{ success: boolean; previousRules: unknown[] }> {
    logger.info('Isolating network segment', { segmentId });
    // Simulate network isolation
    await this.simulateOperation(1000);
    return { success: true, previousRules: [{ rule: 'allow-all', segment: segmentId }] };
  }

  async isolateContainer(containerId: string): Promise<{ success: boolean; previousNetwork: string }> {
    logger.info('Isolating container', { containerId });
    await this.simulateOperation(500);
    return { success: true, previousNetwork: 'production-network' };
  }

  async isolateServer(serverId: string): Promise<{ success: boolean; previousConfig: Record<string, unknown> }> {
    logger.info('Isolating server', { serverId });
    await this.simulateOperation(1500);
    return {
      success: true,
      previousConfig: {
        firewall: 'open',
        publicAccess: true,
        loadBalancerPool: 'production'
      }
    };
  }

  async disableUserAccount(userId: string): Promise<{ success: boolean; previousStatus: string }> {
    logger.info('Disabling user account', { userId });
    await this.simulateOperation(300);
    return { success: true, previousStatus: 'active' };
  }

  async restoreNetworkSegment(segmentId: string, previousRules: unknown[]): Promise<boolean> {
    logger.info('Restoring network segment', { segmentId, ruleCount: previousRules.length });
    await this.simulateOperation(800);
    return true;
  }

  async restoreContainer(containerId: string, previousNetwork: string): Promise<boolean> {
    logger.info('Restoring container network', { containerId, previousNetwork });
    await this.simulateOperation(400);
    return true;
  }

  async restoreServer(serverId: string, _previousConfig: Record<string, unknown>): Promise<boolean> {
    logger.info('Restoring server access', { serverId });
    await this.simulateOperation(1200);
    return true;
  }

  async enableUserAccount(userId: string): Promise<boolean> {
    logger.info('Re-enabling user account', { userId });
    await this.simulateOperation(300);
    return true;
  }

  private simulateOperation(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton Isolation Service
// ============================================================================

let isolationService: IsolationService | null = null;

export function setIsolationService(service: IsolationService): void {
  isolationService = service;
}

export function getIsolationService(): IsolationService {
  if (!isolationService) {
    throw new Error(
      'No isolation service configured. Call setIsolationService() with a real implementation before use. ' +
      'For tests, use createMockIsolationService().'
    );
  }
  return isolationService;
}

/** Create a mock isolation service for testing only. */
export function createMockIsolationService(): IsolationService {
  return new MockIsolationService();
}

// ============================================================================
// Action Implementation
// ============================================================================

async function executeIsolation(context: ActionContext): Promise<ActionResult> {
  const { incident, logger: actionLogger, setVariable } = context;
  const startTime = Date.now();
  const results: IsolationResult[] = [];

  actionLogger.info('Starting system isolation', {
    affectedResources: incident.affectedResources,
  });

  try {
    // Parse affected resources to determine isolation targets
    const targets = parseIsolationTargets(incident.affectedResources, incident.metadata);

    if (targets.length === 0) {
      actionLogger.warn('No isolation targets identified');
      return {
        success: true,
        output: { message: 'No isolation targets identified', results: [] },
        metrics: { durationMs: Date.now() - startTime, itemsProcessed: 0 },
        canRollback: false,
      };
    }

    let successCount = 0;
    let failureCount = 0;

    for (const target of targets) {
      try {
        const result = await isolateTarget(target, actionLogger);
        results.push(result);

        if (result.isolated) {
          successCount++;
          actionLogger.info('Target isolated successfully', {
            targetType: target.type,
            targetId: target.identifier,
          });
        } else {
          failureCount++;
          actionLogger.error('Failed to isolate target', {
            targetType: target.type,
            targetId: target.identifier,
          });
        }
      } catch (error) {
        failureCount++;
        actionLogger.error('Error isolating target', {
          targetType: target.type,
          targetId: target.identifier,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Store results for rollback
    const rollbackData: IsolationRollbackData = {
      isolations: results.filter((r) => r.isolated),
      incidentId: incident.id,
    };
    setVariable('isolation_results', results);

    const success = failureCount === 0;
    const durationMs = Date.now() - startTime;

    actionLogger.info('System isolation completed', {
      success,
      successCount,
      failureCount,
      durationMs,
    });

    return {
      success,
      output: {
        message: success
          ? `Successfully isolated ${successCount} target(s)`
          : `Isolation completed with ${failureCount} failure(s)`,
        results,
        successCount,
        failureCount,
      },
      metrics: {
        durationMs,
        itemsProcessed: successCount,
        itemsFailed: failureCount,
      },
      canRollback: results.some((r) => r.isolated),
      rollbackData,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    actionLogger.error('System isolation failed', { error: errorMessage });

    return {
      success: false,
      error: errorMessage,
      metrics: { durationMs: Date.now() - startTime },
      canRollback: results.some((r) => r.isolated),
      rollbackData: {
        isolations: results.filter((r) => r.isolated),
        incidentId: incident.id,
      },
    };
  }
}

async function rollbackIsolation(
  context: ActionContext,
  rollbackData: unknown
): Promise<ActionResult> {
  const { logger: actionLogger } = context;
  const startTime = Date.now();
  const data = rollbackData as IsolationRollbackData;

  actionLogger.info('Starting isolation rollback', {
    isolationCount: data.isolations.length,
  });

  let successCount = 0;
  let failureCount = 0;

  for (const isolation of data.isolations) {
    try {
      const restored = await restoreTarget(isolation, actionLogger);
      if (restored) {
        successCount++;
        actionLogger.info('Target restored', { targetId: isolation.targetId });
      } else {
        failureCount++;
        actionLogger.error('Failed to restore target', { targetId: isolation.targetId });
      }
    } catch (error) {
      failureCount++;
      actionLogger.error('Error restoring target', {
        targetId: isolation.targetId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    success: failureCount === 0,
    output: {
      message: `Restored ${successCount} of ${data.isolations.length} isolated targets`,
      successCount,
      failureCount,
    },
    metrics: {
      durationMs: Date.now() - startTime,
      itemsProcessed: successCount,
      itemsFailed: failureCount,
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function parseIsolationTargets(
  affectedResources: string[],
  metadata?: Record<string, unknown>
): IsolationTarget[] {
  const targets: IsolationTarget[] = [];

  for (const resource of affectedResources) {
    // Parse resource identifiers
    if (resource.startsWith('server:')) {
      targets.push({
        type: 'server',
        identifier: resource.replace('server:', ''),
      });
    } else if (resource.startsWith('container:')) {
      targets.push({
        type: 'container',
        identifier: resource.replace('container:', ''),
      });
    } else if (resource.startsWith('service:')) {
      targets.push({
        type: 'service',
        identifier: resource.replace('service:', ''),
      });
    } else if (resource.startsWith('network:')) {
      targets.push({
        type: 'network_segment',
        identifier: resource.replace('network:', ''),
      });
    } else if (resource.startsWith('user:')) {
      targets.push({
        type: 'user_account',
        identifier: resource.replace('user:', ''),
      });
    }
  }

  // Also check metadata for additional targets
  const additionalTargets = metadata?.['isolationTargets'] as IsolationTarget[] | undefined;
  if (additionalTargets) {
    targets.push(...additionalTargets);
  }

  return targets;
}

async function isolateTarget(
  target: IsolationTarget,
  actionLogger: ActionContext['logger']
): Promise<IsolationResult> {
  const service = getIsolationService();
  const result: IsolationResult = {
    targetId: `${target.type}:${target.identifier}`,
    isolated: false,
    method: '',
    previousState: {},
    timestamp: new Date(),
  };

  switch (target.type) {
    case 'server': {
      const serverResult = await service.isolateServer(target.identifier);
      result.isolated = serverResult.success;
      result.method = 'firewall_block';
      result.previousState = serverResult.previousConfig;
      break;
    }
    case 'container': {
      const containerResult = await service.isolateContainer(target.identifier);
      result.isolated = containerResult.success;
      result.method = 'network_disconnect';
      result.previousState = { network: containerResult.previousNetwork };
      break;
    }
    case 'service': {
      // Services are isolated by isolating their containers
      const serviceResult = await service.isolateContainer(target.identifier);
      result.isolated = serviceResult.success;
      result.method = 'service_container_isolation';
      result.previousState = { network: serviceResult.previousNetwork };
      break;
    }
    case 'network_segment': {
      const networkResult = await service.isolateNetworkSegment(target.identifier);
      result.isolated = networkResult.success;
      result.method = 'segment_firewall';
      result.previousState = { rules: networkResult.previousRules };
      break;
    }
    case 'user_account': {
      const userResult = await service.disableUserAccount(target.identifier);
      result.isolated = userResult.success;
      result.method = 'account_disable';
      result.previousState = { status: userResult.previousStatus };
      break;
    }
    default:
      actionLogger.warn('Unknown target type', { targetType: target.type });
  }

  return result;
}

async function restoreTarget(
  isolation: IsolationResult,
  actionLogger: ActionContext['logger']
): Promise<boolean> {
  const service = getIsolationService();
  const [type, identifier] = isolation.targetId.split(':');

  switch (type) {
    case 'server':
      return service.restoreServer(
        identifier,
        isolation.previousState as Record<string, unknown>
      );
    case 'container':
    case 'service':
      return service.restoreContainer(
        identifier,
        isolation.previousState['network'] as string
      );
    case 'network_segment':
      return service.restoreNetworkSegment(
        identifier,
        isolation.previousState['rules'] as unknown[]
      );
    case 'user_account':
      return service.enableUserAccount(identifier);
    default:
      actionLogger.warn('Unknown isolation type for restore', { type });
      return false;
  }
}

// ============================================================================
// Action Definition Export
// ============================================================================

export const isolateSystemAction: ActionDefinition = {
  id: 'isolate-system',
  name: 'Isolate Affected Systems',
  description: 'Automatically isolate affected systems to prevent further damage or data exfiltration',
  category: 'containment',
  riskLevel: 'high',
  requiresApproval: true,
  supportsRollback: true,
  defaultTimeoutMs: 120000, // 2 minutes
  maxRetries: 2,
  execute: executeIsolation,
  rollback: rollbackIsolation,
  validate: async (context) => {
    const { incident } = context;

    // Check if there are resources to isolate
    if (!incident.affectedResources || incident.affectedResources.length === 0) {
      return {
        valid: false,
        reason: 'No affected resources specified for isolation',
      };
    }

    // Check if any resources can be isolated
    const targets = parseIsolationTargets(incident.affectedResources, incident.metadata);
    if (targets.length === 0) {
      return {
        valid: false,
        reason: 'No isolatable resources found in affected resources list',
      };
    }

    return { valid: true };
  },
};

export default isolateSystemAction;
