/**
 * Vorion Security SDK - @BreakGlass Decorator
 * Emergency access with approval workflow
 */

import 'reflect-metadata';
import {
  BreakGlassOptions,
  EvaluationContext,
  PolicyResult,
} from '../types';
import { getSecurityContext, SecurityError } from './secured';

// ============================================================================
// Break Glass Request
// ============================================================================

export interface BreakGlassRequest {
  id: string;
  userId: string;
  resourceType: string;
  resourceId: string;
  action: string;
  reason: string;
  approvers: string[];
  minApprovals: number;
  approvals: BreakGlassApproval[];
  denials: BreakGlassDenial[];
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'used';
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  usedAt?: Date;
  metadata?: Record<string, unknown>;
}

export interface BreakGlassApproval {
  approverId: string;
  approvedAt: Date;
  comment?: string;
}

export interface BreakGlassDenial {
  denierId: string;
  deniedAt: Date;
  reason: string;
}

// ============================================================================
// Break Glass Manager Interface
// ============================================================================

export interface BreakGlassManager {
  /**
   * Create a new break glass request
   */
  createRequest(request: Omit<BreakGlassRequest, 'id' | 'status' | 'approvals' | 'denials' | 'createdAt' | 'updatedAt'>): Promise<BreakGlassRequest>;

  /**
   * Get a break glass request by ID
   */
  getRequest(requestId: string): Promise<BreakGlassRequest | null>;

  /**
   * Get pending requests for a user (as approver)
   */
  getPendingRequests(approverId: string): Promise<BreakGlassRequest[]>;

  /**
   * Approve a break glass request
   */
  approve(requestId: string, approverId: string, comment?: string): Promise<BreakGlassRequest>;

  /**
   * Deny a break glass request
   */
  deny(requestId: string, denierId: string, reason: string): Promise<BreakGlassRequest>;

  /**
   * Check if user has valid break glass access
   */
  hasValidAccess(userId: string, resourceType: string, resourceId: string, action: string): Promise<BreakGlassRequest | null>;

  /**
   * Mark request as used
   */
  markUsed(requestId: string): Promise<BreakGlassRequest>;

  /**
   * Get audit trail for a request
   */
  getAuditTrail(requestId: string): Promise<BreakGlassAuditEntry[]>;
}

export interface BreakGlassAuditEntry {
  timestamp: Date;
  action: 'created' | 'approved' | 'denied' | 'used' | 'expired';
  actorId: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// In-Memory Break Glass Manager
// ============================================================================

/**
 * In-memory break glass manager for development/testing
 */
export class InMemoryBreakGlassManager implements BreakGlassManager {
  private requests = new Map<string, BreakGlassRequest>();
  private auditTrail = new Map<string, BreakGlassAuditEntry[]>();

  async createRequest(
    request: Omit<BreakGlassRequest, 'id' | 'status' | 'approvals' | 'denials' | 'createdAt' | 'updatedAt'>
  ): Promise<BreakGlassRequest> {
    const id = this.generateId();
    const now = new Date();

    const fullRequest: BreakGlassRequest = {
      ...request,
      id,
      status: 'pending',
      approvals: [],
      denials: [],
      createdAt: now,
      updatedAt: now,
    };

    this.requests.set(id, fullRequest);
    this.addAuditEntry(id, {
      timestamp: now,
      action: 'created',
      actorId: request.userId,
      details: { reason: request.reason },
    });

    return fullRequest;
  }

  async getRequest(requestId: string): Promise<BreakGlassRequest | null> {
    const request = this.requests.get(requestId);
    if (request) {
      this.checkExpiration(request);
    }
    return request || null;
  }

  async getPendingRequests(approverId: string): Promise<BreakGlassRequest[]> {
    const pending: BreakGlassRequest[] = [];

    for (const request of this.requests.values()) {
      this.checkExpiration(request);
      if (
        request.status === 'pending' &&
        request.approvers.includes(approverId) &&
        !request.approvals.some((a) => a.approverId === approverId) &&
        !request.denials.some((d) => d.denierId === approverId)
      ) {
        pending.push(request);
      }
    }

    return pending;
  }

