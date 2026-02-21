/**
 * Capability Broker
 *
 * Mediates capability requests between agents and sandbox enforcement.
 * Translates trust tier into concrete capabilities and handles runtime
 * capability elevation requests.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import {
  type TierCapabilities,
  type SandboxConfig,
  type PolicyViolation,
  NetworkAccessLevel,
  FilesystemAccessLevel,
  TIER_CAPABILITIES,
} from './types.js';

const logger = createLogger({ component: 'capability-broker' });

// ============================================================================
// Types
// ============================================================================

/**
 * Capability request from an agent
 */
export interface CapabilityRequest {
  /** Unique request ID */
  requestId: string;

  /** Requesting agent CAR ID */
  carId: string;

  /** Current sandbox ID */
  sandboxId: string;

  /** Requested capability type */
  type: CapabilityType;

  /** Specific capability details */
  details: CapabilityDetails;

  /** Justification for the request */
  justification?: string;

  /** Timestamp */
  requestedAt: Date;
}

/**
 * Capability types that can be requested
 */
export type CapabilityType =
  | 'network_egress'
  | 'filesystem_write'
  | 'spawn_subprocess'
  | 'secret_access'
  | 'agent_communication'
  | 'extended_runtime'
  | 'elevated_resources';

/**
 * Specific capability details
 */
export interface CapabilityDetails {
  // Network egress
  egressDomain?: string;
  egressPort?: number;

  // Filesystem
  writePath?: string;

  // Secret
  secretName?: string;

  // Agent communication
  targetAci?: string;

  // Resources
  additionalMemoryMb?: number;
  additionalCpuPercent?: number;
  additionalTimeMs?: number;
}

/**
 * Capability decision
 */
export interface CapabilityDecision {
  requestId: string;
  granted: boolean;
  reason: string;
  conditions?: CapabilityConditions;
  expiresAt?: Date;
}

/**
 * Conditions attached to a granted capability
 */
export interface CapabilityConditions {
  /** Maximum duration */
  maxDurationMs?: number;

  /** Maximum bytes (for network/disk) */
  maxBytes?: number;

  /** Rate limit */
  rateLimit?: number;

  /** Audit level */
  auditLevel: 'none' | 'summary' | 'detailed' | 'full';

  /** Requires human approval */
  requiresApproval?: boolean;
}

/**
 * Granted capability tracking
 */
export interface GrantedCapability {
  requestId: string;
  type: CapabilityType;
  details: CapabilityDetails;
  conditions: CapabilityConditions;
  grantedAt: Date;
  expiresAt?: Date;
  usageCount: number;
  bytesUsed: number;
}

// ============================================================================
// Capability Broker
// ============================================================================

export class CapabilityBroker {
  private grantedCapabilities: Map<string, GrantedCapability[]> = new Map();
  private pendingRequests: Map<string, CapabilityRequest[]> = new Map();

  constructor() {
    logger.info('Capability broker initialized');
  }

  // ==========================================================================
  // Capability Resolution
  // ==========================================================================

  /**
   * Get capabilities for a trust tier
   */
  getCapabilitiesForTier(trustTier: number): TierCapabilities {
    const caps = TIER_CAPABILITIES[trustTier];
    if (!caps) {
      throw new Error(`Invalid trust tier: ${trustTier}`);
    }
    return { ...caps };
  }

  /**
   * Check if a tier has a specific capability
   */
  hasCapability(trustTier: number, capability: CapabilityType): boolean {
    const caps = this.getCapabilitiesForTier(trustTier);

    switch (capability) {
      case 'network_egress':
        return caps.networkAccess !== NetworkAccessLevel.NONE;

      case 'filesystem_write':
        return caps.filesystemAccess !== FilesystemAccessLevel.READONLY_SANDBOX;

      case 'spawn_subprocess':
        return caps.canSpawnSubprocesses;

      case 'secret_access':
        return caps.canAccessSecrets;

      case 'agent_communication':
        return caps.canCommunicateWithAgents;

      case 'extended_runtime':
      case 'elevated_resources':
        return trustTier >= 4; // T4+ can request elevated resources

      default:
        return false;
    }
  }

  // ==========================================================================
  // Capability Requests
  // ==========================================================================

