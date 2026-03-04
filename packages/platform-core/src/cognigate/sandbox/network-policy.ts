/**
 * Network Policy Enforcer
 *
 * Implements network isolation policies for sandboxed agent execution.
 * Supports iptables rules, network namespaces, and DNS filtering.
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import {
  type NetworkPolicy,
  type EgressRule,
  type NetworkActivityLog,
  NetworkAccessLevel,
} from './types.js';

const logger = createLogger({ component: 'network-policy' });

// ============================================================================
// Types
// ============================================================================

/**
 * Network namespace configuration
 */
export interface NetworkNamespaceConfig {
  /** Namespace name */
  name: string;

  /** Virtual ethernet pair */
  vethPair: {
    host: string;
    container: string;
  };

  /** IP address for container side */
  containerIp: string;

  /** Gateway IP */
  gatewayIp: string;

  /** Subnet CIDR */
  subnet: string;
}

/**
 * iptables rule definition
 */
export interface IptablesRule {
  chain: 'INPUT' | 'OUTPUT' | 'FORWARD';
  action: 'ACCEPT' | 'DROP' | 'REJECT' | 'LOG';
  protocol?: 'tcp' | 'udp' | 'icmp' | 'all';
  source?: string;
  destination?: string;
  port?: number | string;
  comment?: string;
}

/**
 * Connection tracking entry
 */
export interface ConnectionEntry {
  id: string;
  sandboxId: string;
  sourceIp: string;
  destIp: string;
  destPort: number;
  protocol: string;
  state: 'NEW' | 'ESTABLISHED' | 'RELATED' | 'CLOSED';
  bytesIn: number;
  bytesOut: number;
  startedAt: Date;
  lastActivityAt: Date;
}

// ============================================================================
// Network Policy Enforcer
// ============================================================================

export class NetworkPolicyEnforcer {
  private namespaces: Map<string, NetworkNamespaceConfig> = new Map();
  private connections: Map<string, ConnectionEntry[]> = new Map();
  private activityLogs: Map<string, NetworkActivityLog[]> = new Map();
  private ipCounter: number = 2; // Start at .2, .1 is gateway

  constructor() {
    logger.info('Network policy enforcer initialized');
  }

  // ==========================================================================
  // Namespace Management
  // ==========================================================================

  /**
   * Create a network namespace for a sandbox
   */
  async createNamespace(
    sandboxId: string,
    policy: NetworkPolicy
  ): Promise<NetworkNamespaceConfig> {
    const nsName = `ns-${sandboxId.slice(0, 8)}`;
    const vethHost = `veth-${sandboxId.slice(0, 6)}h`;
    const vethContainer = `veth-${sandboxId.slice(0, 6)}c`;

    // Allocate IP from sandbox subnet
    const containerIp = `10.200.0.${this.ipCounter}`;
    this.ipCounter = (this.ipCounter % 254) + 2;

    const config: NetworkNamespaceConfig = {
      name: nsName,
      vethPair: {
        host: vethHost,
        container: vethContainer,
      },
      containerIp,
      gatewayIp: '10.200.0.1',
      subnet: '10.200.0.0/24',
    };

    // In production, this would execute:
    // ip netns add $nsName
    // ip link add $vethHost type veth peer name $vethContainer
    // ip link set $vethContainer netns $nsName
    // ip netns exec $nsName ip addr add $containerIp/24 dev $vethContainer
    // ip netns exec $nsName ip link set $vethContainer up
    // ip netns exec $nsName ip route add default via $gatewayIp

    this.namespaces.set(sandboxId, config);
    this.connections.set(sandboxId, []);
    this.activityLogs.set(sandboxId, []);

    logger.info({ sandboxId, nsName, containerIp }, 'Network namespace created');

    // Apply iptables rules based on policy
    await this.applyPolicy(sandboxId, policy);

    return config;
  }

  /**
   * Destroy a network namespace
   */
  async destroyNamespace(sandboxId: string): Promise<void> {
    const config = this.namespaces.get(sandboxId);
    if (!config) return;

    // In production: ip netns delete $nsName
    // Also clean up iptables rules

    this.namespaces.delete(sandboxId);
    this.connections.delete(sandboxId);
    this.activityLogs.delete(sandboxId);

    logger.info({ sandboxId, nsName: config.name }, 'Network namespace destroyed');
  }

  // ==========================================================================
  // Policy Application
  // ==========================================================================