  async approve(
    requestId: string,
    approverId: string,
    comment?: string
  ): Promise<BreakGlassRequest> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Break glass request not found: ${requestId}`);
    }

    this.checkExpiration(request);

    if (request.status !== 'pending') {
      throw new Error(`Request is no longer pending: ${request.status}`);
    }

    if (!request.approvers.includes(approverId)) {
      throw new Error(`User ${approverId} is not an authorized approver`);
    }

    if (request.approvals.some((a) => a.approverId === approverId)) {
      throw new Error(`User ${approverId} has already approved this request`);
    }

    const now = new Date();
    request.approvals.push({
      approverId,
      approvedAt: now,
      comment,
    });
    request.updatedAt = now;

    // Check if we have enough approvals
    if (request.approvals.length >= request.minApprovals) {
      request.status = 'approved';
    }

    this.addAuditEntry(requestId, {
      timestamp: now,
      action: 'approved',
      actorId: approverId,
      details: { comment },
    });

    return request;
  }

  async deny(
    requestId: string,
    denierId: string,
    reason: string
  ): Promise<BreakGlassRequest> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Break glass request not found: ${requestId}`);
    }

    if (request.status !== 'pending') {
      throw new Error(`Request is no longer pending: ${request.status}`);
    }

    const now = new Date();
    request.denials.push({
      denierId,
      deniedAt: now,
      reason,
    });
    request.status = 'denied';
    request.updatedAt = now;

    this.addAuditEntry(requestId, {
      timestamp: now,
      action: 'denied',
      actorId: denierId,
      details: { reason },
    });

    return request;
  }

  async hasValidAccess(
    userId: string,
    resourceType: string,
    resourceId: string,
    action: string
  ): Promise<BreakGlassRequest | null> {
    for (const request of this.requests.values()) {
      this.checkExpiration(request);

      if (
        request.status === 'approved' &&
        request.userId === userId &&
        request.resourceType === resourceType &&
        request.resourceId === resourceId &&
        request.action === action
      ) {
        return request;
      }
    }

    return null;
  }

  async markUsed(requestId: string): Promise<BreakGlassRequest> {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Break glass request not found: ${requestId}`);
    }

    const now = new Date();
    request.status = 'used';
    request.usedAt = now;
    request.updatedAt = now;

    this.addAuditEntry(requestId, {
      timestamp: now,
      action: 'used',
      actorId: request.userId,
    });

    return request;
  }

  async getAuditTrail(requestId: string): Promise<BreakGlassAuditEntry[]> {
    return this.auditTrail.get(requestId) || [];
  }

  private generateId(): string {
    return `bg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private checkExpiration(request: BreakGlassRequest): void {
    if (
      request.status === 'pending' &&
      request.expiresAt < new Date()
    ) {
      request.status = 'expired';
      request.updatedAt = new Date();

      this.addAuditEntry(request.id, {
        timestamp: new Date(),
        action: 'expired',
        actorId: 'system',
      });
    }
  }

  private addAuditEntry(requestId: string, entry: BreakGlassAuditEntry): void {
    const trail = this.auditTrail.get(requestId) || [];
    trail.push(entry);
    this.auditTrail.set(requestId, trail);
  }
}

// ============================================================================
// Notification Interface
// ============================================================================

export interface BreakGlassNotifier {
  /**
   * Notify approvers of a new request
   */
  notifyApprovers(request: BreakGlassRequest): Promise<void>;

  /**
   * Notify requester of approval/denial
   */
  notifyRequester(request: BreakGlassRequest): Promise<void>;

  /**
   * Send alert to security team
   */
  alertSecurityTeam(request: BreakGlassRequest, event: string): Promise<void>;
}

/**
 * Console-based notifier for development
 */
export class ConsoleBreakGlassNotifier implements BreakGlassNotifier {
  async notifyApprovers(request: BreakGlassRequest): Promise<void> {
    console.log(
      `\x1b[33m[BREAK GLASS] New request ${request.id} requires approval\x1b[0m`
    );
    console.log(`  User: ${request.userId}`);
    console.log(`  Resource: ${request.resourceType}/${request.resourceId}`);
    console.log(`  Action: ${request.action}`);
    console.log(`  Reason: ${request.reason}`);
    console.log(`  Approvers: ${request.approvers.join(', ')}`);
    console.log(`  Expires: ${request.expiresAt.toISOString()}`);
  }

