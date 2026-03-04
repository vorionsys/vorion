/**
 * IP Blocking Action
 *
 * Automated IP blocking for incident response.
 * Integrates with firewalls, WAF, and CDN edge rules.
 *
 * @packageDocumentation
 * @module security/incident/actions/block-ip
 */

import { createLogger } from '../../../common/logger.js';
import type { ActionDefinition, ActionContext, ActionResult } from '../types.js';

const logger = createLogger({ component: 'action-block-ip' });

// ============================================================================
// IP Blocking Types
// ============================================================================

export interface IpBlockTarget {
  ipAddress: string;
  ipRange?: string; // CIDR notation
  blockType: 'permanent' | 'temporary';
  expiresAt?: Date;
  reason: string;
}

export interface IpBlockResult {
  ipAddress: string;
  blocked: boolean;
  blockType: string;
  service: string;
  expiresAt?: Date;
  ruleId?: string;
  timestamp: Date;
}

export interface IpBlockRollbackData {
  blocks: IpBlockResult[];
  incidentId: string;
}

// ============================================================================
// IP Blocking Service Interface
// ============================================================================

export interface IpBlockingService {
  /** Block IP at firewall level */
  blockAtFirewall(ip: string, rule: { permanent: boolean; expiresAt?: Date; reason: string }): Promise<{
    success: boolean;
    ruleId: string;
  }>;

  /** Block IP at WAF level */
  blockAtWaf(ip: string, rule: { permanent: boolean; expiresAt?: Date; reason: string }): Promise<{
    success: boolean;
    ruleId: string;
  }>;

  /** Block IP at CDN edge */
  blockAtCdn(ip: string, rule: { permanent: boolean; expiresAt?: Date; reason: string }): Promise<{
    success: boolean;
    ruleId: string;
  }>;

  /** Block IP range (CIDR) */
  blockIpRange(cidr: string, rule: { permanent: boolean; expiresAt?: Date; reason: string }): Promise<{
    success: boolean;
    ruleId: string;
    service: string;
  }>;

  /** Unblock an IP */
  unblockIp(ip: string, ruleId: string, service: string): Promise<boolean>;

  /** Check if IP is already blocked */
  isBlocked(ip: string): Promise<{ blocked: boolean; service?: string; ruleId?: string }>;
}

// ============================================================================
// Default Mock IP Blocking Service
// ============================================================================

class MockIpBlockingService implements IpBlockingService {
  private blockedIps: Map<string, { ruleId: string; service: string }> = new Map();

  async blockAtFirewall(
    ip: string,
    rule: { permanent: boolean; expiresAt?: Date; reason: string }
  ): Promise<{ success: boolean; ruleId: string }> {
    logger.info('Blocking IP at firewall', { ip, rule });
    await this.simulateOperation(500);
    const ruleId = `fw-rule-${Date.now()}`;
    this.blockedIps.set(ip, { ruleId, service: 'firewall' });
    return { success: true, ruleId };
  }

  async blockAtWaf(
    ip: string,
    rule: { permanent: boolean; expiresAt?: Date; reason: string }
  ): Promise<{ success: boolean; ruleId: string }> {
    logger.info('Blocking IP at WAF', { ip, rule });
    await this.simulateOperation(400);
    const ruleId = `waf-rule-${Date.now()}`;
    this.blockedIps.set(`waf:${ip}`, { ruleId, service: 'waf' });
    return { success: true, ruleId };
  }

  async blockAtCdn(
    ip: string,
    rule: { permanent: boolean; expiresAt?: Date; reason: string }
  ): Promise<{ success: boolean; ruleId: string }> {
    logger.info('Blocking IP at CDN edge', { ip, rule });
    await this.simulateOperation(600);
    const ruleId = `cdn-rule-${Date.now()}`;
    this.blockedIps.set(`cdn:${ip}`, { ruleId, service: 'cdn' });
    return { success: true, ruleId };
  }

  async blockIpRange(
    cidr: string,
    rule: { permanent: boolean; expiresAt?: Date; reason: string }
  ): Promise<{ success: boolean; ruleId: string; service: string }> {
    logger.info('Blocking IP range', { cidr, rule });
    await this.simulateOperation(800);
    const ruleId = `range-rule-${Date.now()}`;
    this.blockedIps.set(`range:${cidr}`, { ruleId, service: 'firewall' });
    return { success: true, ruleId, service: 'firewall' };
  }

