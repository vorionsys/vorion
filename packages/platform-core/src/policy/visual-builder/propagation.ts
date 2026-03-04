/**
 * Policy Propagation System
 *
 * Real-time policy distribution to agents within 30 seconds.
 * Implements FR148 for Epic 4.
 *
 * Features:
 * - Sub-30 second propagation
 * - WebSocket-based push notifications
 * - Acknowledgment tracking
 * - Fallback polling for offline agents
 *
 * @packageDocumentation
 */

import { createLogger } from '../../common/logger.js';
import { Counter, Histogram, Gauge } from 'prom-client';
import { intentRegistry } from '../../intent/metrics.js';
import type { ID } from '../../common/types.js';
import type { PolicyDefinition } from '../types.js';

const logger = createLogger({ component: 'policy-propagation' });

// =============================================================================
// Metrics
// =============================================================================

const policyPropagations = new Counter({
  name: 'vorion_policy_propagations_total',
  help: 'Total policy propagation events',
  labelNames: ['status'] as const,
  registers: [intentRegistry],
});

const propagationDuration = new Histogram({
  name: 'vorion_policy_propagation_duration_seconds',
  help: 'Time to propagate policy to all agents',
  buckets: [0.5, 1, 2, 5, 10, 15, 30, 60],
  registers: [intentRegistry],
});

const agentAcknowledgments = new Counter({
  name: 'vorion_policy_acks_total',
  help: 'Policy acknowledgments from agents',
  labelNames: ['status'] as const,
  registers: [intentRegistry],
});

const pendingPropagations = new Gauge({
  name: 'vorion_pending_policy_propagations',
  help: 'Number of policies pending full propagation',
  registers: [intentRegistry],
});

// =============================================================================
// Types
// =============================================================================

/**
 * Policy update event
 */
export interface PolicyUpdateEvent {
  eventId: string;
  policyId: ID;
  policyName: string;
  version: number;
  action: 'created' | 'updated' | 'activated' | 'deactivated' | 'deleted';
  checksum: string;
  timestamp: string;
  /** Optional full definition for push updates */
  definition?: PolicyDefinition;
}

/**
 * Agent acknowledgment
 */
export interface PolicyAcknowledgment {
  agentId: ID;
  policyId: ID;
  version: number;
  acknowledgedAt: string;
  latencyMs: number;
  status: 'received' | 'applied' | 'error';
  errorMessage?: string;
}

/**
 * Propagation status
 */
export interface PropagationStatus {
  eventId: string;
  policyId: ID;
  startedAt: string;
  completedAt?: string;
  targetAgents: number;
  acknowledgedAgents: number;
  pendingAgents: ID[];
  failedAgents: { agentId: ID; error: string }[];
  status: 'in_progress' | 'completed' | 'partial' | 'failed';
  latencyP50Ms?: number;
  latencyP95Ms?: number;
}

/**
 * Propagation options
 */
export interface PropagationOptions {
  /** Target specific agents (empty = all) */
  targetAgentIds?: ID[];
  /** Target specific namespaces */
  targetNamespaces?: string[];
  /** Include full policy definition in event */
  includeDefinition?: boolean;
  /** Timeout for acknowledgments */
  ackTimeoutMs?: number;
  /** Require minimum acknowledgment percentage to succeed */
  minAckPercentage?: number;
}

/**
 * Agent connection interface (for WebSocket management)
 */
export interface AgentConnection {
  agentId: ID;
  tenantId: ID;
  namespace?: string;
  connected: boolean;
  lastSeen: string;
  send(event: PolicyUpdateEvent): Promise<void>;
}

// =============================================================================
// Policy Propagation Service
// =============================================================================

/**
 * Policy Propagation Service
 *
 * Manages real-time policy distribution to agents.
 */
export class PolicyPropagationService {
  private connections: Map<ID, AgentConnection> = new Map();
  private propagations: Map<string, PropagationStatus> = new Map();
  private acknowledgments: Map<string, Map<ID, PolicyAcknowledgment>> = new Map();