  /**
   * Request a capability at runtime
   */
  async requestCapability(
    sandboxId: string,
    config: SandboxConfig,
    request: Omit<CapabilityRequest, 'requestId' | 'requestedAt'>
  ): Promise<CapabilityDecision> {
    const fullRequest: CapabilityRequest = {
      ...request,
      requestId: `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      requestedAt: new Date(),
    };

    // Track the request
    const pending = this.pendingRequests.get(sandboxId) || [];
    pending.push(fullRequest);
    this.pendingRequests.set(sandboxId, pending);

    // Evaluate the request
    const decision = this.evaluateRequest(config, fullRequest);

    // Remove from pending
    const updatedPending = this.pendingRequests.get(sandboxId) || [];
    this.pendingRequests.set(
      sandboxId,
      updatedPending.filter((r) => r.requestId !== fullRequest.requestId)
    );

    // Track granted capabilities
    if (decision.granted) {
      this.trackGrantedCapability(sandboxId, fullRequest, decision);
    }

    logger.info(
      {
        sandboxId,
        requestId: fullRequest.requestId,
        type: request.type,
        granted: decision.granted,
        reason: decision.reason,
      },
      'Capability request processed'
    );

    return decision;
  }

  /**
   * Evaluate a capability request
   */
  private evaluateRequest(
    config: SandboxConfig,
    request: CapabilityRequest
  ): CapabilityDecision {
    const caps = config.capabilities;
    const tier = config.trustTier;

    // Check if capability is available at this tier
    if (!this.hasCapability(tier, request.type)) {
      return {
        requestId: request.requestId,
        granted: false,
        reason: `Capability '${request.type}' not available at trust tier ${tier}`,
      };
    }

    // Evaluate specific capability
    switch (request.type) {
      case 'network_egress':
        return this.evaluateNetworkEgress(config, request);

      case 'filesystem_write':
        return this.evaluateFilesystemWrite(config, request);

      case 'spawn_subprocess':
        return this.evaluateSubprocessSpawn(config, request);

      case 'secret_access':
        return this.evaluateSecretAccess(config, request);

      case 'agent_communication':
        return this.evaluateAgentCommunication(config, request);

      case 'extended_runtime':
      case 'elevated_resources':
        return this.evaluateResourceElevation(config, request);

      default:
        return {
          requestId: request.requestId,
          granted: false,
          reason: `Unknown capability type: ${request.type}`,
        };
    }
  }

  /**
   * Evaluate network egress request
   */
  private evaluateNetworkEgress(
    config: SandboxConfig,
    request: CapabilityRequest
  ): CapabilityDecision {
    const { egressDomain, egressPort } = request.details;
    const caps = config.capabilities;

    // Check if domain is in allowed list
    const isAllowed = caps.allowedEgressDomains.some((pattern) => {
      if (pattern === '*') return true;
      if (pattern.startsWith('*.')) {
        return egressDomain?.endsWith(pattern.slice(1));
      }
      return egressDomain === pattern;
    });

    if (!isAllowed) {
      return {
        requestId: request.requestId,
        granted: false,
        reason: `Domain '${egressDomain}' not in allowed egress list`,
      };
    }

    // Check rate limits
    const conditions: CapabilityConditions = {
      maxDurationMs: 60000, // 1 minute
      maxBytes: this.getEgressBytesLimit(config.trustTier),
      rateLimit: this.getRateLimit(config.trustTier),
      auditLevel: config.trustTier <= 3 ? 'full' : 'summary',
    };

    return {
      requestId: request.requestId,
      granted: true,
      reason: 'Egress allowed per policy',
      conditions,
      expiresAt: new Date(Date.now() + 60000),
    };
  }

  /**
   * Evaluate filesystem write request
   */
  private evaluateFilesystemWrite(
    config: SandboxConfig,
    request: CapabilityRequest
  ): CapabilityDecision {
    const { writePath } = request.details;
    const caps = config.capabilities;

    // Check if path is in allowed list
    const isAllowed = caps.allowedMountPaths.some((pattern) => {
      if (pattern === '*') return true;
      return writePath?.startsWith(pattern);
    });

    if (!isAllowed) {
      return {
        requestId: request.requestId,
        granted: false,
        reason: `Path '${writePath}' not in allowed write paths`,
      };
    }

    return {
      requestId: request.requestId,
      granted: true,
      reason: 'Write allowed per policy',
      conditions: {
        maxBytes: this.getDiskQuota(config.trustTier),
        auditLevel: 'detailed',
      },
    };
  }

  /**
   * Evaluate subprocess spawn request
   */
  private evaluateSubprocessSpawn(
    config: SandboxConfig,
    request: CapabilityRequest
  ): CapabilityDecision {
    if (!config.capabilities.canSpawnSubprocesses) {
      return {
        requestId: request.requestId,
        granted: false,
        reason: 'Subprocess spawning not allowed at this tier',
      };
    }

    return {
      requestId: request.requestId,
      granted: true,
      reason: 'Subprocess allowed per policy',
      conditions: {
        auditLevel: 'full',
      },
    };
  }

  /**
   * Evaluate secret access request
   */
  private evaluateSecretAccess(
    config: SandboxConfig,
    request: CapabilityRequest
  ): CapabilityDecision {
    if (!config.capabilities.canAccessSecrets) {
      return {
        requestId: request.requestId,
        granted: false,
        reason: 'Secret access not allowed at this tier',
      };
    }

    // T3-T4: require approval for sensitive secrets
    const conditions: CapabilityConditions = {
      auditLevel: 'full',
      requiresApproval: config.trustTier < 5,
    };

    return {
      requestId: request.requestId,
      granted: !conditions.requiresApproval, // Auto-grant for T5+
      reason: conditions.requiresApproval
        ? 'Secret access requires human approval'
        : 'Secret access granted',
      conditions,
    };
  }

  /**
   * Evaluate agent communication request
   */
  private evaluateAgentCommunication(
    config: SandboxConfig,
    request: CapabilityRequest
  ): CapabilityDecision {
    if (!config.capabilities.canCommunicateWithAgents) {
      return {
        requestId: request.requestId,
        granted: false,
        reason: 'Agent communication not allowed at this tier',
      };
    }

    return {
      requestId: request.requestId,
      granted: true,
      reason: 'Agent communication allowed per policy',
      conditions: {
        auditLevel: 'detailed',
        maxBytes: 10 * 1024 * 1024, // 10MB message limit
      },
    };
  }

  /**
   * Evaluate resource elevation request
   */
  private evaluateResourceElevation(
    config: SandboxConfig,
    request: CapabilityRequest
  ): CapabilityDecision {
    const { additionalMemoryMb, additionalCpuPercent, additionalTimeMs } = request.details;
    const caps = config.capabilities;

    // Calculate requested totals
    const requestedMemory = (additionalMemoryMb || 0) + caps.maxMemoryMb;
    const requestedCpu = (additionalCpuPercent || 0) + caps.maxCpuPercent;
    const requestedTime = (additionalTimeMs || 0) + caps.maxExecutionMs;

    // Check against hard limits (2x tier limits max)
    const maxAllowedMemory = caps.maxMemoryMb === -1 ? -1 : caps.maxMemoryMb * 2;
    const maxAllowedTime = caps.maxExecutionMs === -1 ? -1 : caps.maxExecutionMs * 2;

    if (maxAllowedMemory !== -1 && requestedMemory > maxAllowedMemory) {
      return {
        requestId: request.requestId,
        granted: false,
        reason: `Requested memory ${requestedMemory}MB exceeds maximum ${maxAllowedMemory}MB`,
      };
    }

    if (requestedCpu > 100) {
      return {
        requestId: request.requestId,
        granted: false,
        reason: 'CPU cannot exceed 100%',
      };
    }

    if (maxAllowedTime !== -1 && requestedTime > maxAllowedTime) {
      return {
        requestId: request.requestId,
        granted: false,
        reason: `Requested time ${requestedTime}ms exceeds maximum ${maxAllowedTime}ms`,
      };
    }

    return {
      requestId: request.requestId,
      granted: true,
      reason: 'Resource elevation granted',
      conditions: {
        maxDurationMs: additionalTimeMs,
        auditLevel: 'full',
      },
    };
  }

  // ==========================================================================
  // Capability Tracking
  // ==========================================================================

  /**
   * Track a granted capability
   */
  private trackGrantedCapability(
    sandboxId: string,
    request: CapabilityRequest,
    decision: CapabilityDecision
  ): void {
    const granted = this.grantedCapabilities.get(sandboxId) || [];

    granted.push({
      requestId: request.requestId,
      type: request.type,
      details: request.details,
      conditions: decision.conditions!,
      grantedAt: new Date(),
      expiresAt: decision.expiresAt,
      usageCount: 0,
      bytesUsed: 0,
    });

    this.grantedCapabilities.set(sandboxId, granted);
  }

  /**
   * Record capability usage
   */
  recordUsage(sandboxId: string, requestId: string, bytes: number = 0): void {
    const granted = this.grantedCapabilities.get(sandboxId) || [];
    const cap = granted.find((g) => g.requestId === requestId);

    if (cap) {
      cap.usageCount++;
      cap.bytesUsed += bytes;
    }
  }

  /**
   * Check if a granted capability is still valid
   */
  isCapabilityValid(sandboxId: string, requestId: string): boolean {
    const granted = this.grantedCapabilities.get(sandboxId) || [];
    const cap = granted.find((g) => g.requestId === requestId);

    if (!cap) return false;

    // Check expiration
    if (cap.expiresAt && cap.expiresAt < new Date()) {
      return false;
    }

    // Check byte limits
    if (cap.conditions.maxBytes && cap.bytesUsed >= cap.conditions.maxBytes) {
      return false;
    }

    // Check rate limits
    if (cap.conditions.rateLimit && cap.usageCount >= cap.conditions.rateLimit) {
      return false;
    }

    return true;
  }

  /**
   * Revoke a granted capability
   */
  revokeCapability(sandboxId: string, requestId: string, reason: string): void {
    const granted = this.grantedCapabilities.get(sandboxId) || [];
    this.grantedCapabilities.set(
      sandboxId,
      granted.filter((g) => g.requestId !== requestId)
    );

    logger.info({ sandboxId, requestId, reason }, 'Capability revoked');
  }

  /**
   * Revoke all capabilities for a sandbox
   */
  revokeAllCapabilities(sandboxId: string): void {
    this.grantedCapabilities.delete(sandboxId);
    this.pendingRequests.delete(sandboxId);

    logger.info({ sandboxId }, 'All capabilities revoked');
  }

  /**
   * Get all granted capabilities for a sandbox
   */
  getGrantedCapabilities(sandboxId: string): GrantedCapability[] {
    return this.grantedCapabilities.get(sandboxId) || [];
  }

  // ==========================================================================
  // Violation Handling
  // ==========================================================================

  /**
   * Handle a policy violation
   */
  handleViolation(
    sandboxId: string,
    violation: PolicyViolation
  ): { action: 'warn' | 'revoke' | 'terminate'; reason: string } {
    // Determine action based on severity
    switch (violation.severity) {
      case 'low':
        return { action: 'warn', reason: 'Low severity violation logged' };

      case 'medium':
        // Revoke related capability
        return { action: 'revoke', reason: 'Medium severity violation - capability revoked' };

      case 'high':
      case 'critical':
        // Terminate sandbox
        return { action: 'terminate', reason: 'High/critical violation - sandbox terminated' };

      default:
        return { action: 'warn', reason: 'Unknown severity' };
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private getEgressBytesLimit(tier: number): number {
    const limits: Record<number, number> = {
      0: 0,
      1: 0,
      2: 10 * 1024 * 1024, // 10MB
      3: 50 * 1024 * 1024, // 50MB
      4: 100 * 1024 * 1024, // 100MB
      5: 500 * 1024 * 1024, // 500MB
      6: 1024 * 1024 * 1024, // 1GB
      7: -1, // Unlimited
    };
    return limits[tier] || 0;
  }

  private getRateLimit(tier: number): number {
    const limits: Record<number, number> = {
      0: 0,
      1: 0,
      2: 100,
      3: 500,
      4: 1000,
      5: 5000,
      6: 10000,
      7: -1,
    };
    return limits[tier] || 0;
  }

  private getDiskQuota(tier: number): number {
    const quotas: Record<number, number> = {
      0: 0,
      1: 0,
      2: 100 * 1024 * 1024, // 100MB
      3: 500 * 1024 * 1024, // 500MB
      4: 1024 * 1024 * 1024, // 1GB
      5: 5 * 1024 * 1024 * 1024, // 5GB
      6: 10 * 1024 * 1024 * 1024, // 10GB
      7: -1, // Unlimited
    };
    return quotas[tier] || 0;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let instance: CapabilityBroker | null = null;

export function createCapabilityBroker(): CapabilityBroker {
  if (!instance) {
    instance = new CapabilityBroker();
  }
  return instance;
}

export function getCapabilityBroker(): CapabilityBroker {
  if (!instance) {
    throw new Error('CapabilityBroker not initialized');
  }
  return instance;
}