  async unblockIp(ip: string, ruleId: string, service: string): Promise<boolean> {
    logger.info('Unblocking IP', { ip, ruleId, service });
    await this.simulateOperation(300);

    // Remove from our mock storage
    this.blockedIps.delete(ip);
    this.blockedIps.delete(`waf:${ip}`);
    this.blockedIps.delete(`cdn:${ip}`);

    return true;
  }

  async isBlocked(ip: string): Promise<{ blocked: boolean; service?: string; ruleId?: string }> {
    const direct = this.blockedIps.get(ip);
    if (direct) {
      return { blocked: true, ...direct };
    }
    return { blocked: false };
  }

  private simulateOperation(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Singleton IP Blocking Service
// ============================================================================

let ipBlockingService: IpBlockingService | null = null;

export function setIpBlockingService(service: IpBlockingService): void {
  ipBlockingService = service;
}

export function getIpBlockingService(): IpBlockingService {
  if (!ipBlockingService) {
    throw new Error(
      'No IP blocking service configured. Call setIpBlockingService() with a real implementation before use. ' +
      'For tests, use createMockIpBlockingService().'
    );
  }
  return ipBlockingService;
}

/** Create a mock IP blocking service for testing only. */
export function createMockIpBlockingService(): IpBlockingService {
  return new MockIpBlockingService();
}

// ============================================================================
// Action Implementation
// ============================================================================

async function executeIpBlocking(context: ActionContext): Promise<ActionResult> {
  const service = getIpBlockingService();
  const { incident, logger: actionLogger, setVariable, getVariable } = context;
  const startTime = Date.now();
  const results: IpBlockResult[] = [];

  // Extract IPs to block from incident
  const ipTargets = extractIpTargets(incident.affectedResources, incident.metadata);

  if (ipTargets.length === 0) {
    actionLogger.warn('No IP addresses identified for blocking');
    return {
      success: true,
      output: { message: 'No IP addresses identified for blocking', results: [] },
      metrics: { durationMs: Date.now() - startTime, itemsProcessed: 0 },
      canRollback: false,
    };
  }

  actionLogger.info('Starting IP blocking', {
    ipCount: ipTargets.length,
    ips: ipTargets.map((t) => t.ipAddress),
  });

  let successCount = 0;
  let failureCount = 0;

  for (const target of ipTargets) {
    try {
      // Check if already blocked
      const existingBlock = await service.isBlocked(target.ipAddress);
      if (existingBlock.blocked) {
        actionLogger.info('IP already blocked', {
          ip: target.ipAddress,
          service: existingBlock.service,
        });
        results.push({
          ipAddress: target.ipAddress,
          blocked: true,
          blockType: 'existing',
          service: existingBlock.service || 'unknown',
          ruleId: existingBlock.ruleId,
          timestamp: new Date(),
        });
        successCount++;
        continue;
      }

      // Determine block duration
      const isPermanent = target.blockType === 'permanent';
      const expiresAt = target.expiresAt || (isPermanent ? undefined : getDefaultExpiry());

      const blockRule = {
        permanent: isPermanent,
        expiresAt,
        reason: target.reason || `Incident ${incident.id}: ${incident.title}`,
      };

      // Block at multiple layers for defense in depth
      const blockPromises: Promise<void>[] = [];

      // 1. Block at firewall (primary)
      blockPromises.push(
        (async () => {
          try {
            const result = await service.blockAtFirewall(target.ipAddress, blockRule);
            results.push({
              ipAddress: target.ipAddress,
              blocked: result.success,
              blockType: isPermanent ? 'permanent' : 'temporary',
              service: 'firewall',
              expiresAt,
              ruleId: result.ruleId,
              timestamp: new Date(),
            });
            if (result.success) {
              actionLogger.info('IP blocked at firewall', { ip: target.ipAddress });
            }
          } catch (error) {
            actionLogger.error('Failed to block at firewall', {
              ip: target.ipAddress,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })()
      );

      // 2. Block at WAF (application layer)
      blockPromises.push(
        (async () => {
          try {
            const result = await service.blockAtWaf(target.ipAddress, blockRule);
            results.push({
              ipAddress: target.ipAddress,
              blocked: result.success,
              blockType: isPermanent ? 'permanent' : 'temporary',
              service: 'waf',
              expiresAt,
              ruleId: result.ruleId,
              timestamp: new Date(),
            });
            if (result.success) {
              actionLogger.info('IP blocked at WAF', { ip: target.ipAddress });
            }
          } catch (error) {
            actionLogger.error('Failed to block at WAF', {
              ip: target.ipAddress,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })()
      );

      // 3. Block at CDN edge (if applicable)
      blockPromises.push(
        (async () => {
          try {
            const result = await service.blockAtCdn(target.ipAddress, blockRule);
            results.push({
              ipAddress: target.ipAddress,
              blocked: result.success,
              blockType: isPermanent ? 'permanent' : 'temporary',
              service: 'cdn',
              expiresAt,
              ruleId: result.ruleId,
              timestamp: new Date(),
            });
            if (result.success) {
              actionLogger.info('IP blocked at CDN', { ip: target.ipAddress });
            }
          } catch (error) {
            actionLogger.error('Failed to block at CDN', {
              ip: target.ipAddress,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        })()
      );

      // Wait for all block operations
      await Promise.all(blockPromises);

      // Count as success if blocked at least at firewall level
      const firewallBlock = results.find(
        (r) => r.ipAddress === target.ipAddress && r.service === 'firewall' && r.blocked
      );
      if (firewallBlock) {
        successCount++;
      } else {
        failureCount++;
      }
    } catch (error) {
      failureCount++;
      actionLogger.error('Error blocking IP', {
        ip: target.ipAddress,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Handle IP ranges
    if (target.ipRange) {
      try {
        const rangeResult = await service.blockIpRange(target.ipRange, {
          permanent: target.blockType === 'permanent',
          expiresAt: target.expiresAt,
          reason: target.reason || `Incident ${incident.id}`,
        });
        results.push({
          ipAddress: target.ipRange,
          blocked: rangeResult.success,
          blockType: target.blockType,
          service: rangeResult.service,
          ruleId: rangeResult.ruleId,
          timestamp: new Date(),
        });
        if (rangeResult.success) {
          successCount++;
          actionLogger.info('IP range blocked', { cidr: target.ipRange });
        } else {
          failureCount++;
        }
      } catch (error) {
        failureCount++;
        actionLogger.error('Error blocking IP range', { cidr: target.ipRange, error });
      }
    }
  }

  // Store results
  setVariable('ip_block_results', results);

  const durationMs = Date.now() - startTime;
  const success = failureCount === 0;

  actionLogger.info('IP blocking completed', {
    success,
    successCount,
    failureCount,
    durationMs,
  });

  const rollbackData: IpBlockRollbackData = {
    blocks: results.filter((r) => r.blocked && r.ruleId),
    incidentId: incident.id,
  };

  return {
    success,
    output: {
      message: success
        ? `Successfully blocked ${successCount} IP address(es)`
        : `IP blocking completed with ${failureCount} failure(s)`,
      results,
      successCount,
      failureCount,
    },
    metrics: {
      durationMs,
      itemsProcessed: successCount,
      itemsFailed: failureCount,
    },
    canRollback: results.some((r) => r.blocked),
    rollbackData,
  };
}

async function rollbackIpBlocking(
  context: ActionContext,
  rollbackData: unknown
): Promise<ActionResult> {
  const service = getIpBlockingService();
  const { logger: actionLogger } = context;
  const startTime = Date.now();
  const data = rollbackData as IpBlockRollbackData;

  actionLogger.info('Starting IP block rollback', {
    blockCount: data.blocks.length,
  });

  let successCount = 0;
  let failureCount = 0;

  for (const block of data.blocks) {
    if (!block.ruleId) continue;

    try {
      const success = await service.unblockIp(
        block.ipAddress,
        block.ruleId,
        block.service
      );

      if (success) {
        successCount++;
        actionLogger.info('IP unblocked', {
          ip: block.ipAddress,
          service: block.service,
        });
      } else {
        failureCount++;
        actionLogger.error('Failed to unblock IP', {
          ip: block.ipAddress,
          service: block.service,
        });
      }
    } catch (error) {
      failureCount++;
      actionLogger.error('Error unblocking IP', {
        ip: block.ipAddress,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    success: failureCount === 0,
    output: {
      message: `Unblocked ${successCount} of ${data.blocks.length} IP block(s)`,
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

function extractIpTargets(
  affectedResources: string[],
  metadata?: Record<string, unknown>
): IpBlockTarget[] {
  const targets: IpBlockTarget[] = [];
  const seenIps = new Set<string>();

  // Extract from affected resources
  for (const resource of affectedResources) {
    if (resource.startsWith('ip:')) {
      const ip = resource.replace('ip:', '');
      if (!seenIps.has(ip) && isValidIp(ip)) {
        seenIps.add(ip);
        targets.push({
          ipAddress: ip,
          blockType: 'temporary',
          reason: 'Identified in affected resources',
        });
      }
    }
  }

  // Extract from metadata
  const attackerIps = metadata?.['attackerIps'] as string[] | undefined;
  if (attackerIps) {
    for (const ip of attackerIps) {
      if (!seenIps.has(ip) && isValidIp(ip)) {
        seenIps.add(ip);
        targets.push({
          ipAddress: ip,
          blockType: 'permanent',
          reason: 'Identified as attacker IP',
        });
      }
    }
  }

  const suspiciousIps = metadata?.['suspiciousIps'] as string[] | undefined;
  if (suspiciousIps) {
    for (const ip of suspiciousIps) {
      if (!seenIps.has(ip) && isValidIp(ip)) {
        seenIps.add(ip);
        targets.push({
          ipAddress: ip,
          blockType: 'temporary',
          expiresAt: getDefaultExpiry(),
          reason: 'Identified as suspicious IP',
        });
      }
    }
  }

  // Extract IP ranges (CIDR)
  const ipRanges = metadata?.['ipRanges'] as string[] | undefined;
  if (ipRanges) {
    for (const cidr of ipRanges) {
      if (isValidCidr(cidr)) {
        targets.push({
          ipAddress: cidr.split('/')[0],
          ipRange: cidr,
          blockType: 'temporary',
          reason: 'Suspicious IP range',
        });
      }
    }
  }

  return targets;
}

function isValidIp(ip: string): boolean {
  // Simple IPv4 validation
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Pattern.test(ip)) {
    const parts = ip.split('.').map(Number);
    return parts.every((part) => part >= 0 && part <= 255);
  }

  // Simple IPv6 validation (basic check)
  const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;
  return ipv6Pattern.test(ip);
}

function isValidCidr(cidr: string): boolean {
  const parts = cidr.split('/');
  if (parts.length !== 2) return false;

  const ip = parts[0];
  const prefix = parseInt(parts[1], 10);

  if (!isValidIp(ip)) return false;

  // IPv4 prefix: 0-32, IPv6 prefix: 0-128
  const maxPrefix = ip.includes(':') ? 128 : 32;
  return prefix >= 0 && prefix <= maxPrefix;
}

function getDefaultExpiry(): Date {
  // Default block duration: 24 hours
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 24);
  return expiry;
}

// ============================================================================
// Action Definition Export
// ============================================================================

export const blockIpAction: ActionDefinition = {
  id: 'block-ip',
  name: 'Block Malicious IP Addresses',
  description: 'Block malicious or suspicious IP addresses at firewall, WAF, and CDN levels',
  category: 'containment',
  riskLevel: 'medium',
  requiresApproval: false,
  supportsRollback: true,
  defaultTimeoutMs: 60000, // 1 minute
  maxRetries: 2,
  execute: executeIpBlocking,
  rollback: rollbackIpBlocking,
  validate: async (context) => {
    const { incident } = context;

    const ipTargets = extractIpTargets(incident.affectedResources, incident.metadata);
    if (ipTargets.length === 0) {
      return {
        valid: false,
        reason: 'No IP addresses identified for blocking',
      };
    }

    return { valid: true };
  },
};

export default blockIpAction;