  async notifyRequester(request: BreakGlassRequest): Promise<void> {
    const statusColor =
      request.status === 'approved'
        ? '\x1b[32m'
        : request.status === 'denied'
          ? '\x1b[31m'
          : '\x1b[33m';

    console.log(
      `${statusColor}[BREAK GLASS] Request ${request.id} is now ${request.status}\x1b[0m`
    );
  }

  async alertSecurityTeam(request: BreakGlassRequest, event: string): Promise<void> {
    console.log(
      `\x1b[31m[SECURITY ALERT] Break glass ${event} - Request ${request.id}\x1b[0m`
    );
    console.log(`  User: ${request.userId}`);
    console.log(`  Resource: ${request.resourceType}/${request.resourceId}`);
    console.log(`  Action: ${request.action}`);
  }
}

// ============================================================================
// Global Break Glass Configuration
// ============================================================================

let globalBreakGlassManager: BreakGlassManager = new InMemoryBreakGlassManager();
let globalBreakGlassNotifier: BreakGlassNotifier = new ConsoleBreakGlassNotifier();

/**
 * Configure the global break glass manager
 */
export function setBreakGlassManager(manager: BreakGlassManager): void {
  globalBreakGlassManager = manager;
}

/**
 * Get the global break glass manager
 */
export function getBreakGlassManager(): BreakGlassManager {
  return globalBreakGlassManager;
}

/**
 * Configure the global break glass notifier
 */
export function setBreakGlassNotifier(notifier: BreakGlassNotifier): void {
  globalBreakGlassNotifier = notifier;
}

// ============================================================================
// Metadata Storage
// ============================================================================

const BREAK_GLASS_METADATA_KEY = Symbol('vorion:breakGlass');

// ============================================================================
// Parse Duration String
// ============================================================================

function parseExpiresIn(expiresIn: string): number {
  const match = expiresIn.match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error(`Invalid expiresIn format: ${expiresIn}. Use format like '30m', '1h', '1d'`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    default:
      throw new Error(`Unknown time unit: ${unit}`);
  }
}

// ============================================================================
// @BreakGlass Decorator
// ============================================================================

/**
 * @BreakGlass decorator for emergency access with approval workflow
 *
 * @example
 * class CriticalSystemController {
 *   @BreakGlass({
 *     approvers: ['security-team', 'on-call-engineer'],
 *     minApprovals: 1,
 *     expiresIn: '1h',
 *     requireReason: true
 *   })
 *   async emergencyShutdown() {}
 *
 *   @BreakGlass({
 *     approvers: ['cto', 'security-director'],
 *     minApprovals: 2,
 *     expiresIn: '30m',
 *     notifyChannels: ['#security-alerts', 'pagerduty'],
 *     auditLevel: 'critical'
 *   })
 *   async deleteAllData() {}
 * }
 */
export function BreakGlass(options: BreakGlassOptions): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor {
    const methodName = String(propertyKey);
    const className = target.constructor.name;
    const originalMethod = descriptor.value;

    // Store metadata
    Reflect.defineMetadata(
      BREAK_GLASS_METADATA_KEY,
      { options },
      target,
      propertyKey
    );

    descriptor.value = async function (this: unknown, ...args: unknown[]) {
      const context = await getSecurityContext();
      const manager = getBreakGlassManager();

      const resourceType = className;
      const resourceId = methodName;
      const action = `${className}.${methodName}`;

      // Check for existing valid access
      const existingAccess = await manager.hasValidAccess(
        context.user.id,
        resourceType,
        resourceId,
        action
      );

      if (existingAccess) {
        // Mark the access as used
        await manager.markUsed(existingAccess.id);

        // Alert security team
        await globalBreakGlassNotifier.alertSecurityTeam(existingAccess, 'access_used');

        // Execute the method
        return originalMethod.apply(this, args);
      }

      // No valid access - throw error requiring break glass approval
      const result: PolicyResult = {
        outcome: 'challenge',
        reason: 'Break glass approval required for this operation',
        policyId: 'break-glass-decorator',
        policyVersion: '1.0.0',
        timestamp: new Date(),
        metadata: {
          approvers: options.approvers,
          minApprovals: options.minApprovals || 1,
          expiresIn: options.expiresIn || '1h',
        },
      };

      throw new BreakGlassRequiredError(
        'This operation requires break glass approval',
        result,
        {
          resourceType,
          resourceId,
          action,
          approvers: options.approvers,
          minApprovals: options.minApprovals || 1,
          expiresIn: options.expiresIn || '1h',
          requireReason: options.requireReason ?? true,
        }
      );
    };

    return descriptor;
  };
}