  /**
   * Apply network policy to a sandbox
   */
  async applyPolicy(sandboxId: string, policy: NetworkPolicy): Promise<void> {
    const config = this.namespaces.get(sandboxId);
    if (!config) {
      throw new Error(`Namespace not found for sandbox: ${sandboxId}`);
    }

    const rules: IptablesRule[] = [];

    // Default policy: DROP all
    rules.push({
      chain: 'OUTPUT',
      action: 'DROP',
      comment: 'Default deny egress',
    });

    // Allow loopback
    rules.push({
      chain: 'OUTPUT',
      action: 'ACCEPT',
      destination: '127.0.0.1',
      comment: 'Allow localhost',
    });

    // Apply based on access level
    switch (policy.accessLevel) {
      case NetworkAccessLevel.NONE:
        // Only localhost allowed (already added)
        break;

      case NetworkAccessLevel.INTERNAL:
        // Allow internal network only
        rules.push({
          chain: 'OUTPUT',
          action: 'ACCEPT',
          destination: '10.0.0.0/8',
          comment: 'Allow internal 10.x',
        });
        rules.push({
          chain: 'OUTPUT',
          action: 'ACCEPT',
          destination: '172.16.0.0/12',
          comment: 'Allow internal 172.x',
        });
        break;

      case NetworkAccessLevel.EXTERNAL:
      case NetworkAccessLevel.CROSS_AGENT:
      case NetworkAccessLevel.FULL:
        // Build allow rules from egress list
        for (const rule of policy.allowedEgress) {
          rules.push(...this.egressRuleToIptables(rule));
        }
        break;
    }

    // Block metadata services (always)
    for (const blocked of policy.blockedEgress) {
      rules.push({
        chain: 'OUTPUT',
        action: 'DROP',
        destination: blocked,
        comment: `Block ${blocked}`,
      });
    }

    // Add logging rule for auditing
    rules.push({
      chain: 'OUTPUT',
      action: 'LOG',
      comment: 'Log dropped packets',
    });

    // In production, these would be applied via iptables commands
    logger.info(
      { sandboxId, ruleCount: rules.length, accessLevel: policy.accessLevel },
      'Network policy applied'
    );
  }

  /**
   * Convert egress rule to iptables rules
   */
  private egressRuleToIptables(rule: EgressRule): IptablesRule[] {
    const rules: IptablesRule[] = [];

    for (const port of rule.ports) {
      rules.push({
        chain: 'OUTPUT',
        action: 'ACCEPT',
        protocol: rule.protocol === 'both' ? 'tcp' : rule.protocol,
        destination: rule.destination,
        port,
        comment: rule.description || `Allow ${rule.destination}:${port}`,
      });

      if (rule.protocol === 'both') {
        rules.push({
          chain: 'OUTPUT',
          action: 'ACCEPT',
          protocol: 'udp',
          destination: rule.destination,
          port,
          comment: rule.description || `Allow ${rule.destination}:${port} UDP`,
        });
      }
    }

    return rules;
  }

  // ==========================================================================
  // Connection Tracking
  // ==========================================================================

  /**
   * Track a new connection attempt
   */
  trackConnection(
    sandboxId: string,
    destIp: string,
    destPort: number,
    protocol: string,
    allowed: boolean
  ): void {
    const config = this.namespaces.get(sandboxId);
    if (!config) return;

    const entry: ConnectionEntry = {
      id: `${sandboxId}-${Date.now()}`,
      sandboxId,
      sourceIp: config.containerIp,
      destIp,
      destPort,
      protocol,
      state: allowed ? 'NEW' : 'CLOSED',
      bytesIn: 0,
      bytesOut: 0,
      startedAt: new Date(),
      lastActivityAt: new Date(),
    };

    const connections = this.connections.get(sandboxId) || [];
    connections.push(entry);
    this.connections.set(sandboxId, connections);

    // Log activity
    this.logActivity(sandboxId, {
      timestamp: new Date(),
      direction: 'egress',
      destination: destIp,
      port: destPort,
      protocol,
      bytes: 0,
      allowed,
      blockedReason: allowed ? undefined : 'Policy violation',
    });
  }

  /**
   * Update connection state and bytes
   */
  updateConnection(
    sandboxId: string,
    connectionId: string,
    bytesIn: number,
    bytesOut: number
  ): void {
    const connections = this.connections.get(sandboxId);
    if (!connections) return;

    const conn = connections.find((c) => c.id === connectionId);
    if (conn) {
      conn.bytesIn += bytesIn;
      conn.bytesOut += bytesOut;
      conn.lastActivityAt = new Date();
      conn.state = 'ESTABLISHED';
    }
  }

  /**
   * Close a connection
   */
  closeConnection(sandboxId: string, connectionId: string): void {
    const connections = this.connections.get(sandboxId);
    if (!connections) return;

    const conn = connections.find((c) => c.id === connectionId);
    if (conn) {
      conn.state = 'CLOSED';
    }
  }

  // ==========================================================================
  // Activity Logging
  // ==========================================================================

  /**
   * Log network activity
   */
  private logActivity(sandboxId: string, activity: NetworkActivityLog): void {
    const logs = this.activityLogs.get(sandboxId) || [];
    logs.push(activity);

    // Keep only last 1000 entries
    if (logs.length > 1000) {
      logs.splice(0, logs.length - 1000);
    }

    this.activityLogs.set(sandboxId, logs);
  }