  /**
   * Register an agent connection
   */
  registerConnection(connection: AgentConnection): void {
    this.connections.set(connection.agentId, connection);
    logger.debug({ agentId: connection.agentId }, 'Agent connection registered');
  }

  /**
   * Remove an agent connection
   */
  removeConnection(agentId: ID): void {
    this.connections.delete(agentId);
    logger.debug({ agentId }, 'Agent connection removed');
  }

  /**
   * Get connected agent count
   */
  getConnectedAgentCount(): number {
    return Array.from(this.connections.values()).filter(c => c.connected).length;
  }

  /**
   * Propagate a policy update to agents
   */
  async propagate(
    event: PolicyUpdateEvent,
    options: PropagationOptions = {}
  ): Promise<PropagationStatus> {
    const startTime = Date.now();
    const eventId = event.eventId;

    logger.info({
      eventId,
      policyId: event.policyId,
      action: event.action,
    }, 'Starting policy propagation');

    pendingPropagations.inc();
    policyPropagations.inc({ status: 'started' });

    // Determine target agents
    const targetAgents = this.getTargetAgents(options);
    const targetAgentIds = targetAgents.map(a => a.agentId);

    // Initialize propagation status
    const status: PropagationStatus = {
      eventId,
      policyId: event.policyId,
      startedAt: new Date().toISOString(),
      targetAgents: targetAgents.length,
      acknowledgedAgents: 0,
      pendingAgents: [...targetAgentIds],
      failedAgents: [],
      status: 'in_progress',
    };

    this.propagations.set(eventId, status);
    this.acknowledgments.set(eventId, new Map());

    // Send to all connected agents in parallel
    const sendPromises = targetAgents.map(async (connection) => {
      try {
        await connection.send(event);
        logger.debug({ agentId: connection.agentId, eventId }, 'Policy update sent');
      } catch (error) {
        status.failedAgents.push({
          agentId: connection.agentId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        status.pendingAgents = status.pendingAgents.filter(id => id !== connection.agentId);
        logger.warn({ agentId: connection.agentId, error }, 'Failed to send policy update');
      }
    });

    // Wait for all sends to complete
    await Promise.allSettled(sendPromises);

    // Wait for acknowledgments (with timeout)
    const ackTimeout = options.ackTimeoutMs ?? 30000;
    const minAckPercentage = options.minAckPercentage ?? 80;

    const ackResult = await this.waitForAcknowledgments(
      eventId,
      targetAgentIds,
      ackTimeout,
      minAckPercentage
    );

    // Update final status
    status.completedAt = new Date().toISOString();
    status.acknowledgedAgents = ackResult.acknowledged;
    status.pendingAgents = ackResult.pending;

    // Calculate latencies
    const acks = this.acknowledgments.get(eventId);
    if (acks && acks.size > 0) {
      const latencies = Array.from(acks.values())
        .map(a => a.latencyMs)
        .sort((a, b) => a - b);

      status.latencyP50Ms = latencies[Math.floor(latencies.length * 0.5)];
      status.latencyP95Ms = latencies[Math.floor(latencies.length * 0.95)];
    }

    // Determine final status
    const ackPercentage = (status.acknowledgedAgents / status.targetAgents) * 100;
    if (ackPercentage >= 100) {
      status.status = 'completed';
      policyPropagations.inc({ status: 'completed' });
    } else if (ackPercentage >= minAckPercentage) {
      status.status = 'partial';
      policyPropagations.inc({ status: 'partial' });
    } else {
      status.status = 'failed';
      policyPropagations.inc({ status: 'failed' });
    }

    const duration = Date.now() - startTime;
    propagationDuration.observe(duration / 1000);
    pendingPropagations.dec();

    logger.info({
      eventId,
      policyId: event.policyId,
      status: status.status,
      acknowledged: status.acknowledgedAgents,
      total: status.targetAgents,
      durationMs: duration,
    }, 'Policy propagation completed');

    return status;
  }

  /**
   * Record an acknowledgment from an agent
   */
  recordAcknowledgment(ack: PolicyAcknowledgment): void {
    // Find the propagation event
    for (const [eventId, status] of this.propagations) {
      if (status.policyId === ack.policyId) {
        const acks = this.acknowledgments.get(eventId);
        if (acks) {
          acks.set(ack.agentId, ack);

          // Update status
          status.pendingAgents = status.pendingAgents.filter(id => id !== ack.agentId);
          status.acknowledgedAgents++;

          if (ack.status === 'error') {
            status.failedAgents.push({
              agentId: ack.agentId,
              error: ack.errorMessage ?? 'Unknown error',
            });
          }
        }
        break;
      }
    }

    agentAcknowledgments.inc({ status: ack.status });
    logger.debug({
      agentId: ack.agentId,
      policyId: ack.policyId,
      status: ack.status,
      latencyMs: ack.latencyMs,
    }, 'Policy acknowledgment recorded');
  }

  /**
   * Get propagation status
   */
  getStatus(eventId: string): PropagationStatus | undefined {
    return this.propagations.get(eventId);
  }

  /**
   * Get recent propagations
   */
  getRecentPropagations(limit = 10): PropagationStatus[] {
    return Array.from(this.propagations.values())
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, limit);
  }

  /**
   * Create a policy update event
   */
  createEvent(
    policyId: ID,
    policyName: string,
    version: number,
    action: PolicyUpdateEvent['action'],
    checksum: string,
    definition?: PolicyDefinition
  ): PolicyUpdateEvent {
    return {
      eventId: `prop_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      policyId,
      policyName,
      version,
      action,
      checksum,
      timestamp: new Date().toISOString(),
      definition,
    };
  }

  /**
   * Get target agents based on options
   */
  private getTargetAgents(options: PropagationOptions): AgentConnection[] {
    let agents = Array.from(this.connections.values()).filter(c => c.connected);

    if (options.targetAgentIds && options.targetAgentIds.length > 0) {
      const targetSet = new Set(options.targetAgentIds);
      agents = agents.filter(a => targetSet.has(a.agentId));
    }

    if (options.targetNamespaces && options.targetNamespaces.length > 0) {
      const nsSet = new Set(options.targetNamespaces);
      agents = agents.filter(a => a.namespace && nsSet.has(a.namespace));
    }

    return agents;
  }

  /**
   * Wait for acknowledgments with timeout
   */
  private async waitForAcknowledgments(
    eventId: string,
    targetAgentIds: ID[],
    timeoutMs: number,
    minPercentage: number
  ): Promise<{ acknowledged: number; pending: ID[] }> {
    const startTime = Date.now();
    const targetCount = targetAgentIds.length;
    const minAcks = Math.ceil((targetCount * minPercentage) / 100);

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const acks = this.acknowledgments.get(eventId);
        const acknowledged = acks?.size ?? 0;
        const elapsed = Date.now() - startTime;

        // Check if we have enough acknowledgments
        if (acknowledged >= minAcks || acknowledged >= targetCount) {
          clearInterval(checkInterval);
          const pending = targetAgentIds.filter(id => !acks?.has(id));
          resolve({ acknowledged, pending });
          return;
        }

        // Check timeout
        if (elapsed >= timeoutMs) {
          clearInterval(checkInterval);
          const pending = targetAgentIds.filter(id => !acks?.has(id));
          resolve({ acknowledged, pending });
          return;
        }
      }, 100);
    });
  }

  /**
   * Clean up old propagation records
   */
  cleanup(maxAgeMs = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleaned = 0;

    for (const [eventId, status] of this.propagations) {
      if (new Date(status.startedAt).getTime() < cutoff) {
        this.propagations.delete(eventId);
        this.acknowledgments.delete(eventId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info({ cleaned }, 'Cleaned up old propagation records');
    }

    return cleaned;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a policy propagation service instance
 */
export function createPolicyPropagationService(): PolicyPropagationService {
  return new PolicyPropagationService();
}