// ============================================================================
// Errors
// ============================================================================

export interface BreakGlassRequirements {
  resourceType: string;
  resourceId: string;
  action: string;
  approvers: string[];
  minApprovals: number;
  expiresIn: string;
  requireReason: boolean;
}

export class BreakGlassRequiredError extends SecurityError {
  public readonly requirements: BreakGlassRequirements;

  constructor(
    message: string,
    result: PolicyResult,
    requirements: BreakGlassRequirements
  ) {
    super(message, result);
    this.name = 'BreakGlassRequiredError';
    this.requirements = requirements;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Request break glass access
 */
export async function requestBreakGlassAccess(
  resourceType: string,
  resourceId: string,
  action: string,
  reason: string,
  options: BreakGlassOptions
): Promise<BreakGlassRequest> {
  const context = await getSecurityContext();
  const manager = getBreakGlassManager();

  const expiresInMs = parseExpiresIn(options.expiresIn || '1h');

  const request = await manager.createRequest({
    userId: context.user.id,
    resourceType,
    resourceId,
    action,
    reason,
    approvers: options.approvers,
    minApprovals: options.minApprovals || 1,
    expiresAt: new Date(Date.now() + expiresInMs),
    metadata: {
      notifyChannels: options.notifyChannels,
      auditLevel: options.auditLevel,
    },
  });

  // Notify approvers
  await globalBreakGlassNotifier.notifyApprovers(request);

  return request;
}

/**
 * Get break glass options for a method
 */
export function getBreakGlassOptions(
  target: object,
  methodName: string
): BreakGlassOptions | undefined {
  const metadata = Reflect.getMetadata(
    BREAK_GLASS_METADATA_KEY,
    target,
    methodName
  ) as { options: BreakGlassOptions } | undefined;

  return metadata?.options;
}

/**
 * Get pending break glass requests for current user (as approver)
 */
export async function getPendingBreakGlassRequests(): Promise<BreakGlassRequest[]> {
  const context = await getSecurityContext();
  const manager = getBreakGlassManager();
  return manager.getPendingRequests(context.user.id);
}

/**
 * Approve a break glass request
 */
export async function approveBreakGlassRequest(
  requestId: string,
  comment?: string
): Promise<BreakGlassRequest> {
  const context = await getSecurityContext();
  const manager = getBreakGlassManager();

  const request = await manager.approve(requestId, context.user.id, comment);

  if (request.status === 'approved') {
    await globalBreakGlassNotifier.notifyRequester(request);
  }

  return request;
}

/**
 * Deny a break glass request
 */
export async function denyBreakGlassRequest(
  requestId: string,
  reason: string
): Promise<BreakGlassRequest> {
  const context = await getSecurityContext();
  const manager = getBreakGlassManager();

  const request = await manager.deny(requestId, context.user.id, reason);
  await globalBreakGlassNotifier.notifyRequester(request);

  return request;
}

/**
 * Get break glass request status
 */
export async function getBreakGlassRequestStatus(
  requestId: string
): Promise<BreakGlassRequest | null> {
  const manager = getBreakGlassManager();
  return manager.getRequest(requestId);
}

/**
 * Get audit trail for a break glass request
 */
export async function getBreakGlassAuditTrail(
  requestId: string
): Promise<BreakGlassAuditEntry[]> {
  const manager = getBreakGlassManager();
  return manager.getAuditTrail(requestId);
}
