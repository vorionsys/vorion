/**
 * A2A Message Router
 *
 * Routes messages between agents, handling discovery, load balancing,
 * and message delivery with retry logic.
 *
 * @packageDocumentation
 */

import { randomUUID } from 'crypto';
import { createLogger } from '../common/logger.js';
import {
  type A2AMessage,
  type A2AMessageType,
  type A2APayload,
  type InvokePayload,
  type ResponsePayload,
  type TrustContext,
  type AgentEndpoint,
  type A2AError,
  type ExecutionMetrics,
  type ChainContext,
  DEFAULT_A2A_TIMEOUT_MS,
} from './types.js';
import {
  TrustNegotiationService,
  getTrustNegotiationService,
} from './trust-negotiation.js';

const logger = createLogger({ component: 'a2a-router' });

// ============================================================================
// Types
// ============================================================================

/**
 * Router configuration
 */
export interface RouterConfig {
  /** Default timeout for A2A calls */
  defaultTimeoutMs: number;

  /** Maximum retries */
  maxRetries: number;

  /** Retry delay base in ms */
  retryDelayMs: number;

  /** Enable circuit breaker */
  circuitBreakerEnabled: boolean;

  /** Circuit breaker failure threshold */
  circuitBreakerThreshold: number;

  /** Circuit breaker reset time in ms */
  circuitBreakerResetMs: number;
}

/**
 * Pending request tracking
 */
interface PendingRequest {
  id: string;
  message: A2AMessage;
  sentAt: Date;
  timeoutMs: number;
  retryCount: number;
  resolve: (response: A2AMessage) => void;
  reject: (error: Error) => void;
  timeoutHandle: NodeJS.Timeout;
}

/**
 * Circuit breaker state
 */
interface CircuitBreakerState {
  failures: number;
  lastFailure: Date | null;
  state: 'closed' | 'open' | 'half-open';
  nextAttempt: Date | null;
}

/**
 * Message handler callback
 */
export type MessageHandler = (
  message: A2AMessage,
  context: MessageContext
) => Promise<A2APayload | null>;

/**
 * Message context passed to handlers
 */
export interface MessageContext {
  /** Verified trust context */
  trustContext: TrustContext;

  /** Effective caller tier (after verification) */
  effectiveTier: number;

  /** Effective caller score (after verification) */
  effectiveScore: number;

  /** Chain context for nested calls */
  chainContext?: ChainContext;

  /** Request metadata */
  metadata: Record<string, unknown>;
}

// ============================================================================
// A2A Router
// ============================================================================

export class A2ARouter {
  private config: RouterConfig;
  private endpoints: Map<string, AgentEndpoint> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private circuitBreakers: Map<string, CircuitBreakerState> = new Map();
  private handlers: Map<string, MessageHandler> = new Map();
  private trustService: TrustNegotiationService | null = null;

  constructor(config: Partial<RouterConfig> = {}) {
    this.config = {
      defaultTimeoutMs: config.defaultTimeoutMs ?? DEFAULT_A2A_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? 3,
      retryDelayMs: config.retryDelayMs ?? 1000,
      circuitBreakerEnabled: config.circuitBreakerEnabled ?? true,
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 5,
      circuitBreakerResetMs: config.circuitBreakerResetMs ?? 30000,
    };

    logger.info({ config: this.config }, 'A2A router initialized');
  }

  /**
   * Set trust service (lazy initialization)
   */
  setTrustService(service: TrustNegotiationService): void {
    this.trustService = service;
  }

  // ==========================================================================
  // Endpoint Management
  // ==========================================================================

  /**
   * Register an agent endpoint
   */
  registerEndpoint(endpoint: AgentEndpoint): void {
    this.endpoints.set(endpoint.carId, endpoint);
    this.initCircuitBreaker(endpoint.carId);
    logger.info({ carId: endpoint.carId, url: endpoint.url }, 'Endpoint registered');
  }

  /**
   * Unregister an agent endpoint
   */
  unregisterEndpoint(carId: string): void {
    this.endpoints.delete(carId);
    this.circuitBreakers.delete(carId);
    logger.info({ carId }, 'Endpoint unregistered');
  }