  /**
   * Get activity logs for a sandbox
   */
  getActivityLogs(sandboxId: string): NetworkActivityLog[] {
    return this.activityLogs.get(sandboxId) || [];
  }

  /**
   * Get active connections for a sandbox
   */
  getConnections(sandboxId: string): ConnectionEntry[] {
    return this.connections.get(sandboxId) || [];
  }

  // ==========================================================================
  // Rate Limiting
  // ==========================================================================

  /**
   * Check if connection is within rate limits
   */
  checkRateLimit(
    sandboxId: string,
    requestsPerMinute: number,
    egressBytesPerMinute: number,
    maxConnections: number
  ): { allowed: boolean; reason?: string } {
    const connections = this.connections.get(sandboxId) || [];
    const oneMinuteAgo = new Date(Date.now() - 60000);

    // Count recent connections
    const recentConnections = connections.filter(
      (c) => c.startedAt > oneMinuteAgo
    );

    if (recentConnections.length >= requestsPerMinute) {
      return { allowed: false, reason: 'Request rate limit exceeded' };
    }

    // Count active connections
    const activeConnections = connections.filter(
      (c) => c.state === 'NEW' || c.state === 'ESTABLISHED'
    );

    if (activeConnections.length >= maxConnections) {
      return { allowed: false, reason: 'Max connections exceeded' };
    }

    // Check egress bytes
    const totalEgress = recentConnections.reduce((sum, c) => sum + c.bytesOut, 0);

    if (egressBytesPerMinute > 0 && totalEgress >= egressBytesPerMinute) {
      return { allowed: false, reason: 'Egress bandwidth limit exceeded' };
    }

    return { allowed: true };
  }

  // ==========================================================================
  // DNS Filtering
  // ==========================================================================

  /**
   * Check if DNS query is allowed
   */
  isDnsQueryAllowed(
    sandboxId: string,
    domain: string,
    policy: NetworkPolicy
  ): boolean {
    // Internal-only mode blocks external DNS
    if (policy.dnsPolicy.internalOnly) {
      const isInternal =
        domain.endsWith('.internal') ||
        domain.endsWith('.local') ||
        domain === 'localhost';

      if (!isInternal) {
        this.logActivity(sandboxId, {
          timestamp: new Date(),
          direction: 'egress',
          destination: domain,
          port: 53,
          protocol: 'udp',
          bytes: 0,
          allowed: false,
          blockedReason: 'DNS query blocked: internal-only mode',
        });
        return false;
      }
    }

    // Check against allowed domains
    if (policy.dnsPolicy.allowedDomains.length > 0) {
      const isAllowed = policy.dnsPolicy.allowedDomains.some((pattern) => {
        if (pattern === '*') return true;
        if (pattern.startsWith('*.')) {
          return domain.endsWith(pattern.slice(1)) || domain === pattern.slice(2);
        }
        return domain === pattern;
      });

      if (!isAllowed) {
        this.logActivity(sandboxId, {
          timestamp: new Date(),
          direction: 'egress',
          destination: domain,
          port: 53,
          protocol: 'udp',
          bytes: 0,
          allowed: false,
          blockedReason: 'DNS query blocked: domain not in allowlist',
        });
        return false;
      }
    }

    return true;
  }

  // ==========================================================================
  // Statistics
  // ==========================================================================

  /**
   * Get network statistics for a sandbox
   */
  getStats(sandboxId: string): {
    totalBytesIn: number;
    totalBytesOut: number;
    connectionCount: number;
    blockedCount: number;
    activeConnections: number;
  } {
    const connections = this.connections.get(sandboxId) || [];
    const logs = this.activityLogs.get(sandboxId) || [];

    const totalBytesIn = connections.reduce((sum, c) => sum + c.bytesIn, 0);
    const totalBytesOut = connections.reduce((sum, c) => sum + c.bytesOut, 0);
    const activeConnections = connections.filter(
      (c) => c.state === 'NEW' || c.state === 'ESTABLISHED'
    ).length;
    const blockedCount = logs.filter((l) => !l.allowed).length;

    return {
      totalBytesIn,
      totalBytesOut,
      connectionCount: connections.length,
      blockedCount,
      activeConnections,
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let instance: NetworkPolicyEnforcer | null = null;

export function createNetworkPolicyEnforcer(): NetworkPolicyEnforcer {
  if (!instance) {
    instance = new NetworkPolicyEnforcer();
  }
  return instance;
}

export function getNetworkPolicyEnforcer(): NetworkPolicyEnforcer {
  if (!instance) {
    throw new Error('NetworkPolicyEnforcer not initialized');
  }
  return instance;
}