  /**
   * Get endpoint for a CAR ID
   */
  getEndpoint(carId: string): AgentEndpoint | undefined {
    return this.endpoints.get(carId);
  }

  /**
   * Discover endpoints matching criteria
   */
  discoverEndpoints(criteria: {
    capabilities?: string[];
    minTier?: number;
    action?: string;
  }): AgentEndpoint[] {
    const results: AgentEndpoint[] = [];

    for (const endpoint of this.endpoints.values()) {
      // Check capabilities
      if (criteria.capabilities) {
        const hasAll = criteria.capabilities.every((cap) =>
          endpoint.capabilities.includes(cap)
        );
        if (!hasAll) continue;
      }

      // Check tier
      if (criteria.minTier !== undefined) {
        if (endpoint.trustRequirements.minTier < criteria.minTier) continue;
      }

      // Check action
      if (criteria.action) {
        const hasAction = endpoint.actions.some((a) => a.name === criteria.action);
        if (!hasAction) continue;
      }

      results.push(endpoint);
    }

    return results;
  }

  // ==========================================================================
  // Message Routing
  // ==========================================================================

  /**
   * Send an A2A message and wait for response
   */
  async send(
    from: string,
    to: string,
    payload: A2APayload,
    trustContext: TrustContext,
    options: {
      timeoutMs?: number;
      correlationId?: string;
    } = {}
  ): Promise<A2AMessage> {
    const messageId = randomUUID();
    const timeoutMs = options.timeoutMs ?? this.config.defaultTimeoutMs;

    // Check circuit breaker
    if (!this.canSend(to)) {
      throw this.createError('AGENT_UNAVAILABLE', `Circuit breaker open for ${to}`);
    }

    // Build message
    const message: A2AMessage = {
      id: messageId,
      version: '1.0',
      type: this.getMessageType(payload),
      from,
      to,
      timestamp: new Date().toISOString(),
      correlationId: options.correlationId,
      trustContext,
      payload,
    };

    // Get endpoint
    const endpoint = this.endpoints.get(to);
    if (!endpoint) {
      throw this.createError('AGENT_UNAVAILABLE', `No endpoint for ${to}`);
    }

    // Create pending request
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.handleTimeout(messageId);
      }, timeoutMs);

      const pendingRequest: PendingRequest = {
        id: messageId,
        message,
        sentAt: new Date(),
        timeoutMs,
        retryCount: 0,
        resolve,
        reject,
        timeoutHandle,
      };

      this.pendingRequests.set(messageId, pendingRequest);

      // Send message
      this.deliverMessage(message, endpoint)
        .catch((error) => {
          this.handleDeliveryError(messageId, error);
        });
    });
  }

  /**
   * Send fire-and-forget message (no response expected)
   */
  async sendAsync(
    from: string,
    to: string,
    payload: A2APayload,
    trustContext: TrustContext
  ): Promise<string> {
    const messageId = randomUUID();

    if (!this.canSend(to)) {
      throw this.createError('AGENT_UNAVAILABLE', `Circuit breaker open for ${to}`);
    }

    const message: A2AMessage = {
      id: messageId,
      version: '1.0',
      type: this.getMessageType(payload),
      from,
      to,
      timestamp: new Date().toISOString(),
      trustContext,
      payload,
    };

    const endpoint = this.endpoints.get(to);
    if (!endpoint) {
      throw this.createError('AGENT_UNAVAILABLE', `No endpoint for ${to}`);
    }

    await this.deliverMessage(message, endpoint);

    return messageId;
  }

  /**
   * Deliver message to endpoint
   */
  private async deliverMessage(
    message: A2AMessage,
    endpoint: AgentEndpoint
  ): Promise<void> {
    try {
      // In production, this would make an HTTP/gRPC call
      // For now, we simulate local delivery via handlers
      logger.debug(
        { messageId: message.id, from: message.from, to: message.to },
        'Delivering message'
      );

      // Check if we have a local handler
      const handler = this.handlers.get(message.to);
      if (handler) {
        await this.handleLocally(message, handler);
      } else {
        // Would make HTTP call here
        logger.warn({ to: message.to }, 'No handler for agent, remote delivery not implemented');
        throw new Error('Remote delivery not implemented');
      }

      this.recordSuccess(message.to);
    } catch (error) {
      this.recordFailure(message.to);
      throw error;
    }
  }

  /**
   * Handle message locally
   */
  private async handleLocally(
    message: A2AMessage,
    handler: MessageHandler
  ): Promise<void> {
    // Verify trust
    const trustService = this.trustService ?? getTrustNegotiationService();
    const endpoint = this.endpoints.get(message.to);

    if (!endpoint) {
      throw this.createError('AGENT_UNAVAILABLE', 'Endpoint not found');
    }

    const verification = await trustService.verifyCallerTrust(
      message.from,
      message.to,
      message.trustContext,
      endpoint.trustRequirements
    );

    if (!verification.verified) {
      // Send error response
      await this.sendErrorResponse(
        message,
        'TRUST_INSUFFICIENT',
        verification.reason || 'Trust verification failed'
      );
      return;
    }

    // Build context
    const context: MessageContext = {
      trustContext: message.trustContext,
      effectiveTier: verification.effectiveTier,
      effectiveScore: verification.effectiveScore,
      chainContext: (message.payload as InvokePayload).chainContext,
      metadata: {},
    };

    // Call handler
    const responsePayload = await handler(message, context);

    // Send response if expected
    if (responsePayload && message.type === 'invoke') {
      await this.sendResponse(message, responsePayload);
    }
  }

  /**
   * Send response to a message
   */
  private async sendResponse(
    originalMessage: A2AMessage,
    payload: A2APayload
  ): Promise<void> {
    const response: A2AMessage = {
      id: randomUUID(),
      version: '1.0',
      type: 'response',
      from: originalMessage.to,
      to: originalMessage.from,
      timestamp: new Date().toISOString(),
      correlationId: originalMessage.id,
      trustContext: originalMessage.trustContext, // Echo back
      payload,
    };

    // Resolve pending request
    const pending = this.pendingRequests.get(originalMessage.id);
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      this.pendingRequests.delete(originalMessage.id);
      pending.resolve(response);
    }
  }

  /**
   * Send error response
   */
  private async sendErrorResponse(
    originalMessage: A2AMessage,
    code: A2AError['code'],
    message: string
  ): Promise<void> {
    const errorPayload: ResponsePayload = {
      type: 'response',
      success: false,
      error: { code, message },
      metrics: {
        durationMs: 0,
        subCallCount: 0,
      },
    };

    await this.sendResponse(originalMessage, errorPayload);
  }

  // ==========================================================================
  // Handler Registration
  // ==========================================================================

  /**
   * Register a message handler for a CAR ID
   */
  registerHandler(carId: string, handler: MessageHandler): void {
    this.handlers.set(carId, handler);
    logger.info({ carId }, 'Handler registered');
  }

  /**
   * Unregister a message handler
   */
  unregisterHandler(carId: string): void {
    this.handlers.delete(carId);
    logger.info({ carId }, 'Handler unregistered');
  }

  // ==========================================================================
  // Circuit Breaker
  // ==========================================================================

  /**
   * Initialize circuit breaker for endpoint
   */
  private initCircuitBreaker(carId: string): void {
    this.circuitBreakers.set(carId, {
      failures: 0,
      lastFailure: null,
      state: 'closed',
      nextAttempt: null,
    });
  }

  /**
   * Check if we can send to endpoint
   */
  private canSend(carId: string): boolean {
    if (!this.config.circuitBreakerEnabled) return true;

    const breaker = this.circuitBreakers.get(carId);
    if (!breaker) return true;

    switch (breaker.state) {
      case 'closed':
        return true;

      case 'open':
        // Check if reset time has passed
        if (breaker.nextAttempt && new Date() >= breaker.nextAttempt) {
          breaker.state = 'half-open';
          return true;
        }
        return false;

      case 'half-open':
        return true;
    }
  }

  /**
   * Record successful call
   */
  private recordSuccess(carId: string): void {
    const breaker = this.circuitBreakers.get(carId);
    if (!breaker) return;

    if (breaker.state === 'half-open') {
      // Reset on success in half-open
      breaker.failures = 0;
      breaker.state = 'closed';
      breaker.lastFailure = null;
      breaker.nextAttempt = null;
      logger.info({ carId }, 'Circuit breaker closed');
    }
  }

  /**
   * Record failed call
   */
  private recordFailure(carId: string): void {
    const breaker = this.circuitBreakers.get(carId);
    if (!breaker) return;

    breaker.failures++;
    breaker.lastFailure = new Date();

    if (breaker.state === 'half-open') {
      // Failure in half-open reopens
      breaker.state = 'open';
      breaker.nextAttempt = new Date(Date.now() + this.config.circuitBreakerResetMs);
      logger.warn({ carId }, 'Circuit breaker reopened');
    } else if (breaker.failures >= this.config.circuitBreakerThreshold) {
      // Threshold reached
      breaker.state = 'open';
      breaker.nextAttempt = new Date(Date.now() + this.config.circuitBreakerResetMs);
      logger.warn({ carId, failures: breaker.failures }, 'Circuit breaker opened');
    }
  }

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  /**
   * Handle timeout
   */
  private handleTimeout(messageId: string): void {
    const pending = this.pendingRequests.get(messageId);
    if (!pending) return;

    // Attempt retry
    if (pending.retryCount < this.config.maxRetries) {
      pending.retryCount++;
      const delay = this.config.retryDelayMs * Math.pow(2, pending.retryCount - 1);

      logger.debug(
        { messageId, retry: pending.retryCount, delay },
        'Retrying message'
      );

      setTimeout(() => {
        const endpoint = this.endpoints.get(pending.message.to);
        if (endpoint) {
          this.deliverMessage(pending.message, endpoint).catch((error) => {
            this.handleDeliveryError(messageId, error);
          });
        }
      }, delay);

      // Reset timeout
      pending.timeoutHandle = setTimeout(() => {
        this.handleTimeout(messageId);
      }, pending.timeoutMs);
    } else {
      // Max retries exceeded
      this.pendingRequests.delete(messageId);
      pending.reject(new Error(`A2A timeout after ${pending.retryCount} retries`));
      this.recordFailure(pending.message.to);
    }
  }

  /**
   * Handle delivery error
   */
  private handleDeliveryError(messageId: string, error: Error): void {
    const pending = this.pendingRequests.get(messageId);
    if (!pending) return;

    // For some errors, don't retry
    if (error.message.includes('TRUST_INSUFFICIENT') ||
        error.message.includes('CAPABILITY_DENIED')) {
      clearTimeout(pending.timeoutHandle);
      this.pendingRequests.delete(messageId);
      pending.reject(error);
      return;
    }

    // Let timeout handle retry
    logger.debug({ messageId, error: error.message }, 'Delivery error, awaiting retry');
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Get message type from payload
   */
  private getMessageType(payload: A2APayload): A2AMessageType {
    return payload.type as A2AMessageType;
  }

  /**
   * Create A2A error
   */
  private createError(code: A2AError['code'], message: string): Error {
    const error = new Error(message);
    (error as any).code = code;
    return error;
  }

  /**
   * Get router statistics
   */
  getStats(): {
    endpoints: number;
    pendingRequests: number;
    circuitBreakers: Record<string, CircuitBreakerState>;
  } {
    return {
      endpoints: this.endpoints.size,
      pendingRequests: this.pendingRequests.size,
      circuitBreakers: Object.fromEntries(this.circuitBreakers),
    };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

let instance: A2ARouter | null = null;

export function createA2ARouter(config?: Partial<RouterConfig>): A2ARouter {
  if (!instance) {
    instance = new A2ARouter(config);
  }
  return instance;
}

export function getA2ARouter(): A2ARouter {
  if (!instance) {
    throw new Error('A2ARouter not initialized');
  }
  return instance;
}
